import assert from "node:assert/strict";
import { test } from "node:test";
import { array, literal, object, optional, refine, shapeOf, string, union } from "./validate.ts";
import { jsonSchema, typeText } from "./shape.ts";

test("an object's type quotes a key that isn't a name, so the declaration parses", () => {
  const states = object({
    todo: array(string),
    "in-progress": array(string),
    done: optional(string),
  });
  assert.equal(
    typeText(shapeOf(states)),
    '{ todo: string[]; "in-progress": string[]; done?: string }',
  );
});

test("an action's input reads as JSON Schema, a refine's message as its description", () => {
  const input = object({
    workstream: refine(string, (s) => s.length > 0, "expected a workstream ID"),
    items: array(string),
    name: optional(string),
    kind: union(literal("a"), literal("b")),
  });
  assert.deepEqual(jsonSchema(shapeOf(input)), {
    type: "object",
    properties: {
      workstream: { type: "string", description: "expected a workstream ID" },
      items: { type: "array", items: { type: "string" } },
      name: { type: "string" },
      kind: { anyOf: [{ const: "a" }, { const: "b" }] },
    },
    required: ["workstream", "items", "kind"],
    additionalProperties: false,
  });
});
