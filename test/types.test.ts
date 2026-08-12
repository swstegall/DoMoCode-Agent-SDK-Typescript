import test from "node:test";
import assert from "node:assert/strict";
import { decodeServerEvent } from "../src/types/events.ts";
import { parseDecimal } from "../src/types/decimal.ts";
import { decodeMessage } from "../src/types/messages.ts";

test("decodes the nested message event envelopes", () => {
  const event = decodeServerEvent({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      model: "mock",
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: {} },
      stopReason: "future_reason"
    }
  });
  assert.equal(event.type, "message_end");
  assert.equal((event as { message: { role: string } }).message.role, "assistant");
});

test("preserves unknown event types and open enum values", () => {
  const future = decodeServerEvent({ type: "future_frame", payload: { answer: 42 } });
  assert.equal(future.type, "future_frame");
  assert.deepEqual((future as { raw: unknown }).raw, { type: "future_frame", payload: { answer: 42 } });
  const ended = decodeServerEvent({ type: "agent_end", reason: "future_reason" });
  assert.equal(ended.type, "agent_end");
  assert.equal((ended as { reason: string }).reason, "future_reason");
});

test("parses exponent decimal strings exactly", () => {
  assert.equal(parseDecimal("1e-05").toString(), "0.00001");
  assert.equal(parseDecimal("100.25").add(parseDecimal("0.75")).toString(), "101");
});

test("rejects malformed known frames", () => {
  assert.throws(() => decodeServerEvent({ type: "connected", protocolVersion: 1 }), /sessionId/);
  assert.throws(() => decodeMessage({ role: "assistant", content: [] }), /model|usage/);
});
