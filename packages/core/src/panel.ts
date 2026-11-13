// Every string here is source content or Oriel's words about it, shown as text, never parsed as HTML: anyone who can
// edit the source can write it. It imports nothing, so the web package can import it under its DOM-only config.

export type PanelBlock =
  | { kind: "facts"; facts: { name: string; value: string }[] }
  | { kind: "text"; heading: string | null; text: string; format: "markdown" | "plain" }
  | { kind: "rich"; heading: string | null; prose: PanelProse[] }
  | {
      kind: "messages";
      heading: string | null;
      messages: PanelMessage[];
      empty: string;
    }
  | { kind: "note"; text: string };

export type PanelMessage = {
  author: string;
  at: string;
  text: string;
  spans?: PanelInline[];
  prose?: PanelProse[];
  edited?: string;
  files?: string[];
  labels?: string[];
};

// A link's `href` is http(s), or the source's text has none: anything else is plain text.
export type PanelInline =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em"; children: PanelInline[] }
  | { kind: "link"; href: string; children: PanelInline[] }
  | { kind: "mention" | "channel"; text: string };

export type PanelProse =
  | { kind: "paragraph"; children: PanelInline[] }
  | { kind: "heading"; level: number; children: PanelInline[] }
  | { kind: "list"; ordered: boolean; start: number; tight: boolean; items: PanelProse[][] }
  | { kind: "quote"; children: PanelProse[] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

export type PanelView = { title: string | null; blocks: PanelBlock[]; edit?: PanelEdit };

export type PanelEdit = { fields: PanelEditField[] };
export type PanelEditField = { name: string; label: string } & (
  | { kind: "line" | "text"; value: string }
  | { kind: "choice"; value: string; choices: string[] }
  | { kind: "number"; value: number | null; empty: string }
  | { kind: "person"; value: string | null; empty: string }
  | { kind: "list"; value: string[] }
);

export type PanelOf = (content: unknown) => PanelView | null;
