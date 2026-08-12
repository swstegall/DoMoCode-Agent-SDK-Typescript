# Testing and conformance

The `./testing` entry point is a public, zero-runtime-dependency test kit. It contains an
in-process `MockDoMoServer`, the scripted OpenAI-compatible `ScriptedMockGateway`, the
redacting `CaptureHarness`, the Node-only TCP adapter, and deterministic protocol fixtures.

## Run the conformance suite

`ConformanceSuite` checks an already-running server without starting a model turn. It creates
one session with `authority: "prefer"`, verifies capabilities when that optional route exists,
opens the authenticated SSE stream, reads status/catalog/transcript projections, and disposes
the session during cleanup:

```ts
import { ConformanceSuite } from "domocode-agent-sdk/testing";

const report = await new ConformanceSuite({
  baseURL: process.env.DOMO_URL!,
  token: process.env.DOMO_TOKEN!
}).assert();

for (const check of report.checks) console.log(check.status, check.name, check.detail ?? "");
```

`run()` returns a structured report instead of throwing, which is useful for CI annotations.
`assert()` throws `ConformanceError` when a check fails. The suite never logs or includes the
bearer token in a report.

## Mock server and gateway

Use `MockDoMoServer` for browser-safe unit tests. Its `fetch` function implements the same
authenticated HTTP/SSE seam as a live server, and its `promptHandler` can emit deterministic
permission, question, OAuth, and client-tool events. `MockDoMoTcpServer` adds a real Node HTTP
boundary for browser smoke tests and CORS checks. `ScriptedMockGateway` provides queued,
OpenAI-compatible streaming completions for a spawned `domo --serve` process.

`CaptureHarness` records request/response JSON and accepts explicit `recordEvent()` calls. Use
`scrubSecrets()` or `toJSON()` before writing captures to a fixture; authorization, token, API
key, and similarly named fields are replaced with `[REDACTED]`.

Fixtures are intentionally small and redacted. Add a fixture when a wire shape is part of the
compatibility contract, then add it to the fixture decoder test. Unknown event fixtures should
remain observable rather than becoming a closed-union failure.

