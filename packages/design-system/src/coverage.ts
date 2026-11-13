import { readdirSync } from "node:fs";
import { classesIn, documentedClasses, pages, type Page } from "./guide.ts";
import { nameRefs, type Node } from "./md.ts";
import { oriel, source, themes, windowCss } from "./oriel.ts";

export const listFile = "UNDOCUMENTED.md";

export type Entry = {
  names: string[];
  gone: boolean;
  file: string | null;
  reason: string;
  text: string;
};

export function stylesheetClasses(css = windowCss()): Set<string> {
  const out = new Set<string>();
  for (const rule of themes.rules(css))
    for (const m of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1] ?? "");
  return out;
}

export function components(): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  for (const f of readdirSync(`${oriel}/packages/web/src`).sort()) {
    if (!f.endsWith(".tsx")) continue;
    const file = `packages/web/src/${f}`;
    for (const m of (source(file) ?? "").matchAll(/^export (?:default )?function ([A-Z]\w*)/gm))
      out.push({ name: m[1] ?? "", file });
  }
  return out;
}

const guidePages = (): Page[] => pages().filter((p) => p.file.startsWith("guide/"));

const fences = /^```(\w*)[^\n]*\n([\s\S]*?)^```/gm;
const selectorClasses = (text: string) =>
  [...text.matchAll(/(?<![\w-])\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? "");

export function covered(): { classes: Set<string>; names: Set<string> } {
  const classes = new Set<string>();
  const names = new Set<string>();
  for (const p of guidePages()) {
    for (const c of documentedClasses(p)) classes.add(c);
    for (const s of p.specimens) for (const c of classesIn(s.html)) classes.add(c);
    for (const [, lang, body = ""] of p.text.matchAll(fences))
      if (lang === "css") for (const c of selectorClasses(body)) classes.add(c);
    const prose = p.text.replace(fences, "");
    for (const [, span = ""] of prose.matchAll(/`([^`\n]+)`/g)) {
      for (const c of selectorClasses(span)) classes.add(c);
      for (const [w = ""] of span.matchAll(/\b[A-Z]\w*\b/g)) names.add(w);
    }
  }
  return { classes, names };
}

export function entries(nodes: Node[]): Entry[] {
  const out: Entry[] = [];
  const item = /^((?:`[^`\n]+`(?:, and |, | and )?)+?)(?: in `([^`\n]+)`)?: (.+)$/s;
  let gone = false;
  const walk = (ns: Node[]) => {
    for (const n of ns)
      if (n.kind === "heading" && n.level === 2) gone = n.text.startsWith("Gone");
      else if (n.kind === "list")
        for (const i of n.items) {
          const m = item.exec(i.text);
          if (m) {
            const [, list = "", file, reason = ""] = m;
            const names = [...list.matchAll(/`([^`\n]+)`/g)].map((x) => x[1] ?? "");
            const ref = nameRefs(i.text)[0];
            out.push({
              names,
              gone,
              file: file ? (ref?.file ?? file) : null,
              reason,
              text: i.text,
            });
          } else out.push({ names: [], gone, file: null, reason: "", text: i.text });
          walk(i.children);
        }
  };
  walk(nodes);
  return out;
}

export function matches(name: string, cls: string): boolean {
  if (!name.startsWith(".")) return false;
  const bare = name.slice(1);
  if (bare.endsWith("-*")) {
    const stem = bare.slice(0, -2);
    return cls === stem || cls.startsWith(`${stem}-`);
  }
  return cls === bare;
}

export function goneClasses(list: Page | undefined): Set<string> {
  const listed = list ? entries(list.nodes) : [];
  return new Set(listed.filter((e) => e.gone).flatMap((e) => e.names.map((n) => n.slice(1))));
}

export type Gap = { kind: "class" | "component"; name: string; file: string };

export function coverage(list: Page | undefined): {
  checked: number;
  gaps: Gap[];
  stale: string[];
  listed: Entry[];
} {
  const { classes, names } = covered();
  const listed = list ? entries(list.nodes) : [];
  const stale: string[] = [];
  const gaps: Gap[] = [];
  const all = stylesheetClasses();
  const exported = components();
  const classNames = listed.flatMap((e) =>
    e.gone ? [] : e.names.filter((n) => n.startsWith(".")),
  );
  const componentNames = new Set(listed.flatMap((e) => e.names.filter((n) => !n.startsWith("."))));

  for (const e of listed) {
    if (e.names.length === 0 || e.reason.trim() === "") {
      stale.push(
        `${listFile} has a line that isn't names, a colon and a reason ("${e.text.slice(0, 50)}"): write it as - \`.name\`: why`,
      );
      continue;
    }
    for (const n of e.names) {
      if (e.gone) {
        if (!n.startsWith(".") || n.endsWith("-*"))
          stale.push(`${listFile} lists ${n} under "Gone from Oriel": list whole classes there`);
        else if (all.has(n.slice(1)))
          stale.push(
            `${listFile} lists ${n} as gone, but window.css has it again: take it off that list`,
          );
        else if (!classes.has(n.slice(1)))
          stale.push(`${listFile} lists ${n} as gone, and no page cites it now: take the line off`);
      } else if (n.startsWith(".")) {
        const hits = [...all].filter((c) => matches(n, c));
        if (hits.length === 0)
          stale.push(
            `${listFile} lists ${n}, which matches no class in window.css: take the line off`,
          );
        else if (hits.every((c) => classes.has(c)))
          stale.push(`${listFile} lists ${n}, which pages document now: take the line off`);
      } else {
        const found = exported.find((x) => x.name === n);
        if (found === undefined)
          stale.push(
            `${listFile} lists ${n}, which packages/web/src doesn't export: take the line off`,
          );
        else if (e.file !== found.file)
          stale.push(
            `${listFile} says ${n} is in ${e.file ?? "no file"}, but it's in ${found.file}: fix the file`,
          );
        else if (names.has(n))
          stale.push(`${listFile} lists ${n}, which a page documents now: take the line off`);
      }
    }
  }
  for (const c of [...all].sort())
    if (!classes.has(c) && !classNames.some((n) => matches(n, c)))
      gaps.push({ kind: "class", name: c, file: "window.css" });
  for (const x of exported)
    if (!names.has(x.name) && !componentNames.has(x.name))
      gaps.push({ kind: "component", name: x.name, file: x.file });
  return { checked: all.size + exported.length, gaps, stale, listed };
}
