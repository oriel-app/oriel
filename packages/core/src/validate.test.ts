import assert from "node:assert/strict";
import { test } from "node:test";
import { isInstant } from "./ids.ts";
import {
  array,
  boolean,
  lazy,
  literal,
  nullable,
  number,
  object,
  optional,
  record,
  refine,
  string,
  union,
  type Validator,
} from "./validate.ts";

const story = object({
  key: string,
  points: nullable(number),
  labels: array(string),
  done: optional(boolean),
});

test("a valid object passes and keeps only the shape's keys", () => {
  const result = story({ key: "SYN-1", points: 3, labels: ["a"], extra: true });
  assert.deepEqual(result, {
    ok: true,
    value: { key: "SYN-1", points: 3, labels: ["a"], done: undefined },
  });
});

test("every bad field is reported with its path", () => {
  const result = story({ key: 1, points: "3", labels: ["a", 2] });
  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.issues.map((i) => i.path), [
    "$.key",
    "$.points",
    "$.labels[1]",
  ]);
});

test("non-objects, arrays and null are not objects", () => {
  for (const input of [null, [], "x", 1]) assert.equal(story(input).ok, false);
});

test("numbers must be finite", () => {
  assert.equal(number(Number.NaN).ok, false);
  assert.equal(number(Infinity).ok, false);
  assert.equal(number(0).ok, true);
});

test("literal and union pick the first matching alternative", () => {
  const kind = union(literal("read"), literal("write"));
  assert.deepEqual(kind("write"), { ok: true, value: "write" });
  assert.equal(kind("delete").ok, false);
});

test("a union of objects told apart by a literal names only the issues of the one the input picks", () => {
  const connect = union(
    object({ kind: literal("folder"), path: string }),
    object({ kind: literal("jira"), site: string, token: string }),
  );
  assert.deepEqual(connect({ kind: "jira", site: "a", token: 1 }), {
    ok: false,
    issues: [{ path: "$.token", message: "expected a string" }],
  });
  assert.deepEqual(connect({ kind: "folder" }), {
    ok: false,
    issues: [{ path: "$.path", message: "expected a string" }],
  });
  // A kind none has, or none at all, names every alternative's issues.
  const unknownKind = connect({ kind: "drive", path: "/a" });
  assert.equal(unknownKind.ok ? 0 : unknownKind.issues.length, 4);
  const noKind = connect([]);
  assert.equal(noKind.ok ? 0 : noKind.issues.length, 2);
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

test("refine narrows with a type guard", () => {
  const instant = refine(string, isInstant, "expected an instant");
  assert.equal(instant("2026-10-28T12:00:00.000Z").ok, true);
  assert.deepEqual(instant("yesterday"), {
    ok: false,
    issues: [{ path: "$", message: "expected an instant" }],
  });
});

test("lazy validates recursive shapes", () => {
  type Node = { text: string; children: Node[] };
  const node: Validator<Node> = lazy(() => object({ text: string, children: array(node) }));
  assert.equal(node({ text: "a", children: [{ text: "b", children: [] }] }).ok, true);
  assert.equal(node({ text: "a", children: [{ text: 1, children: [] }] }).ok, false);
});
