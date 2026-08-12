# Remote deployment and browser clients

The server is designed to be placed behind an authenticated reverse proxy when it is not
loopback-only. Treat the bearer token as a password: use TLS, inject it through a secret
manager, rotate the server process/token, and keep it out of URLs, browser storage, logs, and
analytics. The SDK always sends it in the `Authorization` header.

For a browser client, enable an exact CORS origin allowlist on DoMoCode (`--cors
https://app.example.test`), serve the app over HTTPS, and pass a short-lived token through an
application-controlled bootstrap channel. Do not put a long-lived token in `localStorage`, a
query parameter, a public bundle, or a static dashboard file. The SDK uses fetch streaming
instead of `EventSource` so authorization headers work on the SSE connection.

The CORS policy should allow only the methods and headers required by the SDK, and should
preserve `Vary: Origin`. Unknown origins must receive no reflected allow-origin value. The
browser smoke harness in `browser-tests/` exercises both preflight and the SSE getReader loop.

A practical reverse-proxy shape is:

```text
browser / worker ── TLS ──► proxy ── private network ──► domo --serve
                              │                         bearer header
                              └─ exact Origin allowlist
```

Keep the DoMoCode token check enabled behind the proxy; proxy authentication is an additional
boundary, not a replacement. Restrict the proxy route to trusted callers, cap request bodies,
disable buffering for SSE, and allow long-lived event responses without an idle timeout shorter
than the SDK heartbeat watchdog. See [`SECURITY.md`](../SECURITY.md) for the threat model and
token-handling requirements.
