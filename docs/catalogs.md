# Catalogs, direct tools, and transcripts

The server remains the authority for live catalogs. The SDK does not bundle a stale copy
of the tool list:

```ts
const commands = await client.catalogs.commands();
const agents = await client.catalogs.agents();
const models = await client.catalogs.models();
const tools = await session.tools();
```

Model reads are cached for 30 seconds by default because the server may refresh a gateway
catalog. Pass `{ maxAgeMs: 0 }` for an immediate read or call `invalidateModels()`. Tool
catalog reads are always live because mode, permission, MCP, and subagent state can change
the callable set between turns. Unknown `source`, `permission`, and command values are
preserved as open strings.

Direct tool execution has two forms:

```ts
await session.executeTool("read", { path: "README.md" });
await session.executeToolCommand('/read --path "README.md"');
```

`executeTool()` encodes the argument object as the server parser's explicit JSON-object
form, avoiding a second client-side flag grammar. `executeToolCommand()` is the raw slash
command escape hatch. Both return `DirectToolResult`; image payloads are represented by
`imageCount` until the server's additive image-result route is available.

`session.transcript()` and the standalone `renderTranscript()` helpers produce deterministic
Markdown or escaped HTML from the lossless `/messages` projection. Base64 image bytes are
never embedded; image media types are emitted as placeholders. Tool calls/results and
reasoning are retained by default.

## MCP fallback

Until the server exposes MCP administration routes, filter the live session catalog and use
the server-owned `mcp_resource` direct tool:

```ts
const mcpTools = await session.tools({ source: "mcp", mcpServer: "github" });
await session.mcpResource("read", { server: "github", uri: "mcp://README" });
```

The SDK never starts an MCP process or handles MCP credentials. The public testing subpath
ships `McpStdioServer`, `mcpStdioServerCommand()`, and `mcpStdioSettingsSnippet()` for a
deterministic stdio fixture.
