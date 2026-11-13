// Text is content, never markup, every way: nothing in it is interpreted.
import {
  array,
  type Infer,
  object,
  optional,
  type PanelInline,
  type PanelProse,
  record,
  string,
  unknown,
} from "@oriel/core";

// `adfToText` reads it back unchanged, except that a run of blank lines comes back as one.
export function textToAdf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text.split(/\n{2,}/).map((paragraph) => ({
      type: "paragraph",
      content: paragraph
        .split("\n")
        .flatMap((line, i) => [
          ...(i > 0 ? [{ type: "hardBreak" }] : []),
          ...(line ? [{ type: "text", text: line }] : []),
        ]),
    })),
  };
}

// Each node is checked on its own, so one odd node drops out instead of
// taking the whole document with it.
const adfNode = object({
  type: string,
  text: optional(string),
  attrs: optional(record(unknown)),
  marks: optional(array(object({ type: string, attrs: optional(record(unknown)) }))),
  content: optional(array(unknown)),
});
type Node = Infer<typeof adfNode>;

const node = (input: unknown): Node | null => {
  const result = adfNode(input);
  return result.ok ? result.value : null;
};

const blockTypes = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "decisionList",
  "blockquote",
  "codeBlock",
  "rule",
  "panel",
  "expand",
  "nestedExpand",
  "table",
  "mediaSingle",
  "mediaGroup",
  "blockCard",
  "embedCard",
  "bodiedExtension",
  "layoutSection",
  "layoutColumn",
]);

const attr = (n: Node, name: string) => {
  const value = n.attrs?.[name];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};
const children = (n: Node) => (n.content ?? []).map(node).filter((child) => child !== null);
const indent = (text: string, prefix: string, rest = " ".repeat(prefix.length)) =>
  text
    .split("\n")
    .map((line, i) => (i === 0 ? prefix : rest) + line)
    .join("\n");

export function adfToText(doc: unknown): string {
  const root = node(doc);
  return root ? render(root) : "";
}

function render(n: Node): string {
  const inline = () => children(n).map(render).join("");
  const blocks = (separator = "\n\n") => children(n).map(render).join(separator);
  switch (n.type) {
    case "doc":
    case "panel":
    case "layoutSection":
    case "layoutColumn":
    case "bodiedExtension":
      return blocks();
    case "blockquote":
      return indent(blocks(), "> ", "> ");
    case "text":
      return text(n);
    case "hardBreak":
      return "\n";
    case "paragraph":
    case "heading":
    case "codeBlock":
    case "decisionItem":
      return inline();
    case "bulletList":
    case "decisionList":
      return children(n)
        .map((item) => indent(render(item), "- "))
        .join("\n");
    case "orderedList": {
      const start = Number(attr(n, "order")) || 1;
      return children(n)
        .map((item, i) => indent(render(item), `${start + i}. `))
        .join("\n");
    }
    case "taskList":
      return blocks("\n");
    case "taskItem":
      return indent(inline(), attr(n, "state") === "DONE" ? "[x] " : "[ ] ");
    case "listItem":
      return blocks("\n");
    case "expand":
    case "nestedExpand": {
      const title = attr(n, "title");
      return [title, blocks()].filter(Boolean).join("\n\n");
    }
    case "table":
      return blocks("\n");
    case "tableRow":
      return children(n)
        .map((cell) => render(cell).replaceAll("\n", " "))
        .join(" | ");
    case "tableCell":
    case "tableHeader":
      return blocks(" ");
    case "rule":
      return "---";
    case "mention":
      return attr(n, "text") || "@someone";
    case "emoji":
      return attr(n, "text") || attr(n, "shortName");
    case "status":
      return attr(n, "text");
    case "date": {
      const ms = Number(attr(n, "timestamp"));
      return Number.isFinite(ms) && ms !== 0 ? new Date(ms).toISOString().slice(0, 10) : "";
    }
    case "inlineCard":
    case "blockCard":
    case "embedCard":
      return attr(n, "url");
    case "media":
    case "mediaInline":
      return "[attachment]";
    case "mediaSingle":
    case "mediaGroup":
      return blocks("\n");
    default: {
      if (n.text !== undefined) return text(n);
      const parts = children(n);
      return parts
        .map(render)
        .join(parts.some((child) => blockTypes.has(child.type)) ? "\n\n" : "");
    }
  }
}

function text(n: Node): string {
  const words = n.text ?? "";
  const link = n.marks?.find((mark) => mark.type === "link")?.attrs?.href;
  return typeof link === "string" && link && link !== words ? `${words} (${link})` : words;
}

export function plainDocument(doc: unknown): boolean {
  const root = node(doc);
  const plain = (n: Node): boolean =>
    ["doc", "paragraph", "text", "hardBreak"].includes(n.type) &&
    (n.marks ?? []).length === 0 &&
    children(n).every(plain);
  return root === null || plain(root);
}

const deepest = 8;

// A link is kept only to an http(s) address; any other is its words.
export function adfToProse(doc: unknown): PanelProse[] {
  const root = node(doc);
  return root ? proseOf(root, 0) : [];
}

function proseOf(n: Node, depth: number): PanelProse[] {
  const inner = () => children(n).flatMap((child) => proseOf(child, depth + 1));
  const said = (inlines: PanelInline[]): PanelProse[] =>
    inlines.length === 0 ? [] : [{ kind: "paragraph", children: inlines }];
  if (depth >= deepest) return said(textInline(render(n)));
  switch (n.type) {
    case "doc":
    case "panel":
    case "layoutSection":
    case "layoutColumn":
    case "bodiedExtension":
    case "mediaSingle":
    case "mediaGroup":
    case "listItem":
      return children(n).flatMap((child) => proseOf(child, depth));
    case "paragraph":
    case "decisionItem":
      return said(inlinesOf(n));
    case "heading": {
      const level = Math.min(Math.max(Number(attr(n, "level")) || 1, 1), 6);
      return [{ kind: "heading", level, children: inlinesOf(n) }];
    }
    case "bulletList":
    case "decisionList":
    case "orderedList":
    case "taskList": {
      const ordered = n.type === "orderedList";
      const items = children(n).map((item) => proseOf(item, depth + 1));
      return [
        {
          kind: "list",
          ordered,
          start: ordered ? Number(attr(n, "order")) || 1 : 1,
          tight: items.every((item) => item.length <= 1),
          items,
        },
      ];
    }
    case "taskItem":
      return said([
        { kind: "text", text: attr(n, "state") === "DONE" ? "☑ " : "☐ " },
        ...inlinesOf(n),
      ]);
    case "blockquote":
      return [{ kind: "quote", children: inner() }];
    case "codeBlock":
      return [{ kind: "code", text: children(n).map(render).join("") }];
    case "rule":
      return [{ kind: "rule" }];
    case "expand":
    case "nestedExpand": {
      const title = attr(n, "title");
      return [
        ...(title ? said([{ kind: "strong", children: [{ kind: "text", text: title }] }]) : []),
        ...inner(),
      ];
    }
    case "table":
      return children(n).flatMap((row) => said(textInline(render(row))));
    case "blockCard":
    case "embedCard":
      return said(inlineOf({ ...n, type: "inlineCard" }));
    default:
      if (blockTypes.has(n.type) || children(n).some((child) => blockTypes.has(child.type)))
        return inner();
      return said(inlineOf(n));
  }
}

const textInline = (text: string): PanelInline[] => (text ? [{ kind: "text", text }] : []);

const inlinesOf = (n: Node): PanelInline[] => children(n).flatMap(inlineOf);

function inlineOf(n: Node): PanelInline[] {
  switch (n.type) {
    case "text":
      return marked(n);
    case "hardBreak":
      return [{ kind: "break" }];
    case "mention":
      return [{ kind: "mention", text: render(n) }];
    case "inlineCard": {
      const url = attr(n, "url");
      const href = webHref(url);
      return href ? [{ kind: "link", href, children: textInline(url) }] : textInline(url);
    }
    case "paragraph":
    case "heading":
      return inlinesOf(n);
    default:
      return n.text === undefined && n.content !== undefined ? inlinesOf(n) : textInline(render(n));
  }
}

function marked(n: Node): PanelInline[] {
  const words = n.text ?? "";
  if (words === "") return [];
  const marks = new Set((n.marks ?? []).map((mark) => mark.type));
  let out: PanelInline[] = [
    marks.has("code") ? { kind: "code", text: words } : { kind: "text", text: words },
  ];
  if (marks.has("em")) out = [{ kind: "em", children: out }];
  if (marks.has("strong")) out = [{ kind: "strong", children: out }];
  const link = n.marks?.find((mark) => mark.type === "link")?.attrs?.href;
  const href = typeof link === "string" ? webHref(link) : null;
  return href ? [{ kind: "link", href, children: out }] : out;
}

function webHref(href: string): string | null {
  const url = URL.parse(href);
  return url && (url.protocol === "http:" || url.protocol === "https:") ? url.href : null;
}
