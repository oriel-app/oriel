// A small markdown reader for the guide: what its pages use and no more.
// Headings, paragraphs, lists (nested by two spaces), quotes, tables, rules
// and fenced code, with code spans, strong, em and links inline. A fence's
// info string can make it a specimen (```html specimen id=…) or a live
// table (```live …), which the page that renders it fills in.

export type Front = Record<string, string>;

export type Fence = { lang: string; info: Record<string, string>; flags: string[]; text: string };

export type Node =
  | { kind: "heading"; level: number; text: string; id: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; children: Node[] }[] }
  | { kind: "quote"; children: Node[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "rule" }
  | { kind: "fence"; fence: Fence };

export function frontMatter(text: string): { front: Front; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (match === null) return { front: {}, body: text };
  const front: Front = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) front[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { front, body: text.slice(match[0].length) };
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/`|\*|\[|\]\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// `key=value`, `key="a value"` and bare flags, after the language.
export function fenceInfo(info: string): Omit<Fence, "text"> {
  const [lang = ""] = info.trim().split(/\s+/);
  const out: Record<string, string> = {};
  const flags: string[] = [];
  const body = info.trim().slice(lang.length);
  for (const m of body.matchAll(/([a-z-]+)(?:=(?:"([^"]*)"|(\S+)))?/g)) {
    const [, key = "", quoted, bare] = m;
    if (quoted === undefined && bare === undefined) flags.push(key);
    else out[key] = quoted ?? bare ?? "";
  }
  return { lang, info: out, flags };
}

export function parse(text: string): Node[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const ids = new Map<string, number>();
  return blocks(lines, ids);
}

function uniqueId(text: string, ids: Map<string, number>): string {
  const base = slug(text) || "section";
  const n = ids.get(base) ?? 0;
  ids.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

const listItem = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;

function blocks(lines: string[], ids: Map<string, number>): Node[] {
  const out: Node[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = /^(`{3,})(.*)$/.exec(line);
    if (fence) {
      const close = fence[1] ?? "```";
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith(close)) body.push(lines[i++] ?? "");
      i++;
      out.push({ kind: "fence", fence: { ...fenceInfo(fence[2] ?? ""), text: body.join("\n") } });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const text = (heading[2] ?? "").trim();
      out.push({ kind: "heading", level: heading[1]?.length ?? 1, text, id: uniqueId(text, ids) });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      out.push({ kind: "rule" });
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith(">"))
        body.push((lines[i++] ?? "").replace(/^>\s?/, ""));
      out.push({ kind: "quote", children: blocks(body, ids) });
      continue;
    }
    if (line.trim().startsWith("|") && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? "")) {
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map((c) => c.trim().replace(/\\\|/g, "|"));
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|"))
        rows.push(cells(lines[i++] ?? ""));
      out.push({ kind: "table", head, rows });
      continue;
    }
    const item = listItem.exec(line);
    if (item) {
      const indent = item[1]?.length ?? 0;
      const ordered = /\d/.test(item[2] ?? "");
      const items: { text: string; children: Node[] }[] = [];
      while (i < lines.length) {
        const m = listItem.exec(lines[i] ?? "");
        if (!m || (m[1]?.length ?? 0) !== indent) break;
        const text = [m[3] ?? ""];
        const inner: string[] = [];
        i++;
        // Continuation lines and nested lists, until the next item at this
        // indent or a line less indented.
        while (i < lines.length) {
          const next = lines[i] ?? "";
          const nested = listItem.exec(next);
          if (nested && (nested[1]?.length ?? 0) <= indent) break;
          if (next.trim() === "") {
            const after = lines[i + 1] ?? "";
            if (after.startsWith(" ".repeat(indent + 2))) {
              inner.push("");
              i++;
              continue;
            }
            break;
          }
          if (!next.startsWith(" ".repeat(indent + 1))) break;
          if (nested || inner.length > 0) inner.push(next.slice(indent + 2));
          else text.push(next.trim());
          i++;
        }
        items.push({ text: text.join(" "), children: blocks(inner, ids) });
      }
      out.push({ kind: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (l.trim() === "" || /^(#{1,6}\s|`{3,}|>|\s*([-*]|\d+[.)])\s)/.test(l)) break;
      if (l.trim().startsWith("|") && para.length === 0) break;
      para.push(l.trim());
      i++;
    }
    if (para.length === 0) {
      para.push(line.trim());
      i++;
    }
    out.push({ kind: "paragraph", text: para.join(" ") });
  }
  return out;
}

export const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A file in the Oriel checkout, as a page names it in a code span.
const fileName = String.raw`(?:packages|scripts|docs)\/[\w./-]+|window\.css|SPEC\.md|CLAUDE\.md`;

// A reference into the Oriel checkout in a code span: a file, `window.css`,
// or a file and line, `window.css:278`. Guide pages cite names, not lines
// (see `nameRef`); only the dated reports, DRIFT.md and CONTROLS.md, keep
// lines.
export const sourceRef = new RegExp(`^(${fileName})(?::(\\d+)(?:-(\\d+))?)?$`);

// A name cited in a file: `.connect-actions` in `window.css`, `FieldsStep`
// in `packages/web/src/connect-steps.tsx`, or a list of them, `.a`, `.b`
// and `.c` in `window.css`. A count before "in" says how many times the
// name is there: `.connect-actions` twice in `window.css`.
const span = "`[^`\\n]+`";
const nameRef = new RegExp(
  `((?:${span}(?:, and |, or |, | and | or ))*${span})(?: (twice|three times|four times|\\d+ times))? in \`(${fileName})\``,
  "g",
);

const counts: Record<string, number> = { twice: 2, "three times": 3, "four times": 4 };

export type NameRef = { file: string; name: string; count: number | null; at: number };

// Every name a text cites, with where its code span starts.
export function nameRefs(text: string): NameRef[] {
  const out: NameRef[] = [];
  for (const m of text.matchAll(nameRef)) {
    const [, list = "", times, file = ""] = m;
    const count = times === undefined ? null : (counts[times] ?? Number.parseInt(times));
    for (const n of list.matchAll(/`([^`\n]+)`/g))
      out.push({
        file: refPath(file),
        name: n[1] ?? "",
        count,
        at: (m.index ?? 0) + (n.index ?? 0),
      });
  }
  return out;
}

export function refPath(file: string): string {
  return file === "window.css" ? "packages/web/assets/window.css" : file;
}

// `at`, for a dated report, is the Oriel commit its lines were written at:
// a line link opens the file as it was then.
export function inline(text: string, at?: string): string {
  // Code spans first, held aside, so nothing inside them is read as markup
  // and bold or a link can still hold one.
  const held: string[] = [];
  const plain: string[] = [];
  const named = new Map(nameRefs(text).map((r) => [r.at, r]));
  const bare = text.replace(/`([^`]+)`/g, (_, code: string, offset: number) => {
    const ref = sourceRef.exec(code);
    const name = named.get(offset);
    if (name) {
      const href = `/source/${name.file}?find=${encodeURIComponent(name.name)}`;
      held.push(`<a class="ws-ref" href="${escape(href)}"><code>${escape(code)}</code></a>`);
    } else if (ref) {
      const [, file = "", line] = ref;
      const then = line && at ? `?at=${at}` : "";
      const href = `/source/${refPath(file)}${then}${line ? `#L${line}` : ""}`;
      held.push(`<a class="ws-ref" href="${href}"><code>${escape(code)}</code></a>`);
    } else held.push(`<code>${escape(code)}</code>`);
    plain.push(`<code>${escape(code)}</code>`);
    return `\uE000${held.length - 1}\uE000`;
  });
  let html = escape(bare);
  // Screenshots are taken at 2x, as `pnpm shots` takes them.
  html = html.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_, alt: string, src: string) =>
      `<img class="ws-shot" srcset="${src} 2x" alt="${alt}" loading="lazy">`,
  );
  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label: string, href: string) =>
      `<a href="${href}">${label.replace(/\uE000(\d+)\uE000/g, "\uE001$1\uE001")}</a>`,
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return html
    .replace(/\uE000(\d+)\uE000/g, (_, i: string) => held[Number(i)] ?? "")
    .replace(/\uE001(\d+)\uE001/g, (_, i: string) => plain[Number(i)] ?? "");
}

// Every link a page's text makes, for the link check.
export function links(nodes: Node[]): string[] {
  const out: string[] = [];
  const from = (text: string) => {
    for (const m of text.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) out.push(m[1] ?? "");
  };
  for (const node of nodes) {
    if (node.kind === "paragraph" || node.kind === "heading") from(node.text);
    if (node.kind === "list")
      for (const item of node.items) {
        from(item.text);
        out.push(...links(item.children));
      }
    if (node.kind === "quote") out.push(...links(node.children));
    if (node.kind === "table") for (const row of [node.head, ...node.rows]) row.forEach(from);
  }
  return out;
}

// Every reference into Oriel a page's text makes, outside its fences, for
// the reference check: files and lines, and names.
export function refs(text: string): {
  files: { file: string; line: number | null; end: number | null }[];
  names: NameRef[];
} {
  const files: { file: string; line: number | null; end: number | null }[] = [];
  const bare = text.replace(/^```[\s\S]*?^```/gm, "");
  for (const m of bare.matchAll(/`([^`\n]+)`/g)) {
    const ref = sourceRef.exec(m[1] ?? "");
    if (ref)
      files.push({
        file: refPath(ref[1] ?? ""),
        line: ref[2] ? Number(ref[2]) : null,
        end: ref[3] ? Number(ref[3]) : null,
      });
  }
  return { files, names: nameRefs(bare) };
}

export type Render = { fence(fence: Fence): string | null; at?: string };

export function html(nodes: Node[], render: Render): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "heading": {
          const tag = `h${node.level}`;
          return `<${tag} id="${node.id}"><a class="ws-anchor" href="#${node.id}" aria-label="Link to this section">#</a>${inline(node.text, render.at)}</${tag}>`;
        }
        case "paragraph":
          return `<p>${inline(node.text, render.at)}</p>`;
        case "list": {
          const tag = node.ordered ? "ol" : "ul";
          const items = node.items
            .map((item) => `<li>${inline(item.text, render.at)}${html(item.children, render)}</li>`)
            .join("");
          return `<${tag}>${items}</${tag}>`;
        }
        case "quote":
          return `<blockquote>${html(node.children, render)}</blockquote>`;
        case "table": {
          const head = node.head
            .map((c) => `<th scope="col">${inline(c, render.at)}</th>`)
            .join("");
          const rows = node.rows
            .map(
              (r) =>
                `<tr>${node.head.map((_, j) => `<td>${inline(r[j] ?? "", render.at)}</td>`).join("")}</tr>`,
            )
            .join("");
          return `<div class="ws-table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
        }
        case "rule":
          return "<hr>";
        case "fence":
          return (
            render.fence(node.fence) ??
            `<pre class="ws-code"><code${node.fence.lang ? ` data-lang="${escape(node.fence.lang)}"` : ""}>${escape(node.fence.text)}</code></pre>`
          );
      }
      return "";
    })
    .join("\n");
}
