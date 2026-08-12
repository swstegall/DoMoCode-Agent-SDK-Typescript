# Subagents

Subagent lifecycle frames are open-enum `subagent` events carrying `taskId`,
`childSessionId`, `depth`, and a lifecycle `status`. Optional profile, model, output, error,
and tool-policy fields are preserved when present.

```ts
const children = session.subagents();
children.onUpdate((task) => console.log(task.taskId, task.status));

for await (const ask of children.interactions()) {
  if (ask.kind === "question") await ask.answer([{ selectedLabels: ["Yes"] }]);
}
```

The registry opens child streams when tasks enter `started`, `accepted`, or `running`.
It uses `authority: "prefer"` by default: an SDK can answer a child question when no other
client owns that child, but a co-attached client keeps authority and the SDK remains an
observer. Set `childAuthority: "observer"` for strictly read-only monitoring or
`"require"` when child answers are mandatory. Parent permission asks remain on the parent
stream; older servers keep child questions on the child stream, which is why this registry
exists.

`session.task(prompt, options)` and `resumeTask(taskId, prompt)` call the server's direct
`task` tool with `agent`, `background`, and optional model/task-id fields. The server remains
the authority for task ids and child-session creation; the returned `DirectToolResult` keeps
the raw bounded tool output while the registry makes the lifecycle navigable.
