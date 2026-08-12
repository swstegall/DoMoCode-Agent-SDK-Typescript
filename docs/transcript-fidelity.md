# Transcript fidelity

`session.messages()` is the lossless server transcript projection. It contains persisted user,
assistant, tool, and image metadata as the server recorded it. `session.transcript()` renders
that projection to Markdown or escaped HTML without embedding base64 image bytes.

The bytes sent to a model are not always identical to the persisted prompt bytes. DoMoCode may
decorate prompts with response-limit instructions, mode/profile instructions, workspace
context, steering messages, compaction summaries, or tool descriptions. These are runtime
context decisions and are intentionally not rewritten into the user-visible transcript.

Likewise, an SSE `message_delta` is a live projection of assembly progress, while
`message_end.message` and `/messages` are the completed message. Consumers that need an audit
record should persist the completed message and event sequence, not reconstruct a transcript
from deltas alone.

Accounting follows the same distinction: assistant message usage is per-turn; cumulative totals
are returned by `/status`. `accounting: null` means unknown, not zero.
