import assert from "node:assert/strict";
import { test } from "node:test";
import { type Mask, parseMask, project, type Schema, unknownField } from "./fields.ts";

const mask = (text: string): Mask => {
  const parsed = parseMask(text);
  assert.ok(parsed instanceof Map, text);
  return parsed;
};

const answer = {
  kind: "drive#file",
  version: "48",
  capabilities: { canEdit: true, canComment: false },
  sheets: [
    { properties: { sheetId: 1, title: "A" }, data: [{ startRow: 2 }] },
    { properties: { sheetId: 2, title: "B" } },
  ],
};

test("fields select by comma, by / or ., by parentheses and by *", () => {
  assert.deepEqual(project(answer, mask("version,capabilities/canEdit")), {
    version: "48",
    capabilities: { canEdit: true },
  });
  assert.deepEqual(project(answer, mask("sheets.properties(title)")), {
    sheets: [{ properties: { title: "A" } }, { properties: { title: "B" } }],
  });
  assert.deepEqual(project(answer, mask("sheets(properties/sheetId,data)")), {
    sheets: [
      { properties: { sheetId: 1 }, data: [{ startRow: 2 }] },
      { properties: { sheetId: 2 } },
    ],
  });
  assert.deepEqual(project(answer, mask("capabilities/*")), { capabilities: answer.capabilities });
  assert.deepEqual(project(answer, mask("*")), answer);
  // Two selections of one field select what either does.
  assert.deepEqual(project(answer, mask("capabilities/canEdit, capabilities")), {
    capabilities: answer.capabilities,
  });
});

test("a mask that doesn't parse, or names a field the type lacks, is refused", () => {
  for (const bad of ["", "a,", "a(b", "a)b", "a//b", "a(b))"])
    assert.ok(!(parseMask(bad) instanceof Map), bad);
  const schema: Schema = { version: true, capabilities: { canEdit: true } };
  assert.equal(unknownField(mask("version,capabilities(canEdit)"), schema), null);
  assert.equal(unknownField(mask("capabilities(canFly)"), schema), "capabilities.canFly");
  assert.equal(unknownField(mask("version/major"), schema), "version.major");
  assert.equal(unknownField(mask("*"), schema), null);
});
