# DoMoCode Agent SDK for TypeScript

The DoMoCode Agent SDK is a hand-written, zero-runtime-dependency TypeScript client for
DoMoCode's authenticated HTTP and server-sent-events API.

The package is consumed directly from GitHub and ships its compiled `dist/` artifacts. It
targets Node.js 20.4+, Bun, Deno raw-URL imports, and modern browsers. The runtime uses the
platform `fetch`, `ReadableStream`, and `AbortSignal` implementations.

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

Interaction handling is documented in [`docs/interactions.md`](docs/interactions.md). Sessions
provide both capability-object asks (`ask.allow()`, `ask.answer()`) and low-level answer methods.

Catalogs, direct tools, and transcript export are covered in [`docs/catalogs.md`](docs/catalogs.md).

The high-level `query()`/`runQuery()` layer is documented in [`docs/query.md`](docs/query.md).
