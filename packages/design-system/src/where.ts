import { readdirSync } from "node:fs";
import { join } from "node:path";
import { oriel, source, themes, windowCssPath } from "./oriel.ts";

export type Place = { file: string; line: number; text: string };

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
