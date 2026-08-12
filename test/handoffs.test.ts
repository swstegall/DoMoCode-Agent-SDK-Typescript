import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import type { HandoffRequest } from "../src/types/durable.ts";

const request: HandoffRequest = {
  id: "handoff/1",
  sourceSessionId: "session/1",
  sourceOwner: "owner-1",
  targetOwner: "owner-2",
  kind: "transfer",
  target: { sessionId: "session/2", clientId: "client/2" },
  plan: { summary: "continue", steps: [{ id: "step-1", title: "Continue", dependsOn: [], completed: false }], metadata: {} },
  artifacts: [{ id: "artifact-1", kind: "file", reference: "README.md", sourceSessionId: "session/1", metadata: {} }],
  metadata: { reason: "test" }
};

const record = { ...request, state: "proposed", createdAt: "2026-08-11T00:00:00Z", updatedAt: "2026-08-11T00:00:00Z" };
const event = { sequence: 3, handoffID: request.id, sourceSessionID: request.sourceSessionId, timestamp: record.updatedAt, kind: "proposed", state: "proposed", metadata: {} };

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("handoffs encode and decode the durable transfer contract", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ path: `${url.pathname}${url.search}`, body });
    if (url.pathname === "/handoffs") return response([record]);
    if (url.pathname === "/handoff") return response(record, 201);
    if (url.pathname === "/handoff/handoff%2F1") return response(record);
    if (url.pathname === "/handoff/handoff%2F1/events") return response([event]);
    if (url.pathname === "/handoff/handoff%2F1/export") return response([{ event, record }]);
    if (url.pathname.includes("/accept") || url.pathname.includes("/complete") || url.pathname.includes("/reject") || url.pathname.includes("/cancel")) return response(record);
    throw new Error(`unexpected route ${url.pathname}`);
  };
  const client = new DoMoCodeClient({ baseURL: "https://example.test", token: "token", fetch });
  assert.equal((await client.handoffs.list({ sourceSessionId: "session/1" }))[0]?.sourceSessionId, "session/1");
  assert.equal((await client.handoffs.propose(request)).target.sessionId, "session/2");
  assert.equal((await client.handoffs.get(request.id)).id, request.id);
  assert.equal((await client.handoffs.events(request.id))[0]?.handoffId, request.id);
  const feed = client.handoffs.feed(request.id, { pollIntervalMs: 0 });
  assert.equal((await feed.next()).value?.sequence, 3);
  await feed.return();
  assert.equal((await client.handoffs.accept(request.id, "owner-2")).state, "proposed");
  assert.equal((await client.handoffs.complete(request.id, "owner-2", request.target, { done: true })).id, request.id);
  assert.equal((await client.handoffs.reject(request.id, "owner-2", "no")).id, request.id);
  assert.equal((await client.handoffs.cancel(request.id, "owner-2", "stop")).id, request.id);
  assert.equal((await client.handoffs.export(request.id))[0]?.event.sequence, 3);
  const proposal = calls.find((call) => call.path === "/handoff");
  assert.deepEqual(proposal?.body, {
    id: request.id,
    sourceOwner: request.sourceOwner,
    targetOwner: request.targetOwner,
    kind: request.kind,
    target: { sessionID: "session/2", clientID: "client/2" },
    plan: { summary: "continue", steps: [{ id: "step-1", title: "Continue", dependsOn: [], completed: false }], metadata: {} },
    artifacts: [{ id: "artifact-1", kind: "file", reference: "README.md", sourceSessionID: "session/1", metadata: {} }],
    metadata: request.metadata,
    sourceSessionID: "session/1"
  });
  await client.close();
});
