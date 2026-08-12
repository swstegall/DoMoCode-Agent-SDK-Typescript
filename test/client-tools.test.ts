import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import type { ClientToolDefinition } from "../src/types/tools.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

const databaseTool: ClientToolDefinition = {
  name: "database_query",
  description: "Run a read-only database query.",
  inputSchema: {
    type: "object",
    properties: { sql: { type: "string" } },
    required: ["sql"]
  }
};

test("client-defined tools are registered, executed, and resolved through the SDK", async () => {
  const server = new MockDoMoServer({
    promptHandler: ({ sessionId }) => ({
      events: [{ type: "client_tool_request", id: "request_1", sessionId, name: databaseTool.name, arguments: { sql: "select 1" } }]
    })
  });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "client-tool-test", owner: "tests" });
  const session = await client.sessions.create({ clientTools: [databaseTool] });
  const catalog = await session.tools();
  assert.equal(catalog.find((tool) => tool.name === databaseTool.name)?.metadata?.clientDefined, true);
  const seen: string[] = [];
  const unsubscribeEvents = session.onEvent((event) => seen.push(event.type));
  let receivedArguments: unknown;
  const unsubscribeTool = session.onToolCall((call) => {
    receivedArguments = call.arguments;
    assert.equal(call.name, databaseTool.name);
    return { output: "rows: 1" };
  });

  const result = await session.run("query", { maxIdleMs: 1_000 });
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(receivedArguments, { sql: "select 1" });
  assert.ok(seen.includes("client_tool_request"));
  assert.ok(seen.includes("client_tool_resolved"));
  unsubscribeTool();
  unsubscribeEvents();
  await client.close();
  server.close();
});

test("client tool handler failures and local timeouts become model-visible errors", async () => {
  const requests = ["request_failure", "request_timeout"];
  let index = 0;
  const server = new MockDoMoServer({
    promptHandler: ({ sessionId }) => ({
      events: [{ type: "client_tool_request", id: requests[index++] ?? "request_extra", sessionId, name: databaseTool.name, arguments: {} }]
    })
  });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "client-tool-errors", owner: "tests" });
  const session = await client.sessions.create({ clientTools: [databaseTool] });
  const resolved: boolean[] = [];
  session.onEvent((event) => {
    if (event.type === "client_tool_resolved" && "isError" in event) resolved.push(event.isError);
  });
  const unsubscribe = session.onToolCall(() => { throw new Error("handler failed"); });
  await session.run("failure", { maxIdleMs: 1_000 });
  unsubscribe();
  session.onToolCall(() => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 100)), { timeoutMs: 5 });
  await session.run("timeout", { maxIdleMs: 1_000 });
  assert.deepEqual(resolved, [true, true]);
  await client.close();
  server.close();
});

test("client tool definitions are validated before a session request", async () => {
  const server = new MockDoMoServer();
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch });
  await assert.rejects(
    () => client.sessions.create({ clientTools: [{ name: "bad name", description: "bad", inputSchema: {} }] }),
    /Invalid client tool name/
  );
  await client.close();
  server.close();
});
