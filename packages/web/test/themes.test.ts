// Themes (decision 0034): a theme is a block of values over window.css's
// one set of rules, and a sketch's theme sheet is built from those blocks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { defaultTheme, rules, sketchSheet, sketchTokens, themeNames, tokens } from "../themes.ts";

const windowCss = readFileSync(new URL("../assets/window.css", import.meta.url), "utf8");

const css = `
html {
  color-scheme: light dark;
  --accent-soft: color-mix(in srgb, var(--accent) var(--tint), var(--surface));
}
/* A comment with { braces } and a ; */
:root {
  --bg: #fff;
  --surface: var(--bg);
  --accent: #33f;
  --tint: 10%;
  --font: "Helvetica Neue", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000;
  }
}
:root[data-theme="paper"] {
  --bg: #ffe;
}
@media (prefers-color-scheme: dark) {
  :root[data-theme="paper"] {
    --bg: #110;
  }
}
@media (max-width: 760px) {
  html {
    --bar-height: 3rem;
  }
}
.button:hover:not(:disabled) {
  color: var(--accent);
}
`;

test("a stylesheet reads as rules, each with its at-rules, line and declarations", () => {
  const read = rules(css);
  assert.deepEqual(
    read.map((r) => [r.selector, r.at, r.line]),
    [
      ["html", [], 2],
      [":root", [], 7],
      [":root", ["@media (prefers-color-scheme: dark)"], 15],
      [':root[data-theme="paper"]', [], 19],
      [':root[data-theme="paper"]', ["@media (prefers-color-scheme: dark)"], 23],
      ["html", ["@media (max-width: 760px)"], 28],
      [".button:hover:not(:disabled)", [], 32],
    ],
  );
  assert.deepEqual(read[1]?.declarations.at(-1), {
    property: "--font",
    value: '"Helvetica Neue", sans-serif',
    line: 12,
  });
});

test("a theme's tokens are the shared ones, the default's, then its own", () => {
  assert.deepEqual(themeNames(css), [defaultTheme, "paper"]);
  assert.equal(tokens(css, defaultTheme, "light").get("--bg"), "#fff");
  assert.equal(tokens(css, defaultTheme, "dark").get("--bg"), "#000");
  assert.equal(tokens(css, "paper", "light").get("--bg"), "#ffe");
  assert.equal(tokens(css, "paper", "dark").get("--bg"), "#110");
  // What a theme leaves alone is the default's; layout isn't a theme's.
  assert.equal(tokens(css, "paper", "dark").get("--accent"), "#33f");
  assert.equal(tokens(css, "paper", "light").has("--bar-height"), false);
});

test("a sketch's theme sheet holds the neutral tokens of the person's theme, light and dark", () => {
  const sheet = sketchSheet(windowCss, defaultTheme);
  const named = [...sheet.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]);
  assert.deepEqual(named, [...sketchTokens, ...sketchTokens]);
  // Never the accent, a state, --del, or a section, list or ask-bar token,
  // so a sketch can't draw a copy of Approve.
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
    "--ask-mark",
  ])
    assert.ok(!named.some((name) => name === kept), kept);
  // Every value stands alone: the frame has no other sheet.
  assert.doesNotMatch(sheet, /var\(/);
  assert.match(sheet, /^ {2}--bg: #f6f5f2;$/m);
  assert.match(sheet, /^ {4}--bg: #151514;$/m);
  assert.match(sheet, /--surface-sunk: color-mix\(in srgb, #f6f5f2 50%, #ffffff\);/);
  assert.match(sheet, /--font-heading: Charter, "Iowan Old Style", Cambria, Georgia, serif;/);
});

test("Broadsheet's sketch sheet is its paper and ink, with square corners", () => {
  const sheet = sketchSheet(windowCss, "broadsheet");
  assert.match(sheet, /^ {2}--bg: #f4efe3;$/m);
  assert.match(sheet, /^ {4}--bg: #1a1814;$/m);
  assert.match(sheet, /^ {2}--radius-sm: 0;$/m);
  // What Broadsheet leaves alone is the default's, in both schemes.
  assert.match(sheet, /^ {2}--space-4: 1rem;$/m);
  assert.match(
    sheet,
    /^ {4}--font-heading: Charter, "Iowan Old Style", Cambria, Georgia, serif;$/m,
  );
});

test("a sketch's theme sheet follows the theme it's built for", () => {
  const paper = `${windowCss}
:root[data-theme="paper"] {
  --bg: #fffdf5;
  --radius: 0;
}
@media (prefers-color-scheme: dark) {
  :root[data-theme="paper"] {
    --bg: #12110d;
  }
}
`;
  const sheet = sketchSheet(paper, "paper");
  assert.match(sheet, /^ {2}--bg: #fffdf5;$/m);
  assert.match(sheet, /^ {4}--bg: #12110d;$/m);
  assert.match(sheet, /^ {2}--radius: 0;$/m);
  // A dark value the theme leaves alone is the default's.
  assert.match(sheet, /^ {4}--surface: #1c1c1a;$/m);
  assert.throws(() => sketchSheet(windowCss, "paper"), /No theme is called paper/);
});
