// What a source shows of one item in the panel beside the page: its own view
// of the item, from a live read, as typed blocks the web renders as elements.
// Every string here is source content or Oriel's words about it, always shown
// as text and never parsed as HTML: anyone who can edit the source can write
// it. Types only, and it imports nothing, so the web package can import it
// under its DOM-only config and the import is erased from the browser build.

export type PanelBlock =
  // Facts about the item, in the source's words for them: its status,
  // assignee and estimate, a message's channel.
  | { kind: "facts"; facts: { name: string; value: string }[] }
  // A body of text, such as a description or a file. `markdown`: the web
  // reads it into its own blocks, as it does an agent's reply; `plain`: shown
  // as written, line by line.
  | { kind: "text"; heading: string | null; text: string; format: "markdown" | "plain" }
  // Messages in the order they were written, each with its author and when
  // (an instant), such as a conversation or an issue's comments. `empty` says
  // what none means here.
  | {
      kind: "messages";
      heading: string | null;
      messages: { author: string; at: string; text: string }[];
      empty: string;
    }
  // Oriel's own words about the read, such as a file too large to show.
  | { kind: "note"; text: string };

// A source's view of an item: its blocks, and a title when the item's own
// would only repeat them, as a message's first line repeats the message. Null
// keeps the item's title.
export type PanelView = { title: string | null; blocks: PanelBlock[] };

// A source's view of an item from what its read returned (`content`, checked
// by the adapter), or null when the content isn't in a shape it can read.
export type PanelOf = (content: unknown) => PanelView | null;
