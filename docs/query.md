# Query API

`query()` is the high-level scripting surface. It opens/resumes a session, emits an init
snapshot first, forwards the session's typed SSE events, and settles to a collected result.
The result pump runs as soon as `query()` is called, so callers may await `.result` without
consuming the event iterator.

```ts
const stream = query({
  baseURL,
  token,
  prompt: "Review the current changes",
  onPermission: (ask) => ask.allow(),
  maxIdleMs: 30_000
});

for await (const event of stream) {
  if (event.type === "message_delta") process.stdout.write(event.text ?? "");
}
console.log(await stream.finalText());
```

The first value is `{ type: "init", sessionId, tools, commands, capabilities }`. Later
values are the normal open-kind `ServerEvent` union, including unknown additive frames.
`stream.send()`, `stream.steer()`, `stream.interrupt()`, and `stream.abort()` are control
methods; `finalText()`, `transcript()`, and `usage()` are collectors over the same result.

Streaming input is accepted as an async iterable:

```ts
const prompts = async function* () {
  yield "Start the task";
  yield "Now run the tests";
};
const result = await runQuery(prompts(), { baseURL, token });
```

Calling `return()` by breaking a `for await` loop stops event delivery and releases session
authority, but does not abort the server run. Call `interrupt()` when the run itself must be
aborted. Query-created sessions are disposed after settlement unless `keepSession` is true;
retained results expose the live `session` handle. A finite 5-second idle window is used by
default, and pending permissions/questions reject with `RunStalledError` when no handler or
policy answers them.
