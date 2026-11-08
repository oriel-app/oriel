import assert from "node:assert/strict";
import { test } from "node:test";
import { isDebugger } from "./desktop-debug-flags.ts";

test("a DevTools or inspector endpoint is a debugger, and Oriel's refusal isn't", () => {
  assert.ok(isDebugger('{"Browser":"Chrome/156.0.8078.48","Protocol-Version":"1.3"}'));
  assert.ok(isDebugger('{"Browser":"node.js/v24.22.0","Protocol-Version":"1.1"}'));
  assert.equal(isDebugger('{"error":"forbidden"}'), false);
  assert.equal(isDebugger("<!doctype html>"), false);
  assert.equal(isDebugger("null"), false);
});
