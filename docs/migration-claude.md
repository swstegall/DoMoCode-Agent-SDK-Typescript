# Migrating from the Claude Agent SDK

The SDK borrows the useful shape of Claude's high-level query API while keeping DoMoCode's
server-owned architecture. This table is the deliberate compatibility boundary:

| Claude Agent SDK concept | DoMoCode SDK equivalent | Ownership difference |
| --- | --- | --- |
| `query({prompt})` | `query({baseURL, token, prompt})` or `client.sessions.create()` + `run()` | DoMoCode runs in `domo --serve`; the SDK is a peer HTTP client. |
| Async generator messages | `QueryStream` async iterator of init + typed `ServerEvent` | SSE is resumable and sequence-aware. |
| `canUseTool` permission callback | `onInteraction`, `onPermission`, `permissionPolicy`, or `yolo()` | The server permission engine remains authoritative. |
| `AskUserQuestion` | `question_request` + `QuestionAsk.answer()` | Answers are REST replies correlated by request id. |
| SDK hooks | Server-side DoMoCode hooks and notices | Client code does not intercept server tool execution. |
| MCP server configuration | `client.mcp` catalog/admin/OAuth helpers | MCP connections and durable credentials stay on the server. |
| `outputFormat` | Parse/validate the final `Message` or `finalText()` client-side | No runtime schema dependency is bundled. |
| subagents/handoffs | `session.subagents()`, workflows, jobs, and handoffs | Child sessions are real server sessions with their own authority boundary. |
| in-process cancellation | `session.abort()` / `forceClear()` | Cancellation crosses HTTP and is cooperative on the server. |

If a script needs model-independent tool execution, use `session.executeTool()`. If the model
must call application code, register a `clientTools` definition at session creation and install
`session.onToolCall()` before the first prompt.
