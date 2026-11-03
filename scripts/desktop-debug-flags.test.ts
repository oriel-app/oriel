import assert from "node:assert/strict";
import { test } from "node:test";
import { isDebugger, listening } from "./desktop-debug-flags.ts";

test("each process's listening ports come from lsof's fields", () => {
  const lsof = "p101\nf23\nn127.0.0.1:4848\nf24\nn127.0.0.1:61001\np202\nf9\nn*:9222\n";
  assert.deepEqual(listening(lsof), [
    { pid: 101, port: 4848 },
    { pid: 101, port: 61001 },
    { pid: 202, port: 9222 },
  ]);
  assert.deepEqual(listening(""), []);
});

test("a DevTools or inspector endpoint is a debugger, and Oriel's refusal isn't", () => {
  assert.ok(isDebugger('{"Browser":"Chrome/156.0.8078.48","Protocol-Version":"1.3"}'));
  assert.ok(isDebugger('{"Browser":"node.js/v24.22.0","Protocol-Version":"1.1"}'));
  assert.equal(isDebugger('{"error":"forbidden"}'), false);
  assert.equal(isDebugger("<!doctype html>"), false);
  assert.equal(isDebugger("null"), false);
});
