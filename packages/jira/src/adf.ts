// Atlassian Document Format, Jira's rich text, to and from plain text. Text is
// content, never markup, both ways: nothing in it is interpreted.
import { array, type Infer, object, optional, record, string, unknown } from "@oriel/core";

// Plain text as a document: blank lines split paragraphs and single newlines
// become hard breaks. `adfToText` reads it back unchanged.
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

// Blocks are separated by a blank line, list items by a newline. Unknown nodes
// keep their children's text.
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

// A link keeps its address beside its words, unless they are the same.
function text(n: Node): string {
  const words = n.text ?? "";
  const link = n.marks?.find((mark) => mark.type === "link")?.attrs?.href;
  return typeof link === "string" && link && link !== words ? `${words} (${link})` : words;
}
