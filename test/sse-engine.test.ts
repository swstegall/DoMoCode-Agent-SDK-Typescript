import test from "node:test";
import assert from "node:assert/strict";
import { EventEngine } from "../src/eventEngine.ts";
import { readSSEJson } from "../src/sse.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

function fragmentedResponse(frames: string[], splitAt: number[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(frames.join(""));
      let offset = 0;
      for (const end of splitAt) { controller.enqueue(bytes.slice(offset, end)); offset = end; }
      controller.enqueue(bytes.slice(offset));
      controller.close();
    }
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

test("SSE reader splits bytes before UTF-8 decoding", async () => {
  const payload = `data: ${JSON.stringify({ type: "notice", notice: { level: "info", code: "utf8", text: "café" } })}\n\n`;
  const bytes = new TextEncoder().encode(payload);
  const index = bytes.indexOf(0xc3) + 1;
  const values: unknown[] = [];
  for await (const value of readSSEJson(fragmentedResponse([payload], [index]))) values.push(value);
  assert.equal((values[0] as { notice: { text: string } }).notice.text, "café");
});

test("event engine reconciles pending permissions and deduplicates replay", async () => {
  const server = new MockDoMoServer({ autoComplete: false });
  const session = await server.createSession();
  const transport = server.transport();
  await server.requestPermission(session.id, { id: "per_1", sessionId: session.id, permission: "bash", patterns: ["git *"], always: [], metadata: {}, disableAlways: false });
  const engine = new EventEngine({
    open: (after, signal) => server.fetch(`${server.baseURL}/session/${session.id}/events?after=${after}`, { headers: { authorization: `Bearer ${server.token}` }, signal }),
    reconcile: async () => transport.json(`/session/${session.id}/permissions`),
    heartbeatTimeoutMs: 100,
    initialBackoffMs: 1,
    maximumBackoffMs: 4
  });
  const iterator = engine[Symbol.asyncIterator]();
  const connected = await iterator.next();
  assert.equal(connected.value?.type, "connected");
  const permission = await iterator.next();
  assert.equal(permission.value?.type, "permission_request");
  server.emit(session.id, { type: "agent_end", reason: "completed" });
  const ended = await iterator.next();
  assert.equal(ended.value?.type, "agent_end");
  assert.equal(engine.lastSequence, 2);
  await engine.stop();
  server.close();
});

test("unknown agent-end reasons stay observable through the engine", async () => {
  const server = new MockDoMoServer({ autoComplete: false });
  const session = await server.createSession();
  const engine = new EventEngine({
    open: (after, signal) => server.fetch(`${server.baseURL}/session/${session.id}/events?after=${after}`, { headers: { authorization: `Bearer ${server.token}` }, signal }),
    heartbeatTimeoutMs: 100,
    initialBackoffMs: 1,
    maximumBackoffMs: 4
  });
  const iterator = engine[Symbol.asyncIterator]();
  await iterator.next();
  server.emit(session.id, { type: "agent_end", reason: "future_reason" });
  const event = await iterator.next();
  assert.equal((event.value as { reason: string }).reason, "future_reason");
  await engine.stop();
  server.close();
});
