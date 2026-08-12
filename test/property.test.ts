import test from "node:test";
import assert from "node:assert/strict";
import { parseDecimal } from "../src/types/decimal.ts";
import { scrubSecrets } from "../src/testing/capture.ts";
import { isUuidv7, uuidv7 } from "../src/uuid.ts";
import { readSSEJson } from "../src/sse.ts";

test("SSE decoding survives deterministic arbitrary byte chunk boundaries", async () => {
  for (let size = 1; size <= 32; size += 1) {
    const payload = Array.from({ length: 5 }, (_, index) => `data: ${JSON.stringify({ type: "notice", notice: { level: "info", code: `fuzz_${index}`, text: `frame-${index}-café` } })}\n\n`).join("");
    const bytes = new TextEncoder().encode(payload);
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
        controller.close();
      }
    }));
    const values: unknown[] = [];
    for await (const value of readSSEJson(response)) values.push(value);
    assert.equal(values.length, 5);
    assert.equal((values[4] as { notice: { text: string } }).notice.text, "frame-4-café");
  }
});

test("decimal parsing is stable across generated scientific forms", () => {
  for (let index = 1; index <= 250; index += 1) {
    const sign = index % 2 === 0 ? "-" : "";
    const whole = String(index * 37);
    const fraction = String(index * 13).padStart(4, "0");
    const exponent = index % 11 - 5;
    const input = `${sign}${whole}.${fraction}e${exponent >= 0 ? "+" : ""}${exponent}`;
    const normalized = parseDecimal(input).toString();
    assert.equal(parseDecimal(normalized).toString(), normalized);
    assert.equal(parseDecimal(input).add(parseDecimal("0")).toString(), normalized);
  }
});

test("UUIDv7 generation preserves shape and monotonicity", () => {
  const values = Array.from({ length: 500 }, () => uuidv7(Date.now() + 1_000_000));
  assert.ok(values.every(isUuidv7));
  for (let index = 1; index < values.length; index += 1) assert.ok(values[index - 1]! < values[index]!);
});

test("secret redaction is recursive and does not alter ordinary fields", () => {
  for (let index = 0; index < 100; index += 1) {
    const value = {
      Authorization: `Bearer secret-${index}`,
      nested: { refresh_token: `refresh-${index}`, apiKey: `key-${index}`, visible: index, array: [{ token: `token-${index}` }, "safe"] },
      message: "safe"
    };
    const redacted = scrubSecrets(value) as typeof value;
    assert.equal(redacted.Authorization, "[REDACTED]");
    assert.equal(redacted.nested.refresh_token, "[REDACTED]");
    assert.equal(redacted.nested.apiKey, "[REDACTED]");
    assert.equal((redacted.nested.array[0] as { token: string }).token, "[REDACTED]");
    assert.equal(redacted.nested.visible, index);
    assert.equal(redacted.message, "safe");
  }
});
