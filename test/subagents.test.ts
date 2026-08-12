import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

test("subagent registry indexes lifecycle events and observes child questions", async () => {
  const server = new MockDoMoServer({ autoComplete: false });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "subagent-client", owner: "tests" });
  const parent = await client.sessions.create();
  const childRef = await server.createSession();
  const registry = parent.subagents();
  await registry.ready;
  const updates: string[] = [];
  registry.onUpdate((record) => updates.push(`${record.taskId}:${record.status}`));
  const nextInteraction = registry.interactions().next();
  server.emit(parent.id, {
    type: "subagent",
    subagent: { taskId: "task-1", childSessionId: childRef.id, parentSessionId: parent.id, description: "Explore", depth: 1, status: "started", agent: "explore" }
  });
  await waitFor(() => registry.child("task-1") !== undefined);
  assert.equal(registry.get("task-1")?.childSessionId, childRef.id);
  assert.deepEqual(updates, ["task-1:started"]);
  const child = registry.child("task-1");
  assert.equal(child?.role, "authority");
  await server.requestQuestion(childRef.id, {
    id: "child-question",
    sessionId: childRef.id,
    questions: [{ question: "Continue?", options: [{ label: "Yes" }], allowsMultiple: false }]
  });
  const result = await withTimeout(nextInteraction, 1_000);
  assert.equal(result.done, false);
  if (!result.done) {
    assert.equal(result.value.kind, "question");
    await (result.value as { answer: (answers: Array<{ selectedLabels: string[] }>) => Promise<void> }).answer([{ selectedLabels: ["Yes"] }]);
  }
  await waitFor(() => registry.pendingInteractions().length === 0);
  await parent.dispose();
  server.close();
});

test("task and resumable task wrappers use the direct catalog route", async () => {
  const server = new MockDoMoServer();
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "task-client", owner: "tests" });
  const session = await client.sessions.create();
  const first = await session.task("Explore the repository", { agent: "explore", background: true, taskId: "task-1" });
  assert.equal(first.toolName, "task");
  assert.match(first.output, /task-1|task/);
  const resumed = await session.resumeTask("task-1", "Continue");
  assert.equal(resumed.isError, false);
  await session.dispose();
  server.close();
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), milliseconds))]);
}
