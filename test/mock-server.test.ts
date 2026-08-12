import test from "node:test";
import assert from "node:assert/strict";
import { decodeSequencedServerEvent } from "../src/types/events.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";
import { MockDoMoTcpServer } from "../src/testing/mock-do-mo-server-node.ts";

test("mock server supports authenticated sessions and status", async () => {
  const server = new MockDoMoServer();
  const transport = server.transport({ clientId: "client", owner: "test" });
  const session = await transport.json<{ id: string; path: string }>("/session", { method: "POST", body: {} });
  assert.ok(session.id);
  const status = await transport.json<{ sessionId: string; running: boolean }>(`/session/${encodeURIComponent(session.id)}/status`);
  assert.equal(status.sessionId, session.id);
  assert.equal(status.running, false);
  server.close();
});

test("mock server retains sequenced events and reconciles pending permissions", async () => {
  const server = new MockDoMoServer({ autoComplete: false });
  const transport = server.transport();
  const session = await transport.json<{ id: string }>("/session", { method: "POST", body: {} });
  await server.requestPermission(session.id, { id: "per_1", sessionId: session.id, permission: "bash", patterns: ["git *"], always: [], metadata: {}, disableAlways: false });
  const pending = await transport.json<Array<{ id: string }>>(`/session/${session.id}/permissions`);
  assert.deepEqual(pending.map((item) => item.id), ["per_1"]);
  const sequence = server.emit(session.id, { type: "agent_end", reason: "future_reason" });
  assert.equal(sequence, 2);
  const response = await server.fetch(`${server.baseURL}/session/${session.id}/events?after=0`, { headers: { authorization: `Bearer ${server.token}` } });
  const reader = response.body?.getReader();
  assert.ok(reader);
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /connected/);
  await reader.cancel();
  server.close();
});

test("TCP mock server exposes opt-in CORS for browser-shaped requests", async () => {
  const origin = "http://127.0.0.1:3000";
  const mock = new MockDoMoServer({ corsOrigins: [origin] });
  const tcp = await MockDoMoTcpServer.start({ server: mock });
  try {
    const preflight = await fetch(`${tcp.baseURL}/session`, {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization" }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);

    const capabilities = await fetch(`${tcp.baseURL}/capabilities`, {
      headers: { origin, authorization: `Bearer ${mock.token}` }
    });
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual((await capabilities.json()).capabilities.includes("cors"), true);
  } finally {
    await tcp.close();
  }
});
