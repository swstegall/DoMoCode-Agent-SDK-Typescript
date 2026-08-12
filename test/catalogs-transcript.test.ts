import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import { renderHTMLTranscript, renderMarkdownTranscript } from "../src/transcript.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

test("catalogs decode the live server surfaces and model reads use a TTL", async () => {
  const server = new MockDoMoServer();
  let modelRequests = 0;
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (new URL(input instanceof Request ? input.url : input.toString()).pathname === "/models") modelRequests += 1;
    return server.fetch(input, init);
  };
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch, clientId: "catalog-client", owner: "tests" });
  const commands = await client.catalogs.commands();
  assert.equal(commands.commands[0]?.name, "help");
  const agents = await client.catalogs.agents();
  assert.equal(agents[0]?.name, "default");
  const firstModels = await client.catalogs.models();
  const secondModels = await client.catalogs.models();
  assert.deepEqual(secondModels, firstModels);
  assert.equal(modelRequests, 1);
  client.catalogs.invalidateModels();
  await client.catalogs.models({ maxAgeMs: 0 });
  assert.equal(modelRequests, 2);
  assert.deepEqual(await client.catalogs.memory(), []);
  await client.close();
  server.close();
});

test("skills catalog keeps bodies opt-in", async () => {
  const server = new MockDoMoServer({ skillCatalog: [{
    name: "review",
    description: "Review changes",
    keywords: ["diff"],
    argumentHint: "focus",
    disableModelInvocation: true,
    toolAllowlist: ["read"],
    source: "project",
    body: "Secret skill instructions"
  }] });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch });
  const metadata = await client.catalogs.skills();
  assert.equal(metadata[0]?.body, undefined);
  assert.equal(metadata[0]?.disableModelInvocation, true);
  const withBody = await client.catalogs.skills({ includeBody: true });
  assert.equal(withBody[0]?.body, "Secret skill instructions");
  await client.close();
  server.close();
});

test("session tools and direct execution round-trip through the live catalog", async () => {
  const server = new MockDoMoServer();
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "tool-client", owner: "tests" });
  const session = await client.sessions.create();
  const tools = await session.tools();
  assert.equal(tools[0]?.name, "read");
  assert.equal(tools[0]?.inputSchema.type, "object");
  const result = await session.executeTool("read", { path: "README.md" });
  assert.equal(result.toolName, "read");
  assert.match(result.output, /mock \/read/);
  const raw = await session.executeToolCommand("/read --path README.md");
  assert.equal(raw.isError, false);
  await client.close();
  server.close();
});

test("transcript renderers preserve visible text, tool details, and escape HTML", () => {
  const messages = [{
    role: "user" as const,
    content: [{ type: "text" as const, text: "Inspect <README>" }]
  }, {
    role: "assistant" as const,
    content: [
      { type: "text" as const, text: "I checked it." },
      { type: "toolCall" as const, id: "call-1", name: "read", arguments: { path: "README.md" } }
    ],
    model: "mock",
    usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: { input: "0", output: "0", cacheRead: "0", cacheWrite: "0" } },
    stopReason: "stop" as const
  }];
  const markdown = renderMarkdownTranscript(messages);
  assert.match(markdown, /# DoMoCode transcript/);
  assert.match(markdown, /Inspect <README>/);
  assert.match(markdown, /\*\*Tool call\*\* `read`/);
  const html = renderHTMLTranscript(messages);
  assert.match(html, /&lt;README&gt;/);
  assert.match(html, /class="tool-call"/);
  assert.doesNotMatch(html, /<README>/);
});
