// No declared kind takes one of Oriel's own names in a region's module, or a
// word a script can't name (decision 0049).
import assert from "node:assert/strict";
import { test } from "node:test";
import { orielNames } from "@oriel/bindings";
import { sourceKinds } from "@oriel/sources";

test("no declared kind is one of Oriel's own names in the module, or a word a script can't name", () => {
  for (const kind of sourceKinds) {
    assert.ok(!orielNames.includes(kind), `${kind} is one of Oriel's own names`);
    assert.doesNotThrow(() => new Function(`const ${kind} = 1;`), `${kind} can't name a global`);
  }
});
