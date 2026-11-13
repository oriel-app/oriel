// A sketch (agent HTML in a frame, decision 0033) gets a theme sheet of the
// person's theme's neutral tokens only, so it can't draw a copy of Approve.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { defaultTheme, sketchSheet } from "../themes.ts";

const windowCss = readFileSync(new URL("../assets/window.css", import.meta.url), "utf8");

test("a sketch's theme sheet never holds the accent, a state or the page's own chrome", () => {
  const sheet = sketchSheet(windowCss, defaultTheme, "default");
  const named = [...sheet.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]);
  assert.ok(named.length > 0);
  for (const kept of [
    "--accent",
    "--on-accent",
    "--in-progress",
    "--done",
    "--danger",
    "--derived",
    "--del",
    "--section-rule",
    "--list-bg",
  ])
    assert.ok(!named.includes(kept), kept);
  // Every value stands alone: the frame has no other sheet to borrow from.
  assert.doesNotMatch(sheet, /var\(/);
});
