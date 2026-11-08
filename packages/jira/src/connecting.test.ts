import assert from "node:assert/strict";
import { test } from "node:test";
import { jiraOptions } from "./connecting.ts";

test("a connection's options are a project key, and whether it's read-only, and the check never quotes one", () => {
  assert.deepEqual(jiraOptions({ project: "SYN", other: 1 }), {
    ok: true,
    value: { project: "SYN", readOnly: undefined },
  });
  assert.deepEqual(jiraOptions({ project: "SYN", readOnly: true }), {
    ok: true,
    value: { project: "SYN", readOnly: true },
  });
  assert.equal(jiraOptions({ project: "SYN", readOnly: "yes" }).ok, false);
  for (const project of ["syn", "", "SYN OR 1=1", "S".repeat(33), 12]) {
    const checked = jiraOptions({ project });
    assert.equal(checked.ok, false);
    assert.doesNotMatch(JSON.stringify(checked), /SYN OR/);
  }
});
