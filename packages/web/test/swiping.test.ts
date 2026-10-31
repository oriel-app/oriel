import assert from "node:assert/strict";
import { test } from "node:test";
import { pullFor, resisted, settle, shown } from "../src/swiping.ts";

// Mark done at 76, Delete at 152.
const stops = [76, 152];

test("a row follows the pull to its first stop, then gives way against resistance", () => {
  assert.equal(resisted(-20, stops), 0);
  assert.equal(resisted(40, stops), 40);
  assert.equal(resisted(76, stops), 76);
  // Twice the pull for each pixel past the first stop, up to the last.
  assert.equal(resisted(76 + 76, stops), 114);
  assert.equal(resisted(76 + 152, stops), 152);
  // Beyond the last, barely at all.
  assert.ok(resisted(76 + 152 + 100, stops) < 152 + 20);
});

test("a new swipe picks the row up where it rests", () => {
  for (const offset of [0, 30, 76, 100, 152, 160]) {
    assert.ok(Math.abs(resisted(pullFor(offset, stops), stops) - offset) < 1e-9, `${offset}`);
  }
});

test("let go, a row rests closed or at the nearest stop", () => {
  assert.equal(settle(30, stops), 0);
  assert.equal(settle(50, stops), 76);
  assert.equal(settle(110, stops), 76);
  assert.equal(settle(120, stops), 152);
  assert.equal(settle(170, stops), 152);
  assert.deepEqual(
    [0, 76, 100, 152].map((offset) => shown(offset, stops)),
    [0, 1, 1, 2],
  );
});

test("a done thread's one action is its first and last stop", () => {
  assert.equal(resisted(76, [76]), 76);
  assert.equal(resisted(176, [76]), 76 + 100 * 0.15);
  assert.equal(settle(60, [76]), 76);
});
