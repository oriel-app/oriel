import assert from "node:assert/strict";
import { test } from "node:test";
import { array, object, optional, shapeOf, string } from "./validate.ts";
import { typeText } from "./shape.ts";

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
