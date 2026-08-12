# Node launcher and co-attach

The Node-only entry point owns a `domo --serve` child when a script wants an isolated
runtime:

```ts
import { launchServer } from "domocode-agent-sdk/node";
import { DoMoCodeClient } from "domocode-agent-sdk";

await using server = await launchServer({
  isolated: true,
  model: "my-model",
  maxTurns: 8,
  steeringMode: "one-at-a-time"
});
const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token });
```

The launcher creates temporary workspace/config directories by default, parses the
interleaved stderr handshake, never forwards the bearer token to log callbacks, and removes
only directories it created. `close()` uses SIGTERM followed by SIGKILL and is idempotent.
`signal` terminates the child; `onExit()` provides a `ServerExitedError` for supervision
layers. The server's full CLI controls (`model`, `agent`, `mode`, `maxTurns`,
`maxCostPerRun`, `steeringMode`, `sandbox`, `trust`, `baseUrl`, and `env`) are passed through
as arguments/environment rather than reimplemented in the SDK.

For an existing runtime, use `connect()` with a token, token file, or environment-variable
name. It probes `/capabilities` before returning a regular `DoMoCodeClient`:

```ts
const client = await connect({ baseURL, tokenFile: "/run/user/1000/domo.token" });
```

`server.tuiCommand()` returns the safe command/argument pair for a co-attached TUI, and
`server.attachTui({stdio: "inherit"})` starts it. Both surfaces use the same bearer token;
do not print the returned arguments or place long-lived tokens in shell history. A TUI and
SDK can coexist: scripts should request authority explicitly, release it when idle with
`releaseAuthorityWhenIdle(session)`, and treat observer mode as read-only.
