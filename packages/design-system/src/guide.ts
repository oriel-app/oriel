// The guide: every page the workshop shows, read from markdown on each
// request, so an edit shows on reload. A page is one file, and that file is
// what a builder `cat`s: its guidance, its specimens as ```html fences, and
// its `file:line` references into Oriel.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Fence, type Front, frontMatter, type Node, parse } from "./md.ts";
import { root } from "./oriel.ts";

export type Section =
  | "foundations"
  | "content"
  | "components"
  | "patterns"
  | "screens"
  | "lab"
  | "docs";

export const sections: { id: Section; title: string; blurb: string }[] = [
  {
    id: "foundations",
    title: "Foundations",
    blurb: "Tokens, type, space, motion, focus, icons and layout.",
  },
  { id: "content", title: "Content", blurb: "How Oriel writes: its voice, its words, its errors." },
  {
    id: "components",
    title: "Components",
    blurb: "What Oriel draws today, and the rules for each.",
  },
  { id: "patterns", title: "Patterns", blurb: "How components combine for one job." },
  { id: "screens", title: "Screens", blurb: "Composed screens, built only from the components." },
  {
    id: "lab",
    title: "Controls lab",
    blurb: "Proposed form controls in modern CSS, beside today's.",
  },
  {
    id: "docs",
    title: "Reports",
    blurb: "The drift report, the controls report, and what no page covers yet.",
  },
];

export type Status = "stable" | "drifting" | "proposed";
export const statuses: Status[] = ["stable", "drifting", "proposed"];

export type Specimen = {
  id: string;
  title: string;
  html: string;
  info: Record<string, string>;
  flags: string[];
};

export type Page = {
  section: Section;
  slug: string;
  url: string;
  // Repo-relative, for the plain-text reader.
  file: string;
  title: string;
  front: Front;
  nodes: Node[];
  text: string;
  specimens: Specimen[];
};

const docs: { slug: string; file: string; url: string }[] = [
  { slug: "drift", file: "DRIFT.md", url: "/drift" },
  { slug: "controls", file: "CONTROLS.md", url: "/controls" },
  { slug: "undocumented", file: "UNDOCUMENTED.md", url: "/undocumented" },
  { slug: "readme", file: "README.md", url: "/readme" },
];

function read(section: Section, slug: string, file: string, url: string): Page {
  const raw = readFileSync(join(root, file), "utf8");
  const { front, body } = frontMatter(raw);
  const nodes = parse(body);
  const heading = nodes.find((n) => n.kind === "heading" && n.level === 1);
  const title = front["title"] ?? (heading?.kind === "heading" ? heading.text : slug);
  return { section, slug, url, file, title, front, nodes, text: raw, specimens: specimens(nodes) };
}

function specimens(nodes: Node[]): Specimen[] {
  const out: Specimen[] = [];
  const walk = (list: Node[]) => {
    for (const node of list) {
      if (node.kind === "fence" && isSpecimen(node.fence)) out.push(specimen(node.fence));
      if (node.kind === "list") for (const item of node.items) walk(item.children);
      if (node.kind === "quote") walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export const isSpecimen = (fence: Fence): boolean =>
  fence.lang === "html" && fence.flags.includes("specimen");

export function specimen(fence: Fence): Specimen {
  const id = fence.info["id"] ?? "";
  return {
    id,
    title: fence.info["title"] ?? id,
    html: fence.text,
    info: fence.info,
    flags: fence.flags,
  };
}

let cache: { at: number; pages: Page[] } | null = null;

// Every page, in each section's order. Read again at most once a second.
export function pages(): Page[] {
  if (cache && Date.now() - cache.at < 1000) return cache.pages;
  const out: Page[] = [];
  for (const { id } of sections) {
    if (id === "docs") {
      for (const d of docs)
        if (existsSync(join(root, d.file))) out.push(read("docs", d.slug, d.file, d.url));
      continue;
    }
    const dir = join(root, "guide", id);
    if (!existsSync(dir)) continue;
    const section = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const slug = f.slice(0, -3);
        return read(id, slug, `guide/${id}/${f}`, `/${id}/${slug}`);
      })
      .sort(
        (a, b) =>
          Number(a.front["order"] ?? 50) - Number(b.front["order"] ?? 50) ||
          a.title.localeCompare(b.title),
      );
    out.push(...section);
  }
  cache = { at: Date.now(), pages: out };
  return out;
}

export function page(url: string): Page | undefined {
  return pages().find((p) => p.url === url);
}

// The classes a component documents, from its `classes:` line.
export function documentedClasses(p: Page): string[] {
  return (p.front["classes"] ?? "")
    .split(/[\s,]+/)
    .map((c) => c.replace(/^\./, ""))
    .filter(Boolean);
}

// Every class attribute's classes in some HTML, the workshop's own `ws-`
// ones aside.
export function classesIn(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/\bclass="([^"]*)"/g))
    for (const c of (m[1] ?? "").split(/\s+/)) if (c && !c.startsWith("ws-")) out.add(c);
  return [...out];
}

// A specimen's markup as a builder would copy it: without the workshop's
// forced states and hooks.
export function snippet(html: string): string {
  return html
    .replace(/\s+data-ws-[a-z-]+(="[^"]*")?/g, "")
    .replace(/class="([^"]*)"/g, (_, list: string) => {
      const kept = list
        .split(/\s+/)
        .filter((c) => c && !c.startsWith("ws-"))
        .join(" ");
      return `class="${kept}"`;
    })
    .replace(/\s+class=""/g, "")
    .trim();
}
