import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import { McpStdioServer, mcpStdioServerCommand, mcpStdioSettingsSnippet } from "../src/testing/mcp-stdio-server.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

test("session tool views filter MCP metadata and the degraded resource helper uses mcp_resource", async () => {
  const server = new MockDoMoServer({ toolCatalog: [
    { name: "read", source: "builtIn", inputSchema: { type: "object" }, permission: "allowed" },
    { name: "github_search", source: "mcp", inputSchema: { type: "object" }, permission: "requiresApproval", metadata: { mcpServer: "github", mcpTransport: "stdio" } },
    { name: "hidden", source: "mcp", inputSchema: { type: "object" }, hiddenReason: "denied", metadata: { mcpServer: "github", mcpTransport: "stdio" } }
  ] });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch });
  const session = await client.sessions.create();
  assert.deepEqual((await session.tools({ source: "mcp" })).map((tool) => tool.name), ["github_search"]);
  assert.deepEqual((await session.tools({ source: "mcp", includeHidden: true })).map((tool) => tool.name), ["github_search", "hidden"]);
  assert.deepEqual((await session.tools({ mcpServer: "github", permission: "requiresApproval" })).map((tool) => tool.name), ["github_search"]);
  const resource = await session.mcpResource("read", { server: "github", uri: "mcp://README" });
  assert.equal(resource.toolName, "mcp_resource");
  assert.match(resource.output, /github/);
  await client.close();
  server.close();
});

test("stdio MCP fixture handles tools, resources, prompts, and settings registration", () => {
  const fixture = new McpStdioServer({ resources: [{ uri: "fixture://one", name: "One", contents: [{ type: "text", text: "hello" }] }], prompts: [{ name: "review" }] });
  const initialized = fixture.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal((initialized?.result as { serverInfo: { name: string } }).serverInfo.name, "domocode-mcp-fixture");
  const resource = fixture.handle({ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "fixture://one" } });
  assert.deepEqual((resource?.result as { contents: unknown[] }).contents, [{ type: "text", text: "hello" }]);
  const prompt = fixture.line(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "review" } }));
  assert.match(prompt ?? "", /fixture prompt: review/);
  const command = mcpStdioServerCommand();
  assert.equal(command.command, process.execPath);
  assert.equal(command.args[1], "--config");
  assert.match(mcpStdioSettingsSnippet(), /domocode-fixture/);
});
