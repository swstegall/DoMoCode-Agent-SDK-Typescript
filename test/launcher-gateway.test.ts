import test from "node:test";
import assert from "node:assert/strict";
import { launchServer, parseHandshakeLine } from "../src/node/launcher.ts";
import { ScriptedMockGateway } from "../src/testing/gateway.ts";

test("launcher handshake parsing tolerates interleaved stderr", () => {
  let state = parseHandshakeLine("log before");
  state = parseHandshakeLine("Authorization: Bearer abc123", state);
  state = parseHandshakeLine("domo --serve — listening on http://127.0.0.1:4100 (loopback only)", state);
  assert.deepEqual(state, { token: "abc123", baseURL: "http://127.0.0.1:4100" });
});

test("minimal launcher spawns, handshakes, and closes", async () => {
  const script = "console.error('Authorization: Bearer abc123'); console.error('domo --serve — listening on http://127.0.0.1:43123 (loopback only)'); setTimeout(() => {}, 10000)";
  const server = await launchServer({ command: process.execPath, commandArgs: ["-e", script], appendServeArgs: false, isolated: true, timeoutMs: 2_000 });
  assert.equal(server.token, "abc123");
  assert.equal(server.baseURL, "http://127.0.0.1:43123");
  await server.close();
});

test("scripted gateway serves deterministic streaming completions", async () => {
  const gateway = await new ScriptedMockGateway({ responses: [{ text: "hello world" }] }).start();
  const response = await fetch(`${gateway.baseURL}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "hi" }] }) });
  const text = await response.text();
  assert.match(text, /"content":"hell/);
  assert.match(text, /\[DONE\]/);
  assert.equal(gateway.requestLog.length, 1);
  await gateway.close();
});
