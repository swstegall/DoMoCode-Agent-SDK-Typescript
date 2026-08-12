import test from "node:test";
import assert from "node:assert/strict";
import { Transport } from "../src/transport.ts";
import { PayloadTooLargeError, UnauthorizedError } from "../src/types/errors.ts";
import { isUuidv7, uuidv7 } from "../src/uuid.ts";

function response(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("transport sends auth and identity headers and decodes JSON", async () => {
  let seen: RequestInit | undefined;
  const transport = new Transport({
    baseURL: "http://example.test",
    token: "secret-token",
    clientId: "client",
    owner: "owner",
    fetch: async (_input, init) => { seen = init; return response(200, { ok: true }); }
  });
  const value = await transport.json<{ ok: boolean }>("/session/a/b", { method: "POST", body: { prompt: "hi" } });
  assert.deepEqual(value, { ok: true });
  const headers = seen?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer secret-token");
  assert.equal(headers["x-domocode-client-id"], "client");
  assert.equal(headers["x-domocode-client-owner"], "owner");
});

test("transport maps status errors without leaking the bearer token", async () => {
  const transport = new Transport({ baseURL: "http://example.test", token: "secret-token", fetch: async () => response(401, "Authorization: Bearer secret-token") });
  await assert.rejects(() => transport.json("/status"), (error: unknown) => {
    assert.ok(error instanceof UnauthorizedError);
    assert.doesNotMatch(String(error), /secret-token/);
    return true;
  });
});

test("transport enforces prompt image ceilings before fetch", async () => {
  const transport = new Transport({ baseURL: "http://example.test", token: "token", fetch: async () => response(200, {}) });
  await assert.rejects(() => transport.json("/session/id/prompt", { method: "POST", body: { prompt: "x", images: new Array(9).fill({ data: "" }) } }), PayloadTooLargeError);
});

test("uuidv7 is valid and monotonic within one millisecond", () => {
  const values = [uuidv7(10), uuidv7(10), uuidv7(10)];
  assert.ok(values.every(isUuidv7));
  const [first, second, third] = values;
  assert.ok(first !== undefined && second !== undefined && third !== undefined);
  assert.ok(first < second && second < third);
});
