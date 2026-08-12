import test from "node:test";
import assert from "node:assert/strict";
import { DoMoCodeClient } from "../src/client.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";

test("long-tail session verbs remain thin and encoded", async () => {
  const server = new MockDoMoServer();
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch, clientId: "client", owner: "tests" });
  const session = await client.sessions.create();
  await session.rename("renamed");
  assert.equal(await session.autoTitle(), "renamed");
  await session.setLabel("node/with space", "review");
  await session.moveLeaf(null);
  assert.equal(await session.commitMessage(), "Mock commit message");
  const fork = await session.fork({ authority: "prefer" });
  const clone = await session.clone({ authority: "prefer" });
  assert.notEqual(fork.id, session.id);
  assert.notEqual(clone.id, session.id);
  await client.close();
  server.close();
});
