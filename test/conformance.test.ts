import test from "node:test";
import assert from "node:assert/strict";
import { ConformanceError, ConformanceSuite } from "../src/testing/conformance.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

test("ConformanceSuite runs the public read-safe checks against a mock server", async () => {
  const server = new MockDoMoServer();
  const report = await new ConformanceSuite({
    baseURL: server.baseURL,
    token: server.token,
    fetch: server.fetch,
    clientId: "conformance-client",
    owner: "tests"
  }).assert();
  assert.equal(report.passed, true);
  assert.equal(report.sessionId !== undefined, true);
  assert.ok(report.checks.some((check) => check.name === "event stream" && check.status === "passed"));
  server.close();
});

test("ConformanceSuite returns a report and ConformanceError for a bad server", async () => {
  const server = new MockDoMoServer({ protocolVersion: 2 });
  const suite = new ConformanceSuite({ baseURL: server.baseURL, token: server.token, fetch: server.fetch });
  const report = await suite.run();
  assert.equal(report.passed, false);
  assert.ok(report.checks.some((check) => check.status === "failed"));
  await assert.rejects(() => suite.assert(), (error: unknown) => error instanceof ConformanceError);
  server.close();
});
