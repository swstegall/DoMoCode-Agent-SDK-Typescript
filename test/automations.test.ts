import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import type { AutomationDefinition, AutomationInvocation } from "../src/types/durable.ts";

const definition: AutomationDefinition = {
  id: "automation/1",
  displayName: "Review",
  owner: "owner-1",
  profileId: "review",
  workspaceRoot: "/tmp/workspace",
  sandboxPolicyId: "read-only",
  trigger: { kind: "manual", authenticated: false },
  budget: { maxRuntimeMilliseconds: 1_000, maxAttempts: 1, maxOutputBytes: 4_096 },
  secretScope: { credentialReferences: [], environmentNames: [], allowInheritedEnvironment: false },
  cancellationPolicy: "cooperative",
  enabled: false,
  createdAt: "2026-08-11T00:00:00Z",
  updatedAt: "2026-08-11T00:00:00Z",
  metadata: {}
};

const invocation: AutomationInvocation = {
  id: "invocation-1",
  automationId: definition.id,
  source: "userPrompt",
  requestedBy: "owner-1",
  sessionId: "session-1",
  createdAt: "2026-08-11T00:00:00Z",
  input: { prompt: "review" },
  metadata: {}
};

const event = { sequence: 5, automationID: definition.id, timestamp: definition.updatedAt, kind: "invoked", enabled: true, invocationID: invocation.id, metadata: {} };
const journal = { event, definition, invocation };

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("automations preserve policy, invocation, audit cursor, and export routes", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ path: `${url.pathname}${url.search}`, body });
    if (url.pathname === "/automations") return response([definition]);
    if (url.pathname === "/automation") return response(definition, 201);
    if (url.pathname === "/automation/automation%2F1") return response(definition);
    if (url.pathname.endsWith("/enable") || url.pathname.endsWith("/disable")) return response(definition);
    if (url.pathname.endsWith("/invoke")) return response(invocation, 202);
    if (url.pathname.endsWith("/events")) return response([event]);
    if (url.pathname.endsWith("/invocations")) return response([invocation]);
    if (url.pathname.endsWith("/export")) return response([journal]);
    throw new Error(`unexpected route ${url.pathname}`);
  };
  const client = new DoMoCodeClient({ baseURL: "https://example.test", token: "token", fetch });
  assert.equal((await client.automations.list({ owner: "owner/1" }))[0]?.profileId, "review");
  assert.equal((await client.automations.register(definition)).id, definition.id);
  assert.equal((await client.automations.get(definition.id)).id, definition.id);
  assert.equal((await client.automations.enable(definition.id, "owner-1")).id, definition.id);
  assert.equal((await client.automations.disable(definition.id, "owner-1")).id, definition.id);
  assert.equal((await client.automations.invoke(invocation)).automationId, definition.id);
  assert.equal((await client.automations.events(definition.id))[0]?.invocationId, invocation.id);
  const feed = client.automations.feed(definition.id, { pollIntervalMs: 0 });
  assert.equal((await feed.next()).value?.sequence, 5);
  await feed.return();
  assert.equal((await client.automations.invocations(definition.id))[0]?.id, invocation.id);
  assert.equal((await client.automations.export(definition.id))[0]?.definition.id, definition.id);
  const registerCall = calls.find((call) => call.path === "/automation");
  assert.deepEqual(registerCall?.body, {
    id: definition.id,
    displayName: definition.displayName,
    owner: definition.owner,
    profileID: definition.profileId,
    workspaceRoot: definition.workspaceRoot,
    sandboxPolicyID: definition.sandboxPolicyId,
    trigger: definition.trigger,
    budget: definition.budget,
    secretScope: definition.secretScope,
    cancellationPolicy: definition.cancellationPolicy,
    enabled: definition.enabled,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    metadata: definition.metadata
  });
  const invokeCall = calls.find((call) => call.path.endsWith("/invoke"));
  assert.deepEqual(invokeCall?.body, {
    id: invocation.id,
    automationID: definition.id,
    source: invocation.source,
    requestedBy: invocation.requestedBy,
    sessionID: invocation.sessionId,
    createdAt: invocation.createdAt,
    input: invocation.input,
    metadata: invocation.metadata
  });
  await client.close();
});
