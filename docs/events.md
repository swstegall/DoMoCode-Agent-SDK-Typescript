# Event and wire contract

The SDK speaks DoMoCode protocol version 1. A session event stream is
`GET /session/{id}/events?after=<sequence>` and uses fetch-streamed SSE frames:

```text
data: {"type":"connected","protocolVersion":1,"sessionId":"...","running":false}

```

The opening `connected` frame is followed by `heartbeat` frames while the stream is idle.
Every other known frame has a monotonically increasing `sequence` field. The SDK remembers the
last sequence, reconnects with `after`, and reconciles pending permissions/questions after a
reconnect. It treats a stream silent beyond the heartbeat watchdog as dead and retries with
bounded backoff.

## Known frames

The v1 discriminator set is:

`connected`, `heartbeat`, `agent_start`, `agent_end`, `turn_start`, `turn_end`,
`message_start`, `message_delta`, `message_end`, `tool_start`, `tool_end`,
`permission_request`, `permission_resolved`, `question_request`, `question_resolved`,
`queue_update`, `notice`, `subagent`, `mcp_changed`, `oauth_request`, `oauth_resolved`,
`client_tool_request`, and `client_tool_resolved`.

`message_start`/`message_end` carry a nested `message`; `notice` carries `notice`; and
`subagent` carries `subagent`. `sessionID` in Swift becomes `sessionId` on the wire. Tool and
client-tool arguments are JSON values, not shell strings.

The decoder is intentionally forward-compatible. Unknown frame types become
`{ type, raw }`; unknown enum values remain open strings. A changed `protocolVersion` on the
connected frame is different: it is a hard compatibility failure because the framing contract
may have changed.

## REST replies and ownership

Events are edges, not the authoritative state. Use `/status`, `/permissions`, `/questions`,
`/messages`, and `/context` as level-triggered reads after reconnects or when a stream was
overrun. Mutating routes require the current session authority; a second SDK or a TUI can still
observe the stream as an `observer`.

Client-defined tools are registered in the `POST /session` body as
`clientTools: [{name, description, inputSchema}]`. A model call emits
`client_tool_request {id, sessionId, name, arguments}`. The handler answers with:

```json
{
  "requestID": "...",
  "output": "rows: 1",
  "isError": false,
  "images": [{"mediaType":"image/png","data":"..."}]
}
```

The server emits `client_tool_resolved` even when a request times out or is drained by abort,
force-clear, or shutdown. Late and duplicate replies are safe and return `accepted: false`.

The checked-in [protocol schema](../schema/protocol.schema.json) and
[interaction schema](../schema/interactions.schema.json) are the machine-readable references.
