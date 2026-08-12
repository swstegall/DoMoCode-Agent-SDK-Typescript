import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";
import { decodeServerEvent } from "../src/types/events.ts";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("MCP admin client reads typed status, resource, template, and health projections", async () => {
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    if (url.pathname === "/mcp") return json({ github: { status: "connected", transport: "stdio", toolCount: 2, endpoint: "stdio" } });
    if (url.pathname.endsWith("/resources")) return json([{ server: "github", uri: "mcp://README", name: "README", mimeType: "text/plain" }]);
    if (url.pathname.endsWith("/resource-templates")) return json([{ server: "github", uriTemplate: "mcp://issues/{id}", name: "Issue" }]);
    if (url.pathname.endsWith("/health")) return json([{ server: "github", healthy: true }]);
    if (url.pathname.endsWith("/resource")) return json({ server: "github", uri: "mcp://README", contents: [{ type: "text", text: "hello" }] });
    throw new Error(`unexpected route ${url.pathname}`);
  };
  const client = new DoMoCodeClient({ baseURL: "http://example.test", token: "token", fetch });

  const first = await client.mcp.servers();
  assert.equal(first.github?.status, "connected");
  await client.mcp.servers();
  assert.equal(requests.filter((request) => request.path === "/mcp").length, 1);
  assert.deepEqual(await client.mcp.resources("github"), [{ server: "github", uri: "mcp://README", name: "README", mimeType: "text/plain" }]);
  assert.deepEqual(await client.mcp.resourceTemplates("github"), [{ server: "github", uriTemplate: "mcp://issues/{id}", name: "Issue" }]);
  assert.deepEqual(await client.mcp.readResource("github", "mcp://README"), { server: "github", uri: "mcp://README", contents: [{ type: "text", text: "hello" }] });
  assert.deepEqual(await client.mcp.health("github"), [{ server: "github", healthy: true }]);
  assert.deepEqual(requests.find((request) => request.path.endsWith("/resource"))?.body, { uri: "mcp://README" });

  client.mcp.invalidate("github");
  await client.mcp.servers();
  assert.equal(requests.filter((request) => request.path === "/mcp").length, 2);
});

test("MCP changed frames decode and identify the affected server", () => {
  assert.deepEqual(decodeServerEvent({ type: "mcp_changed", server: "github" }), { type: "mcp_changed", server: "github" });
});

test("MCP connect delegates an authorization URL and logout invalidates the catalog", async () => {
  let opened: string | undefined;
  const server = new MockDoMoServer({
    mcpConnectResults: {
      github: { status: "needs_auth", authorizationUrl: "https://auth.example.test/start", flowId: "flow-1", initiator: "client-1" }
    },
    mcpLogoutResults: { github: { status: "needs_auth" } }
  });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch });

  const connect = await client.mcp.connect("github", { openAuthorization: (url) => { opened = url; return true; } });
  assert.deepEqual(connect, { status: "needs_auth", authorizationUrl: "https://auth.example.test/start", flowId: "flow-1", initiator: "client-1" });
  assert.equal(opened, "https://auth.example.test/start");
  assert.deepEqual(await client.mcp.logout("github"), { status: "needs_auth" });

  await client.close();
  server.close();
});

test("MCP admin decoders reject malformed status and resource payloads", async () => {
  const client = new DoMoCodeClient({
    baseURL: "http://example.test",
    token: "token",
    fetch: async (input) => new Response(JSON.stringify(new URL(input instanceof Request ? input.url : input.toString()).pathname === "/mcp" ? { github: { status: "connected" } } : []), { status: 200 })
  });
  await assert.rejects(() => client.mcp.servers({ maxAgeMs: 0 }), /MCP transport/);
});

test("prompt commands use the ordinary session prompt channel", async () => {
  let received: string | undefined;
  const server = new MockDoMoServer({ promptHandler: ({ prompt }) => { received = prompt; } });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch });
  const session = await client.sessions.create();
  await session.invokePromptCommand("mcp_github_summarize", { topic: "Swift" });
  await session.settled();
  assert.equal(received, '/mcp_github_summarize {"topic":"Swift"}');
  await client.close();
  server.close();
});
