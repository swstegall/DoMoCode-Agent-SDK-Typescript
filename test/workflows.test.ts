import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";

const definition = {
  id: "standard/workflow",
  displayName: "Standard workflow",
  version: 1,
  executionMode: "serial",
  stages: [{
    id: "approve",
    displayName: "Approve",
    kind: "execute",
    dependencies: [],
    toolPolicy: { mode: "readOnly", allowedTools: [] },
    contextInputs: ["prompt"],
    budget: {},
    cancellationPolicy: "stopDependents",
    approvalBoundary: "beforeStage",
    metadata: {}
  }],
  metadata: { source: "test" }
};

const run = {
  id: "run/1",
  workflowID: definition.id,
  status: "paused",
  createdAt: "2026-08-11T00:00:00Z",
  updatedAt: "2026-08-11T00:00:01Z",
  input: { prompt: "ship" },
  stages: [],
  output: null,
  cancellationRequested: false,
  metadata: {}
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("workflow client follows the Swift routes and decodes approval boundaries", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", body });
    if (url.pathname === "/workflows") return response([definition]);
    if (url.pathname === "/workflow/standard%2Fworkflow/runs") return response([run]);
    if (url.pathname === "/workflow/standard%2Fworkflow/run/run%2F1") return response(run);
    if (url.pathname === "/workflow/standard%2Fworkflow/run/run%2F1/approvals") return response([{ workflowID: definition.id, runID: run.id, stage: definition.stages[0] }]);
    if (url.pathname === "/workflow/standard%2Fworkflow/run/run%2F1/export") return response([{ kind: "runSnapshot", id: run.id, timestamp: run.updatedAt, run }]);
    if (url.pathname.endsWith("/approval")) return response({});
    if (url.pathname.endsWith("/run")) return response(run, 202);
    if (url.pathname.endsWith("/resume")) return response(run, 202);
    if (url.pathname.endsWith("/cancel") || url.pathname.endsWith("/pause")) return response(run);
    throw new Error(`unexpected route ${url.pathname}`);
  };
  const client = new DoMoCodeClient({ baseURL: "https://example.test", token: "token", fetch });

  assert.equal((await client.workflows.list())[0]?.id, definition.id);
  assert.equal((await client.workflows.runs(definition.id))[0]?.workflowId, definition.id);
  assert.equal((await client.workflows.get(definition.id, run.id)).status, "paused");
  const started = await client.workflows.run(definition.id, "session-1", { prompt: "ship" }, "run/1");
  assert.equal(started.id, run.id);
  assert.equal((await client.workflows.resume(definition.id, run.id, "session-1")).id, run.id);
  assert.equal((await client.workflows.pause(definition.id, run.id)).status, "paused");
  assert.equal((await client.workflows.cancel(definition.id, run.id)).status, "paused");
  const approvals = await client.workflows.approvals(definition.id, run.id);
  assert.equal(approvals[0]?.stage.id, "approve");
  await client.workflows.decide(definition.id, run.id, "approve", "approve", "approved by test");
  assert.equal((await client.workflows.export(definition.id, run.id))[0]?.run?.id, run.id);
  const startCall = calls.find((call) => call.path.endsWith("/workflow/standard%2Fworkflow/run"));
  assert.deepEqual(startCall?.body, { sessionID: "session-1", input: { prompt: "ship" }, runID: "run/1" });
  const approvalCall = calls.find((call) => call.path.endsWith("/approval"));
  assert.deepEqual(approvalCall?.body, { stageID: "approve", decision: "approve", reason: "approved by test" });
  await client.close();
});
