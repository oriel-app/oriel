import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  colourProblems,
  contrast,
  distance,
  literal,
  painted,
  parseColor,
  ruleProblems,
  themeColour,
  themeProblems,
} from "./check-themes.ts";

const windowCss = readFileSync(
  new URL("../packages/web/assets/window.css", import.meta.url),
  "utf8",
);
const oneDecimal = (n: number) => Math.round(n * 10) / 10;
const twoDecimals = (n: number) => Math.round(n * 100) / 100;
const c = (text: string) => painted(parseColor(text));

// A second theme over window.css's own rules and shared tokens, with
// `light` and `dark` for what a test names; the rest are the default's.
const withTheme = (light: Record<string, string>, dark: Record<string, string> = light) => {
  const block = (values: Record<string, string>, indent: string) =>
    Object.entries(values)
      .map(([name, value]) => `${indent}${name}: ${value};`)
      .join("\n");
  return `${windowCss}
:root[data-theme="probe"] {
${block(light, "  ")}
}
@media (prefers-color-scheme: dark) {
  :root[data-theme="probe"] {
${block(dark, "    ")}
  }
}
`;
};

test("Graphite, the default theme, passes every rule in light and dark", () => {
  assert.deepEqual(themeProblems(windowCss), []);
});

test("the check reproduces the spike's numbers on Graphite, which is 1A's palette", () => {
  const at = (scheme: "light" | "dark", name: string) =>
    themeColour(windowCss, "graphite", scheme, name);
  // Its closest pair of states: the accent against in progress.
  assert.equal(oneDecimal(distance(at("light", "--accent"), at("light", "--in-progress"))), 17.9);
  assert.equal(oneDecimal(distance(at("dark", "--accent"), at("dark", "--in-progress"))), 13.9);
  assert.equal(
    oneDecimal(distance(at("dark", "--accent"), at("dark", "--in-progress"), "deuteranopia")),
    4.2,
  );
  // Its next closest under simulation: in progress against done.
  assert.equal(
    oneDecimal(distance(at("light", "--in-progress"), at("light", "--done"), "tritanopia")),
    5.9,
  );
  // Its worst contrast in each scheme.
  assert.equal(
    twoDecimals(contrast(at("light", "--text-faint"), at("light", "--surface-hover"))),
    4.58,
  );
  assert.equal(twoDecimals(contrast(at("dark", "--danger"), at("dark", "--danger-soft"))), 5.28);
});

test("the check reproduces the spike's numbers on the palettes that fail", () => {
  // 3B: its accent and in progress are one brown, and its needs-you
  // brown is 4.3 from it, 1.8 under tritanopia.
  assert.equal(distance(c("#77520a"), c("#77520a")), 0);
  assert.equal(oneDecimal(distance(c("#764c16"), c("#77520a"))), 4.3);
  assert.equal(oneDecimal(distance(c("#764c16"), c("#77520a"), "tritanopia")), 1.8);
  // Main before themes: its accent and in progress's text, two blues.
  assert.equal(oneDecimal(distance(c("#3f5bd8"), c("#2f5bc4"))), 3.8);
  assert.equal(oneDecimal(distance(c("#3f5bd8"), c("#2f5bc4"), "tritanopia")), 2.6);
  // And its faint text, 3.0 to 3.3:1 on its light backgrounds.
  for (const bg of ["#f7f7f5", "#ffffff", "#f3f3f0", "#fafaf8"]) {
    const ratio = contrast(c("#8f8d86"), c(bg));
    assert.ok(ratio >= 2.95 && ratio < 3.35, `${bg}: ${ratio}`);
  }
});

test("a theme with main's old palette fails contrast and the states rule", () => {
  const css = withTheme({
    "--bg": "#f7f7f5",
    "--surface": "#ffffff",
    "--surface-hover": "#f3f3f0",
    "--surface-sunk": "#fafaf8",
    "--list-bg": "#ffffff",
    "--text": "#1f1f1d",
    "--text-muted": "#63625d",
    "--text-faint": "#8f8d86",
    "--accent": "#3f5bd8",
    "--on-accent": "#ffffff",
    "--todo": "#5f5e59",
    "--in-progress": "#2f5bc4",
    "--done": "#2b7a52",
    "--danger": "#b5412f",
    "--derived": "#94620b",
    "--del": "#8f8d86",
  });
  const found = colourProblems(css, "probe", "light");
  assert.ok(
    found.includes("probe, light: --text-faint on --bg is 3.10:1, under 4.5:1"),
    found.join("\n"),
  );
  assert.ok(
    found.includes(
      "probe, light: --accent and --in-progress are 3.77 apart in CIEDE2000, under 10",
    ),
    found.join("\n"),
  );
  assert.ok(
    found.includes(
      "probe, light: --accent and --in-progress are 2.64 apart in CIEDE2000 under tritanopia, under 4",
    ),
    found.join("\n"),
  );
});

test("colours are read as the browser computes them, mixes included", () => {
  assert.deepEqual(parseColor("#fff"), [1, 1, 1, 1]);
  assert.deepEqual(parseColor("rgb(0 0 0 / 0.5)"), [0, 0, 0, 0.5]);
  assert.deepEqual(parseColor("color-mix(in srgb, #ffffff 25%, #000000)"), [0.25, 0.25, 0.25, 1]);
  assert.deepEqual(parseColor("color-mix(in srgb, #ffffff, #000000 75%)"), [0.25, 0.25, 0.25, 1]);
  // Mixing with transparent keeps the colour and thins it.
  assert.deepEqual(parseColor("color-mix(in srgb, #ff0000 40%, transparent)"), [1, 0, 0, 0.4]);
  // As painted, a mix lands on 8 bits a channel.
  assert.deepEqual(painted(parseColor("color-mix(in srgb, #f08a72 16%, #1c1c1a)")), [
    62 / 255,
    46 / 255,
    40 / 255,
    1,
  ]);
});

test("a rule writes no literal colour, font, weight, size, radius, border width, shadow or duration", () => {
  const literals: [string, string, string][] = [
    ["color", "#fff", "a literal colour"],
    ["background", "rgb(0 0 0 / 0.32)", "a literal colour"],
    ["--chip-dot", "white", "a literal colour"],
    ["font-family", "Georgia, serif", "a literal font family"],
    ["font-weight", "600", "a literal weight"],
    ["font", "600 var(--text-sm) var(--font)", "a literal weight"],
    ["font", "var(--weight-strong) 12px var(--font)", "a literal font size"],
    ["font", "var(--text-sm) / 1.5 monospace", "a literal font family"],
    ["font-size", "0.9em", "a literal font size"],
    ["border-radius", "999px", "a literal radius"],
    ["border-radius", "var(--radius) 2px", "a literal radius"],
    ["border-top", "1px solid var(--line)", "a literal border width"],
    ["outline", "2px solid var(--focus)", "a literal border width"],
    ["box-shadow", "0 0 0 1px var(--focus)", "a literal border width"],
    ["box-shadow", "0 1px 2px var(--line)", "a literal shadow"],
    [
      "box-shadow",
      "0 0 0 var(--border-thin) var(--line), 0 1px 2px var(--line)",
      "a literal shadow",
    ],
    ["transition", "transform 200ms ease", "a literal transition duration"],
    [
      "transition",
      "transform var(--duration-move) ease, visibility 0s 200ms",
      "a literal transition duration",
    ],
  ];
  for (const [property, value, what] of literals)
    assert.equal(literal(property, value), what, `${property}: ${value}`);
  const fine: [string, string][] = [
    ["color", "var(--text)"],
    ["color", "currentColor"],
    ["background", "color-mix(in srgb, var(--accent) 20%, transparent)"],
    ["background", "none"],
    ["font", "inherit"],
    ["font", "var(--weight-regular) var(--text-md) / var(--leading) var(--font)"],
    ["font", "var(--text-sm) / 1.5 var(--font-mono)"],
    ["font-weight", "var(--weight-strong)"],
    ["border-radius", "50%"],
    ["border-radius", "50% 50% 50% 0"],
    ["border", "0"],
    ["border-top", "var(--border-thin) solid color-mix(in srgb, var(--line) 60%, transparent)"],
    ["border-inline-start", "var(--ask-mark)"],
    ["box-shadow", "inset 0 0 0 var(--border-thin) var(--todo)"],
    ["box-shadow", "0 0 0 var(--border-thin) var(--line), var(--shadow-sm)"],
    ["transition", "visibility 0s var(--duration-move)"],
    // The pulse and the dims stay literal: they aren't tokens.
    ["animation", "pulse 1.6s ease-in-out infinite"],
    ["opacity", "0.5"],
    // Space stays in its rule.
    ["padding", "0.375rem var(--space-3)"],
  ];
  for (const [property, value] of fine)
    assert.equal(literal(property, value), null, `${property}: ${value}`);
});

test("a theme sets only theme tokens, every colour in both schemes, and nothing else selects on it", () => {
  const css = `${windowCss}
:root[data-theme="probe"] {
  --page: 80rem;
  color: red;
  --accent: #123456;
  --shadow: none;
}
:root[data-theme="probe"] .button {
  color: var(--accent);
}
html {
  --accent: #123456;
}
`;
  const found = ruleProblems(css);
  for (const expected of [
    /--page, which isn't a theme token$/,
    /sets color, which isn't a theme token \(a shared property sits on html\)$/,
    /\.button selects on data-theme outside a theme block$/,
    /html sets --accent, a theme token; it belongs in a theme block$/,
    /: probe doesn't set --bg$/,
    /: probe sets --accent in light but not in dark$/,
    /: probe sets --shadow in one scheme; the default sets it per scheme$/,
  ])
    assert.ok(
      found.some((p) => expected.test(p)),
      `${expected} in:\n${found.join("\n")}`,
    );
});

test("a colour token derived from others needs no dark value of its own", () => {
  const css = withTheme(
    { "--surface-sunk": "color-mix(in srgb, var(--bg) 50%, var(--surface))", "--line": "#e0ded8" },
    {},
  );
  assert.ok(ruleProblems(css).includes("window.css: probe sets --line in light but not in dark"));
  assert.ok(!ruleProblems(css).some((p) => p.includes("--surface-sunk")));
});
