import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import { InteractionRuntime, permissionPolicy, wildcardMatch, yolo, type PermissionAsk } from "../src/interactionRuntime.ts";
import { PermissionGrantError, RunStalledError } from "../src/types/errors.ts";
import type { ServerEvent } from "../src/types/events.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

test("permission asks expose capability methods and abort when resolved", async () => {
  const server = new MockDoMoServer({ autoComplete: false });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "interaction-client", owner: "tests" });
  const session = await client.sessions.create();
  const runtime = new InteractionRuntime({ warn: () => undefined, idleMs: 25 });
  await runtime.attach(session);
  const next = runtime.interactions().next();
  await server.requestPermission(session.id, {
    id: "per_1",
    sessionId: session.id,
    permission: "write",
    patterns: ["src/**"],
    always: [],
    metadata: { filepath: "src/main.ts" },
    disableAlways: false
  });
  const result = await withTimeout(next, 1_000);
  assert.equal(result.done, false);
  if (result.done) throw new Error("expected an interaction");
  const ask = result.value;
  assert.equal(ask.kind, "permission");
  const permission = ask as PermissionAsk;
  await assert.rejects(() => permission.allow({ always: true }), PermissionGrantError);
  await permission.allow();
  await waitFor(() => permission.signal.aborted);
  assert.equal(runtime.pending().length, 0);
  runtime.close();
  await session.dispose();
  server.close();
});

test("client interactions reconcile server-scoped OAuth pending asks", async () => {
  let opened: string | undefined;
  const server = new MockDoMoServer({ oauthPending: [{
    type: "oauth_request",
    id: "oauth-pending",
    server: "github",
    authorizationUrl: "https://auth.example.test/authorize?state=redacted",
    expiresAt: "2026-08-11T00:00:00Z"
  }] });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch });
  const next = client.interactions({
    warn: () => undefined,
    openOAuth: (url) => { opened = url; return true; }
  }).next();
  const result = await withTimeout(next, 1_000);
  assert.equal(result.done, false);
  if (!result.done && result.value.kind === "oauth" && "open" in result.value) {
    assert.equal(result.value.kind, "oauth");
    assert.equal(result.value.server, "github");
    assert.equal(await result.value.open(), true);
    assert.equal(opened, "https://auth.example.test/authorize?state=redacted");
  }
  await client.close();
  server.close();
});

test("handlers use LIFO precedence and decline passes to the next handler", async () => {
  const server = new MockDoMoServer({ autoComplete: false });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "handler-client", owner: "tests" });
  const session = await client.sessions.create();
  const runtime = new InteractionRuntime({ warn: () => undefined });
  await runtime.attach(session);
  const handled = new Promise<void>((resolve) => {
    runtime.onInteraction(() => "decline");
    runtime.onInteraction(async (ask) => {
      if (ask.kind !== "permission") return "decline";
      await (ask as PermissionAsk).allow();
      resolve();
    });
  });
  await server.requestPermission(session.id, {
    id: "per_lifo",
    sessionId: session.id,
    permission: "read",
    patterns: ["README.md"],
    always: [],
    metadata: {},
    disableAlways: false
  });
  await withTimeout(handled, 1_000);
  await waitFor(() => runtime.pending().length === 0);
  runtime.close();
  await session.dispose();
  server.close();
});

test("yolo answers questions and future request frames remain open-kind asks", async () => {
  const server = new MockDoMoServer({ autoComplete: false });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "policy-client", owner: "tests" });
  const session = await client.sessions.create();
  const runtime = new InteractionRuntime({ policy: yolo(), includeOAuth: true, warn: () => undefined });
  await runtime.attach(session);
  const sequenceBeforeQuestion = session.eventsEngine?.lastSequence ?? 0;
  await server.requestQuestion(session.id, {
    id: "question-1",
    sessionId: session.id,
    questions: [{ question: "Proceed?", options: [{ label: "Yes" }, { label: "No" }], allowsMultiple: false }]
  });
  await waitFor(() => (session.eventsEngine?.lastSequence ?? 0) > sequenceBeforeQuestion);
  await waitFor(() => runtime.pending().length === 0);

  const next = runtime.interactions().next();
  server.emit(session.id, { type: "oauth_request", id: "oauth-1", server: "github", authorizationUrl: "https://example.test", expiresAt: "2026-08-11T00:00:00Z" } as ServerEvent);
  const result = await withTimeout(next, 1_000);
  assert.equal(result.done, false);
  if (!result.done && result.value.kind === "oauth" && "open" in result.value) {
    assert.equal(result.value.kind, "oauth");
    assert.equal(result.value.id, "oauth-1");
    assert.equal(result.value.server, "github");
  }
  runtime.close();
  await session.dispose();
  server.close();
});

test("permission policies use last-match-wins globs and stalled runs carry ask payloads", async () => {
  assert.equal(wildcardMatch("src/**", "src/lib/file.ts"), true);
  assert.equal(wildcardMatch("src/*.ts", "src/lib/file.ts"), false);
  assert.equal(wildcardMatch("src/*.ts", "src/main.ts"), true);
  const policy = permissionPolicy({ rules: [{ pattern: "src/**", action: "deny" }, { pattern: "src/generated/**", action: "allow" }] });
  const server = new MockDoMoServer({ autoComplete: false });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "stall-client", owner: "tests" });
  const session = await client.sessions.create();
  await server.requestPermission(session.id, {
    id: "per_stall",
    sessionId: session.id,
    permission: "write",
    patterns: ["src/**"],
    always: [],
    metadata: { filepath: "src/generated/api.ts" },
    disableAlways: false
  });
  await assert.rejects(() => session.settled({ maxIdleMs: 50 }), (error: unknown) => error instanceof RunStalledError && error.pendingInteractions.length === 1);
  await policy.permission?.({
    kind: "permission",
    id: "policy",
    sessionId: session.id,
    permission: "write",
    patterns: ["src/**"],
    always: [],
    metadata: { filepath: "src/generated/api.ts" },
    disableAlways: false,
    signal: new AbortController().signal,
    allow: async () => undefined,
    deny: async () => undefined,
    decline: () => undefined
  });
  await session.dispose();
  server.close();
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), milliseconds))
  ]);
}
