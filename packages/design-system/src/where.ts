// Where a name is in the Oriel checkout today. The guide cites Oriel by name,
// never by line, so a line added above a rule doesn't make a page wrong:
//
// - in a stylesheet, a selector (`.connect-actions`, `.menu-item:hover`), an
//   at-rule (`@keyframes pulse`) or a custom property (`--accent`);
// - in code, a top-level declaration: a component, function, constant, type
//   or class (`FieldsStep`);
// - in markdown, a heading's text, or the start of it (`2. Words`).
//
// `pnpm -s ds where <name>` prints the lines, for anyone who wants them.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { oriel, source, themes, windowCssPath } from "./oriel.ts";

export type Place = { file: string; line: number; text: string };

// A selector list's selectors, split at the commas outside brackets.
export function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of list) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += c;
  }
  out.push(current);
  return out.map(normal).filter((s) => s !== "");
}

const normal = (s: string) => s.trim().replace(/\s+/g, " ");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The lines `name` is on in `text`, the contents of `file`.
export function find(file: string, text: string, name: string): number[] {
  if (file.endsWith(".css")) {
    if (name.startsWith("@")) {
      const at = new RegExp(`^\\s*${escapeRe(normal(name))}(?=[\\s{;]|$)`);
      return text.split("\n").flatMap((l, i) => (at.test(normal(l)) ? [i + 1] : []));
    }
    const rules = themes.rules(text);
    if (name.startsWith("--"))
      return rules.flatMap((r) =>
        r.declarations.filter((d) => d.property === name).map((d) => d.line),
      );
    const wanted = normal(name);
    return rules.filter((r) => selectors(r.selector).includes(wanted)).map((r) => r.line);
  }
  if (/\.(ts|tsx|js|mjs)$/.test(file)) {
    const declared = new RegExp(
      `^(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|type|interface|enum)\\s+${escapeRe(name)}\\b`,
    );
    return text.split("\n").flatMap((l, i) => (declared.test(l) ? [i + 1] : []));
  }
  if (file.endsWith(".md"))
    return text
      .split("\n")
      .flatMap((l, i) =>
        /^#+\s/.test(l) && l.replace(/^#+\s+/, "").startsWith(name) ? [i + 1] : [],
      );
  return [];
}

// Every line `name` is on in `file`, or null if the file isn't there.
export function where(file: string, name: string): Place[] | null {
  const text = source(file);
  if (text === null) return null;
  const all = text.split("\n");
  return find(file, text, name).map((line) => ({
    file,
    line,
    text: (all[line - 1] ?? "").trim(),
  }));
}

// The files a name is looked for in when no file is given: window.css, the
// packages' source, the scripts, and the spec. This package's own guide is
// left out: it cites names, it doesn't hold them.
export function sourceFiles(): string[] {
  const out = [windowCssPath, "SPEC.md", "CLAUDE.md"];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(join(oriel, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (["node_modules", "dist", "build"].includes(e.name) || e.name.startsWith(".")) continue;
      const path = `${dir}/${e.name}`;
      if (path === "packages/design-system") continue;
      if (e.isDirectory()) walk(path);
      else if (/\.(ts|tsx|css|md)$/.test(e.name) && path !== windowCssPath) out.push(path);
    }
  };
  walk("packages");
  walk("scripts");
  walk("docs");
  return out;
}

export function whereAnywhere(name: string): Place[] {
  return sourceFiles().flatMap((file) => where(file, name) ?? []);
}
