import test from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION, SDK_VERSION } from "../src/index.ts";

test("exports the SDK and protocol versions", () => {
  assert.equal(SDK_VERSION, "0.1.0");
  assert.equal(PROTOCOL_VERSION, 1);
});
