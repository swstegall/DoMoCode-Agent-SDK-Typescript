import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";

const job = {
  id: "job/1",
  correlationID: "corr-1",
  sessionID: "session-1",
  kind: "workflow-stage",
  owner: "owner-1",
  retryPolicy: { maxAttempts: 2, initialBackoffMilliseconds: 1, maximumBackoffMilliseconds: 4 },
  state: "running",
  progress: { fraction: 0.5, message: "halfway" },
  attempt: 1,
  createdAt: "2026-08-11T00:00:00Z",
  updatedAt: "2026-08-11T00:00:01Z",
  metadata: {}
};

const event = { sequence: 4, jobID: job.id, correlationID: job.correlationID, timestamp: job.updatedAt, kind: "progress", state: "running", attempt: 1, progress: job.progress, metadata: {} };

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("jobs decode Swift ID fields, expose events, and poll through cursorFeed", async () => {
  const calls: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname === "/jobs") return response([job]);
    if (url.pathname === "/job/job%2F1") return response(job);
    if (url.pathname === "/job/job%2F1/events") return response(url.searchParams.get("after") === "0" ? [event] : []);
    if (url.pathname === "/job/job%2F1/cancel") return response(job);
    if (url.pathname === "/jobs/recover") return response([job]);
    if (url.pathname === "/job/job%2F1/export") return response([{ event, record: job }]);
    throw new Error(`unexpected route ${url.pathname}`);
  };
  const client = new DoMoCodeClient({ baseURL: "https://example.test", token: "token", fetch });
  assert.equal((await client.jobs.list({ owner: "owner/1" }))[0]?.correlationId, "corr-1");
  assert.equal((await client.jobs.get("job/1")).sessionId, "session-1");
  assert.equal((await client.jobs.events("job/1"))[0]?.jobId, "job/1");
  const feed = client.jobs.feed("job/1", { pollIntervalMs: 0 });
  assert.deepEqual(await feed.next(), { done: false, value: { ...event, timestamp: event.timestamp, jobId: event.jobID, correlationId: event.correlationID } });
  await feed.return();
  assert.equal((await client.jobs.cancel("job/1", "owner-1")).state, "running");
  assert.equal((await client.jobs.recover())[0]?.id, "job/1");
  assert.equal((await client.jobs.export("job/1"))[0]?.event.sequence, 4);
  assert.ok(calls.includes("GET /jobs?owner=owner%2F1"));
  await client.close();
});
