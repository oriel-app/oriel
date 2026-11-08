// Source text can hold a long run of space; marking a change in it must not
// backtrack across the run.
import assert from "node:assert/strict";
import { test } from "node:test";
import { words } from "../src/text-diff.ts";

const same = (text: string) => ({ text, changed: false });
const changed = (text: string) => ({ text, changed: true });

test("a change holding a long run of space is marked in one pass", () => {
  const spaces = " ".repeat(200_000);
  const { after } = words("w1 w2 w3 A", `w1 w2 w3 C${spaces}D`);
  assert.deepEqual(after, [same("w1 w2 w3 "), changed(`C${spaces}D`)]);
});
