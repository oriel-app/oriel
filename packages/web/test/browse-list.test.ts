// An item opened from a Browse cluster steps through the cluster's items in
// the panel (OA-95) because the list sits in an ItemListContext, which tells
// each item link the list it is in. Node can't render a .tsx page, so this
// reads the page's source: losing the wrapper turns stepping off with nothing
// else failing. `pnpm shots browse-step` shows it working.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../src/window-page.tsx", import.meta.url), "utf8");

test("a Browse cluster's loaded items are the list its item links step through", () => {
  const list =
    /<ItemListContext\.Provider value=\{items\.map\(\(item\) => item\.id\)\}>\s*<ul class="items"[\s\S]*?<\/ul>\s*<\/ItemListContext\.Provider>/;
  assert.match(page, list);
});
