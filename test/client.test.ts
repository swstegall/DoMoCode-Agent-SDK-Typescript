import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import { AuthorityUnavailableError, ForbiddenError, SessionAlreadyAcquiredError } from "../src/types/errors.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

test("client creates, attaches, runs, and disposes without aborting", async () => {
  const server = new MockDoMoServer();
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "client-one", owner: "tests" });
  const session = await client.sessions.create();
  assert.equal(session.role, "authority");
  const result = await session.run("hello", { maxIdleMs: 1_000 });
  assert.equal(result.stopReason, "completed");
  assert.ok(result.messages.some((message) => message.role === "assistant"));
  await session.dispose();
  assert.equal((await server.fetch(`${server.baseURL}/sessions`, { headers: { authorization: `Bearer ${server.token}` } })).status, 200);
  server.close();
});

test("authority is explicit and observer mutation is rejected", async () => {
  const server = new MockDoMoServer();
  const first = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "authority", owner: "one" });
  const root = await first.sessions.create();
  const second = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "observer", owner: "two" });
  const observer = await second.sessions.open(root.id, { authority: "prefer" });
  assert.equal(observer.role, "observer");
  await assert.rejects(() => observer.prompt("no"), ForbiddenError);
  await assert.rejects(() => second.sessions.open(root.id, { authority: "require" }), AuthorityUnavailableError);
  await observer.dispose();
  await root.dispose();
  server.close();
});

test("per-process exclusive acquisition rejects a second driver", async () => {
  const server = new MockDoMoServer();
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "client", owner: "tests" });
  const root = await client.sessions.create({ authority: "prefer" });
  const first = await client.sessions.acquire(root.id, { mode: "exclusive", authority: "prefer" });
  await assert.rejects(() => client.sessions.acquire(root.id, { mode: "exclusive", authority: "prefer" }), SessionAlreadyAcquiredError);
  await first.release();
  await root.dispose();
  server.close();
});
