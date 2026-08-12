import test from "node:test";
import assert from "node:assert/strict";
import { cursorFeed } from "../src/cursorFeed.ts";

test("cursorFeed yields pages and advances from the explicit page cursor", async () => {
  const calls: number[] = [];
  const feed = cursorFeed({
    initialCursor: 0 as number,
    pollIntervalMs: 0,
    fetchPage: async (cursor) => {
      calls.push(cursor);
      if (cursor === 0) return { items: ["a", "b"], nextCursor: 2 };
      return { items: [], done: true };
    }
  });
  assert.deepEqual(await feed.next(), { done: false, value: "a" });
  assert.deepEqual(await feed.next(), { done: false, value: "b" });
  assert.deepEqual(await feed.next(), { done: true, value: undefined });
  assert.deepEqual(calls, [0, 2]);
  assert.equal(feed.cursor, 2);
});

test("cursorFeed derives a cursor from the last item and polls empty pages", async () => {
  const calls: number[] = [];
  let empty = true;
  const feed = cursorFeed({
    initialCursor: 0 as number,
    pollIntervalMs: 1,
    cursorOf: (item: { sequence: number }) => item.sequence,
    fetchPage: async (cursor) => {
      calls.push(cursor);
      if (empty) {
        empty = false;
        return { items: [] };
      }
      return { items: [{ sequence: 7 }], done: true };
    }
  });
  assert.deepEqual(await feed.next(), { done: false, value: { sequence: 7 } });
  assert.equal(feed.cursor, 7);
  assert.deepEqual(calls, [0, 0]);
});

test("cursorFeed stops cleanly on return and propagates an external abort", async () => {
  const controller = new AbortController();
  const feed = cursorFeed({
    initialCursor: 0,
    pollIntervalMs: 1,
    signal: controller.signal,
    fetchPage: async () => ({ items: [] })
  });
  const pending = feed.next();
  controller.abort(new Error("stopped"));
  await assert.rejects(pending, /stopped/);

  const second = cursorFeed({ initialCursor: 0 as number, fetchPage: async () => ({ items: [], done: true }) });
  assert.deepEqual(await second.return(), { done: true, value: undefined });
  assert.deepEqual(await second.next(), { done: true, value: undefined });
});
