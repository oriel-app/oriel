// Themes (decision 0034): one set of rules in window.css, and a theme is a
// named block of values for its tokens. The default theme is `:root`; every
// other theme is `:root[data-theme="<name>"]`, with its dark values under
// `prefers-color-scheme`. Shared tokens sit on `html`. This file runs in
// Node, not in the browser: the repo check judges every theme from it, and
// the sketch route builds a theme's sheet from it, so neither can drift from
// the page.

import { sketchTokens } from "@oriel/core";
import type { TextSize } from "./src/view.ts";

export { sketchTokens };

export const defaultTheme = "graphite";

export type Scheme = "light" | "dark";

// One rule of a stylesheet: its selector, the at-rules around it, and its
// declarations in order, each with the line it starts on.
export type Rule = {
  selector: string;
  at: string[];
  line: number;
  declarations: { property: string; value: string; line: number }[];
};

// Every rule in `css`, keyframes' steps included. It reads only what
// window.css writes: comments, strings, nested at-rules and declarations.
// The last stylesheet read is kept, since every theme reads the same one.
let last: { css: string; rules: Rule[] } | null = null;
export function rules(css: string): Rule[] {
  if (last?.css !== css) last = { css, rules: parse(css) };
  return last.rules;
}

function parse(css: string): Rule[] {
  const out: Rule[] = [];
  const stack: ({ at: string } | { rule: Rule })[] = [];
  let line = 1;
  let start = 1;
  let text = "";
  const at = () => stack.flatMap((s) => ("at" in s ? [s.at] : []));
  const declare = () => {
    const top = stack.at(-1);
    const said = text.trim();
    text = "";
    if (said === "" || top === undefined || !("rule" in top)) return;
    const colon = said.indexOf(":");
    if (colon < 0) throw new Error(`window.css:${start}: not a declaration: ${said}`);
    top.rule.declarations.push({
      property: said.slice(0, colon).trim(),
      value: said.slice(colon + 1).trim(),
      line: start,
    });
  };
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const comment = css.slice(i, end < 0 ? css.length : end + 2);
      line += comment.split("\n").length - 1;
      i += comment.length - 1;
      text += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      text += css.slice(i, j + 1);
      i = j;
      continue;
    }
    if (text.trim() === "") start = line;
    if (c === "\n") line++;
    if (c === "{") {
      const head = text.trim().replace(/\s+/g, " ");
      text = "";
      if (head.startsWith("@")) stack.push({ at: head });
      else {
        const rule: Rule = { selector: head, at: at(), line: start, declarations: [] };
        out.push(rule);
        stack.push({ rule });
      }
    } else if (c === "}") {
      declare();
      stack.pop();
    } else if (c === ";") declare();
    else text += c;
  }
  return out;
}

const dark = "@media (prefers-color-scheme: dark)";
const themeSelector = /^:root(?:\[data-theme="([a-z][a-z0-9-]*)"\])?$/;

export type Block = { theme: string; scheme: Scheme; rule: Rule };

// Where a rule sets values for a theme or the shared tokens, if it does:
// `:root` and `html`, on their own or under the dark scheme. `html`'s
// narrow-screen block is layout, which no theme or sheet reads.
export function themeBlock(rule: Rule): Block | null {
  const scheme = rule.at.length === 0 ? "light" : rule.at.join() === dark ? "dark" : null;
  if (scheme === null) return null;
  if (rule.selector === "html") return { theme: "", scheme, rule };
  const theme = themeSelector.exec(rule.selector);
  if (theme === null) return null;
  return { theme: theme[1] ?? defaultTheme, scheme, rule };
}

// Every theme's name, the default first.
export function themeNames(css: string): string[] {
  const names = rules(css).flatMap((rule) => themeBlock(rule)?.theme ?? []);
  return [...new Set([defaultTheme, ...names.filter((n) => n !== "")])];
}

// Every custom property as the page has it on its root element, in `theme`
// and `scheme`: the shared tokens, the default theme's values, then the
// theme's own, which outrank the default's dark block. Values are as
// written, `var()` included.
export function tokens(css: string, theme: string, scheme: Scheme): Map<string, string> {
  const blocks = rules(css).flatMap((rule) => themeBlock(rule) ?? []);
  const layers = [
    ["", "light"],
    ["", "dark"],
    [defaultTheme, "light"],
    [defaultTheme, "dark"],
    ...(theme === defaultTheme
      ? []
      : [
          [theme, "light"],
          [theme, "dark"],
        ]),
  ].filter(([, s]) => s === "light" || scheme === "dark");
  const values = new Map<string, string>();
  for (const [name, s] of layers)
    for (const block of blocks)
      if (block.theme === name && block.scheme === s)
        for (const { property, value } of block.rule.declarations)
          if (property.startsWith("--")) values.set(property, value);
  return values;
}

// `value` with every `var()` replaced by what it names, as the browser
// computes it on the root element.
export function resolve(
  value: string,
  values: ReadonlyMap<string, string>,
  seen = new Set<string>(),
): string {
  return value.replace(/var\(\s*(--[a-z0-9-]+)\s*\)/g, (_, name: string) => {
    const named = values.get(name);
    if (named === undefined) throw new Error(`${name} has no value`);
    if (seen.has(name)) throw new Error(`${name} names itself`);
    return resolve(named, values, new Set([...seen, name]));
  });
}

// The root's size for a text size from Settings, as window.css's own
// `html[data-text-size]` rule sets it, or null for the default, which sets
// none.
export function textSizeValue(css: string, textSize: TextSize): string | null {
  if (textSize === "default") return null;
  const selector = `html[data-text-size="${textSize}"]`;
  const rule = rules(css).find((r) => r.at.length === 0 && r.selector === selector);
  const value = rule?.declarations.find((d) => d.property === "--text-size")?.value;
  if (value === undefined) throw new Error(`window.css sets no --text-size for ${textSize}`);
  return value;
}

// The sketch theme sheet for `theme` and `textSize`, built from window.css's
// own theme blocks: the tokens above under their own names, light and dark
// through `prefers-color-scheme`, every `var()` resolved, since the frame
// has no other sheet to look one up in; and the root's size, which every
// rem follows, as on the page.
export function sketchSheet(css: string, theme: string, textSize: TextSize): string {
  if (!themeNames(css).includes(theme)) throw new Error(`No theme is called ${theme}`);
  const size = textSizeValue(css, textSize);
  const block = (scheme: Scheme, indent: string) => {
    const values = tokens(css, theme, scheme);
    return sketchTokens.map((name) => {
      const value = values.get(name);
      if (value === undefined) throw new Error(`${name} has no value in ${theme}, ${scheme}`);
      return `${indent}${name}: ${resolve(value, values)};`;
    });
  };
  return [
    ":root {",
    "  color-scheme: light dark;",
    ...(size === null ? [] : [`  font-size: ${size};`]),
    ...block("light", "  "),
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    ...block("dark", "    "),
    "  }",
    "}",
    "",
  ].join("\n");
}
