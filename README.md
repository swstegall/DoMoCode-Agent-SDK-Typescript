# DoMoCode Agent SDK for TypeScript

The DoMoCode Agent SDK is a hand-written, zero-runtime-dependency TypeScript client for
DoMoCode's authenticated HTTP and server-sent-events API.

The package is consumed directly from GitHub and ships its compiled `dist/` artifacts. It
targets Node.js 20.4+, Bun, Deno raw-URL imports, and modern browsers. The runtime uses the
platform `fetch`, `ReadableStream`, and `AbortSignal` implementations.

## Quickstart

```ts
import { DoMoCodeClient } from "domocode-agent-sdk";

const client = new DoMoCodeClient({ baseURL, token });
const session = await client.sessions.create();
const result = await session.run("Review the current changes");
console.log(result.stopReason, result.messages.at(-1));
await client.close();
```

The SDK is a peer HTTP client: `domo --serve` owns the model, tools, permissions, transcripts,
and durable session state. The SDK owns its HTTP/SSE subscription, event decoding, authority
attachment, and optional local handlers such as client-defined tools.

```text
┌────────────────────────────┐       HTTP + authenticated SSE       ┌──────────────────────────┐
│ TypeScript SDK / your app  │◄────────────────────────────────────►│ domo --serve             │
│ sessions, events, policies │                                      │ harness, tools, sessions │
│ optional local tool code   │                                      │ MCP, ledger, transcripts │
└──────────────┬─────────────┘                                      └───────────┬──────────────┘
               │ client_tool_request / result                                │
               └──────────────────────────────────────────────────────────────┘
```

## Development

```sh
npm install
npm test
npm run build
```

`dist/` is committed intentionally. Do not add `prepare`, `prepack`, or other install-time
lifecycle scripts: a GitHub install must work without running arbitrary repository code.

The implementation follows [DOMOCODE_SDK_PLAN.md](../DOMOCODE_SDK_PLAN.md). The JSON Schema in
`schema/` is the wire-contract source of truth; generated types and build output are checked in.

Start with the [event contract](docs/events.md), [interaction and authority guide](docs/interactions.md),
and [security policy](SECURITY.md). The [testing and conformance kit](docs/testing.md) is
available from `domocode-agent-sdk/testing`.

Catalogs, direct tools, and transcript export are covered in [`docs/catalogs.md`](docs/catalogs.md).

The high-level `query()`/`runQuery()` layer is documented in [`docs/query.md`](docs/query.md).

Child-session monitoring and task resumption are documented in [`docs/subagents.md`](docs/subagents.md).

MCP administration, fallback filtering, and the deterministic stdio fixture are documented
in [`docs/catalogs.md`](docs/catalogs.md).

Remote MCP OAuth, PKCE, loopback callbacks, and token import are documented in
[`docs/oauth.md`](docs/oauth.md).

Additional operational references cover [remote deployment](docs/deployment.md),
[Claude SDK migration](docs/migration-claude.md), [print-mode differences](docs/print-json.md),
[transcript fidelity](docs/transcript-fidelity.md), [versioning](docs/versioning.md), and
[release mechanics](docs/release-process.md).
