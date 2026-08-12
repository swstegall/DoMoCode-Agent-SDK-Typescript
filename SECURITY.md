# Security policy

## Bearer tokens

DoMoCode bearer tokens grant access to the server's sessions and tools. Treat them as passwords:

- use TLS and a private network or authenticated reverse proxy for non-loopback deployments;
- keep tokens in process memory or an operating-system secret store;
- never put tokens in URLs, `localStorage`, static browser bundles, shell history, screenshots,
  issue reports, or telemetry;
- do not log `Authorization` headers or pass tokens to model prompts;
- use short-lived/isolated server processes for browser demos and rotate a token by restarting
  the server when compromise is suspected.

The SDK redacts bearer/token/API-key-shaped fields from transport errors and capture fixtures,
but applications remain responsible for their own request logging and proxy logs.

## Authority and grants

Authority permits mutation of a session. Use `authority: "require"` for automation that must
drive a run, `prefer` for best-effort co-attachment, and `observer` for read-only dashboards.
Release authority only after the session is idle. `ask.allow({ always: true })` writes a durable
server-side permission grant; expose that choice to an operator and do not enable it as an
unreviewed default.

## Browser and remote deployment

Configure an exact CORS origin allowlist. Do not use `*` with credentials. Disable proxy
buffering for SSE, preserve `Vary: Origin`, cap request bodies, and keep the bearer check active
behind the proxy. Review [`docs/deployment.md`](docs/deployment.md) before exposing a server.

## Reporting a vulnerability

Please do not disclose an unpatched vulnerability in a public issue. Use the repository's
private security reporting channel when available; otherwise contact the maintainers privately
with a minimal reproduction, affected commit/tag, deployment shape, and whether a bearer token
or user data was exposed. Do not include live credentials in the report.
