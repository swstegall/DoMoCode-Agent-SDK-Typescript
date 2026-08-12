import test from "node:test";
import assert from "node:assert/strict";
import { EventEngine } from "../src/eventEngine.ts";
import { FaultInjector } from "../src/testing/fault-injector.ts";
import { readSSEJson } from "../src/sse.ts";

function response(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "content-length": String(body.length) } });
}

test("FaultInjector fragments UTF-8 SSE bytes and preserves decoded events", async () => {
  const raw = `data: ${JSON.stringify({ type: "notice", notice: { level: "info", code: "fragment", text: "café 🧪" } })}\n\n`;
  const injector = new FaultInjector({ chunkSize: 1 });
  const wrapped = injector.fetch(async () => response(raw));
  const values: unknown[] = [];
  for await (const value of readSSEJson(await wrapped("http://example.test/events"))) values.push(value);
  assert.equal((values[0] as { notice: { text: string } }).notice.text, "café 🧪");
  assert.equal(injector.stats.requests, 1);
  assert.equal(injector.stats.responses, 1);
  assert.equal(injector.stats.bytes, new TextEncoder().encode(raw).byteLength);
});

test("FaultInjector can truncate a stream for reconnect tests", async () => {
  const injector = new FaultInjector({ chunkSize: 2, truncateAfterBytes: 5 });
  const wrapped = injector.fetch(async () => response("data: {}\n\n"));
  const result = await (await wrapped("http://example.test/events")).text();
  assert.equal(result.length, 5);
  assert.equal(injector.stats.truncated, 1);
});

test("fragmented EventEngine frames still settle and preserve sequence state", async () => {
  const injector = new FaultInjector({ chunkSize: 1 });
  let calls = 0;
  const engine = new EventEngine({
    open: async () => {
      calls += 1;
      const payload = [
        { type: "connected", protocolVersion: 1, sessionId: "session" },
        { type: "agent_end", reason: "completed", sequence: 1 }
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
      return injector.fetch(async () => response(payload))("http://example.test/events");
    },
    heartbeatTimeoutMs: 100,
    initialBackoffMs: 1,
    maximumBackoffMs: 2
  });
  await engine.waitForConnected();
  const connected = await engine.next();
  assert.equal(connected.value?.type, "connected");
  const ended = await engine.next();
  assert.equal(ended.value?.type, "agent_end");
  assert.equal(engine.lastSequence, 1);
  assert.equal(calls, 1);
  await engine.stop();
});
