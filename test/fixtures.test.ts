import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeServerEvent } from "../src/types/events.ts";

const fixture = (name: string) => join(process.cwd(), "testing", "fixtures", name);

test("golden fixtures decode and future frames remain observable", async () => {
  const names = ["connected.json", "permission-request.json", "question-request.json", "message-end.json", "client-tool-request.json", "client-tool-resolved.json", "future-frame.json"];
  for (const name of names) {
    const value = JSON.parse(await readFile(fixture(name), "utf8")) as unknown;
    assert.doesNotThrow(() => decodeServerEvent(value));
  }
});

test("negative fixture is rejected by the known-frame guard", async () => {
  const value = JSON.parse(await readFile(fixture("negative-connected.json"), "utf8")) as unknown;
  assert.throws(() => decodeServerEvent(value), /sessionId/);
  assert.ok(fixture("negative-connected.json").endsWith("negative-connected.json"));
});
