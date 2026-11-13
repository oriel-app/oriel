import assert from "node:assert/strict";
import { test } from "node:test";
import { literal, number, object, record, string, union } from "./validate.ts";

// Defect fixed in e5dfd009: a refused connect named the issues of every alternative, not just the one it picked.
test("a union of objects told apart by a literal names only the issues of the one the input picks", () => {
  const connect = union(
    object({ kind: literal("folder"), path: string }),
    object({ kind: literal("jira"), site: string, token: string }),
  );
  const paths = (input: unknown) => {
    const result = connect(input);
    return result.ok ? [] : result.issues.map((i) => i.path);
  };
  assert.deepEqual(paths({ kind: "jira", site: "a", token: 1 }), ["$.token"]);
  assert.deepEqual(paths({ kind: "folder" }), ["$.path"]);
});

test("an inherited key does not satisfy the shape", () => {
  const input = Object.create({ key: "SYN-1" }) as object;
  assert.equal(object({ key: string })(input).ok, false);
});

test("record keeps a __proto__ key as plain data", () => {
  const result = record(number)(JSON.parse('{"customfield_10043": 3, "__proto__": 5}'));
  assert.equal(result.ok, true);
  const value = result.ok ? result.value : {};
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.equal(record(number)({ a: "x" }).ok, false);
});
