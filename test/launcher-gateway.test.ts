import test from "node:test";
import assert from "node:assert/strict";
import { connect, launchServer, parseHandshakeLine, releaseAuthorityWhenIdle } from "../src/node/launcher.ts";
import { ScriptedMockGateway } from "../src/testing/gateway.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

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

test("launcher forwards server flags and exposes a TUI command", async () => {
  const observed: string[] = [];
  const script = "console.error(JSON.stringify(process.argv.slice(1))); console.error('Authorization: Bearer abc123'); console.error('domo --serve — listening on http://127.0.0.1:43124 (loopback only)'); setTimeout(() => {}, 10000)";
  const server = await launchServer({
    command: process.execPath,
    commandArgs: ["-e", script, "--"],
    isolated: true,
    port: 0,
    model: "mock-model",
    agent: "default",
    mode: "plan",
    maxTurns: 3,
    maxCostPerRun: "0.25",
    steeringMode: "all",
    sandbox: true,
    baseUrl: "http://gateway.test/v1",
    onStderr: (line) => observed.push(line)
  });
  assert.ok(observed.some((line) => line.includes("--max-turns") && line.includes("3")));
  assert.ok(observed.some((line) => line.includes("--sandbox")));
  assert.deepEqual(server.tuiCommand("domo-test").args, ["--url", server.baseURL, "--token", "abc123"]);
  await server.close();
});

test("TUI attachment and capability-probed connect use the existing auth seam", async () => {
  const script = "console.error('Authorization: Bearer abc123'); console.error('domo --serve — listening on http://127.0.0.1:43125 (loopback only)'); setTimeout(() => {}, 10000)";
  const server = await launchServer({ command: process.execPath, commandArgs: ["-e", script], appendServeArgs: false, isolated: true, timeoutMs: 2_000 });
  const tui = server.attachTui({ command: process.execPath, commandArgs: ["-e", "process.exit(0)", "--"], stdio: "pipe" });
  assert.equal(await tui.waitForExit(), 0);
  await server.close();

  const mock = new MockDoMoServer();
  const client = await connect({ baseURL: mock.baseURL, token: mock.token, fetch: mock.fetch, clientId: "connect-client", owner: "tests" });
  assert.equal((await client.capabilities())?.protocolVersion, 1);
  await client.close();
  mock.close();
});

test("authority release waits for an idle, ask-free session", async () => {
  const mock = new MockDoMoServer();
  const session = await (await connect({ baseURL: mock.baseURL, token: mock.token, fetch: mock.fetch, clientId: "release-client", owner: "tests" })).sessions.create();
  await releaseAuthorityWhenIdle(session, { debounceMs: 0, pollMs: 1 });
  assert.equal(session.role, "observer");
  await session.dispose();
  mock.close();
});
