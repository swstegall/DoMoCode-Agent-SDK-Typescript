# Authority and multi-client operation

DoMoCode sessions use a durable client ledger. The first active attachment normally receives
`authority`; later attachments receive `observer` without an error. The SDK therefore defaults
to `authority: "require"` for `sessions.create`, `resume`, and `open`: a script fails near the
attachment point instead of discovering much later that `prompt`, `permission`, or `abort` is
forbidden.

Choose the posture deliberately:

```ts
const driver = await client.sessions.open(sessionId, { authority: "require" });
const mirror = await other.sessions.open(sessionId, { authority: "observer" });
```

`prefer` accepts an observer role when another client owns the session. Observer clients can
read status, transcripts, catalogs, and events, but should not retry mutating routes. The SDK
sends the client id and owner identity headers on every request.

## Safe handoff

Release authority only after the session is idle, has no queued steering messages, and has no
pending interaction. The Node helper does this check twice with a debounce:

```ts
import { releaseAuthorityWhenIdle } from "domocode-agent-sdk/node";

await releaseAuthorityWhenIdle(driver);
```

`session.dispose()` flushes the event cursor, best-effort releases authority, detaches the
client, and closes the SSE stream. It does not abort the server run. Use `session.abort()` or
`forceClear()` when stopping the run is the intent.

The SDK resumes the session before attempting the client-ledger attach. This ordering matters:
an attach 404 can mean an older server, a missing session, or a ledger problem. Liveness is
checked before the SDK treats a missing attach route as a legacy-server compatibility case.

Authority does not survive a DoMoCode server restart, but it can remain held after an SDK
process crash until another authorized client transfers it. Keep owner strings stable, expose a
human recovery path, and never put bearer tokens in owner names, logs, shell history, or issue
reports.
