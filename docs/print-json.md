# SDK versus `domo -p --json`

`domo -p --json` is a compact print-mode interface for shell pipelines. It is not the same
protocol as the SDK's session SSE surface. Print mode emits its frozen NDJSON result contract;
it does not expose the live `notice`, `question_request`, `permission_request`, authority, or
client-tool interaction frames.

Use print mode when a one-shot shell command only needs the final output:

```sh
domo -p --json "Summarize the diff"
```

Use the SDK when a process needs any of the following:

- reconnectable live events and partial message deltas;
- permission/question policy and correlated answers;
- session resume, fork/clone, transcripts, accounting, or multi-client attachment;
- MCP catalogs/OAuth delegation, workflows/jobs, or client-defined tools;
- explicit abort/steer and authority handoff.

Do not parse print-mode NDJSON as if it were SSE. The SDK's `query()` result stream starts with
an init snapshot and then yields typed server events; a `SessionHandle` exposes the underlying
REST and event surfaces directly.
