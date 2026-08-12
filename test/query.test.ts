import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import { query, runQuery } from "../src/query.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

test("query emits an init snapshot, streams events, and exposes independent result collectors", async () => {
  const server = new MockDoMoServer();
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "query-client", owner: "tests" });
  const stream = query({ server: client, prompt: "hello", maxIdleMs: 1_000 });
  const events = [];
  for await (const event of stream) events.push(event);
  const result = await stream.result;
  assert.equal(events[0]?.type, "init");
  assert.ok(events.some((event) => event.type === "message_end"));
  assert.equal(result.stopReason, "completed");
  assert.match(await stream.finalText(), /Mock response: hello/);
  assert.match(await stream.transcript(), /Mock response: hello/);
  await client.close();
  server.close();
});

test("query result is pumped without consuming the event iterator", async () => {
  const server = new MockDoMoServer();
  const result = await runQuery({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, prompt: "no iterator", maxIdleMs: 1_000 });
  assert.equal(result.messages.at(-1)?.role, "assistant");
  assert.equal(result.stopReason, "completed");
  server.close();
});

test("query wires permission handlers and respects the persistent-grant guard", async () => {
  const server = new MockDoMoServer({
    promptHandler: ({ sessionId }) => ({ events: [{ type: "permission_request", id: "per_query", sessionId, permission: "write", patterns: ["src/**"], always: ["src/**"], metadata: { filepath: "src/main.ts" }, disableAlways: false }] })
  });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "query-permission", owner: "tests" });
  let allowed = 0;
  const stream = query({ server: client, prompt: "permission", onPermission: async (ask) => { allowed += 1; await ask.allow(); }, maxIdleMs: 1_000 });
  const result = await stream.result;
  assert.equal(allowed, 1);
  assert.equal(result.stopReason, "completed");
  await client.close();
  server.close();
});

test("streaming-input query accepts an async iterable", async () => {
  const server = new MockDoMoServer();
  async function* prompts(): AsyncIterable<string> { yield "first"; }
  const result = await runQuery(prompts(), { baseURL: server.baseURL, token: server.token, fetch: server.fetch, maxIdleMs: 1_000 });
  const last = result.messages.at(-1);
  assert.equal(last?.role, "assistant");
  if (last?.role === "assistant") assert.equal(last.content[0]?.type, "text");
  server.close();
});
