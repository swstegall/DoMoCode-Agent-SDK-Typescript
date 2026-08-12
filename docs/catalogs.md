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

MCP prompts are projected into the same command catalog. Their descriptors have
`source: "mcp"`; invoke one through the normal prompt lifecycle with string arguments:

```ts
const mcpCommands = (await client.catalogs.commands()).filter((command) => command.source === "mcp");
await session.invokePromptCommand(mcpCommands[0].name, { topic: "Swift" });
```

The server fetches and renders the MCP prompt before handing it to the agent, so prompt
permissions, events, transcripts, and settlement remain identical to an ordinary prompt.

`session.transcript()` and the standalone `renderTranscript()` helpers produce deterministic
Markdown or escaped HTML from the lossless `/messages` projection. Base64 image bytes are
never embedded; image media types are emitted as placeholders. Tool calls/results and
reasoning are retained by default.

## MCP administration and fallback

When the server advertises the MCP admin surface, the process-scoped MCP catalog is
available through `client.mcp`:

```ts
const servers = await client.mcp.servers();
const resources = await client.mcp.resources("github");
const templates = await client.mcp.resourceTemplates("github");
const contents = await client.mcp.readResource("github", "mcp://README");
const health = await client.mcp.health("github");
```

Status and resource/template reads use a short cache by default. Pass `{ maxAgeMs: 0 }`
for an immediate read, or call `client.mcp.invalidate(server)` after an out-of-band change.
Session event engines invalidate the affected server automatically when the server emits
an `mcp_changed` frame. The SDK consumes these projections; it never starts an MCP process
or handles MCP credentials.

On older servers without the admin routes, filter the live session catalog and use the
server-owned `mcp_resource` direct tool:

```ts
const mcpTools = await session.tools({ source: "mcp", mcpServer: "github" });
await session.mcpResource("read", { server: "github", uri: "mcp://README" });
```

The public testing subpath ships `McpStdioServer`, `mcpStdioServerCommand()`, and
`mcpStdioSettingsSnippet()` for a deterministic stdio fixture.
