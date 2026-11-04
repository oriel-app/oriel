// A choice the agent found (the decision-desk spike), checked as the agent
// hands it to Oriel. Every quote must be in its item word for word, as a
// quote from an item in an answer is (decision 0032), read live as the
// agent's `items.read()` and the panel read it. Oriel then dates each quote
// from the source's own view of the item, the one its panel draws: the
// message it is in, with that message's author and when, as the source
// records them; or the item's body, which has no one date, by its heading.
// Who said what and when is Oriel's, from the source, never the agent's.
// Each item's update time, as the index has it now, goes with the quote, so
// the window can tell when the evidence changed since.
import {
  type ChoiceAsk,
  type Choice,
  type Evidence,
  type IndexRecord,
  type Instant,
  type ItemId,
  type PanelBlock,
  type PanelProse,
  type PanelInline,
  parseItemId,
  type Reader,
  type Region,
  type SourceDeclaration,
  type SourceKind,
} from "@oriel/core";
import { wordForWord } from "./quotes.ts";

export type ChoiceDeps = {
  reader: Pick<Reader, "read">;
  records: () => readonly IndexRecord[];
  sources: Readonly<Record<SourceKind, Pick<SourceDeclaration, "panel">>>;
  now: () => Instant;
};

export type Checked = { ok: true; choice: Omit<Choice, "id"> } | { ok: false; why: string };

const inline = (parts: readonly PanelInline[]): string =>
  parts
    .map((part) =>
      part.kind === "break"
        ? "\n"
        : "children" in part
          ? inline(part.children)
          : "text" in part
            ? part.text
            : "",
    )
    .join("");

const prose = (blocks: readonly PanelProse[]): string =>
  blocks
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
        case "heading":
          return inline(block.children);
        case "list":
          return block.items.map(prose).join("\n");
        case "quote":
          return prose(block.children);
        case "code":
          return block.text;
        case "rule":
          return "";
      }
    })
    .join("\n");

// Where in an item a quote is, as its source's view of it shows: a message,
// with who and when; else a body, by its heading; else null.
export function placeOf(
  quote: string,
  blocks: readonly PanelBlock[],
): { author: string | null; at: Instant | null; place: string } | null {
  for (const block of blocks)
    if (block.kind === "messages")
      for (const message of block.messages) {
        const text = message.prose ? prose(message.prose) : message.text;
        if (wordForWord(quote, text) || wordForWord(quote, message.text))
          return { author: message.author, at: message.at as Instant, place: "message" };
      }
  for (const block of blocks) {
    const text =
      block.kind === "text" ? block.text : block.kind === "rich" ? prose(block.prose) : null;
    if (text !== null && wordForWord(quote, text))
      return {
        author: null,
        at: null,
        place: (block.kind === "text" || block.kind === "rich" ? block.heading : null) ?? "text",
      };
  }
  return null;
}

// Checks what the agent handed `choices.add()` against the region's items.
export function choiceChecker(deps: ChoiceDeps) {
  return async (ask: ChoiceAsk, region: Region): Promise<Checked> => {
    const members = new Set<string>(region.items.map((item) => item.id));
    const cited = [...new Set(ask.options.flatMap((o) => o.evidence.map((e) => e.id)))];
    const stray = cited.filter((id) => !members.has(id));
    if (stray.length)
      return {
        ok: false,
        why: `${stray.join(", ")} ${stray.length === 1 ? "isn't" : "aren't"} in this workstream; quote only its items.`,
      };
    const records = new Map(deps.records().map((record) => [record.id, record]));
    const views = new Map<string, { blocks: PanelBlock[]; text: string; asOf: Instant }>();
    const unread: string[] = [];
    for (const result of await deps.reader.read(cited as ItemId[])) {
      const record = records.get(result.id);
      const source = deps.sources[parseItemId(result.id)?.kind ?? ""];
      if (result.status !== "ok" || !record || !source) {
        unread.push(result.id);
        continue;
      }
      const panel = source.panel(result.content);
      views.set(result.id, {
        blocks: panel?.blocks ?? [],
        text: `${result.content.title}\n${result.content.text}`,
        asOf: record.updatedAt,
      });
    }
    if (unread.length)
      return { ok: false, why: `Oriel can't read ${unread.join(", ")} now; leave it out.` };
    const missed: string[] = [];
    const options = ask.options.map((option) => ({
      ...option,
      evidence: option.evidence.flatMap((e): Evidence[] => {
        const view = views.get(e.id);
        if (!view) return [];
        const found = placeOf(e.quote, view.blocks);
        if (found) return [{ ...e, ...found, asOf: view.asOf }];
        // In the item's text, but in none of its view's parts, as a line
        // its source adds around a message: found, with no date.
        if (wordForWord(e.quote, view.text))
          return [{ ...e, author: null, at: null, place: "text", asOf: view.asOf }];
        missed.push(`${JSON.stringify(e.quote.slice(0, 80))} in ${e.id}`);
        return [];
      }),
    }));
    if (missed.length)
      return {
        ok: false,
        why: `these quotes aren't in their items word for word: ${missed.slice(0, 5).join("; ")}. Read the item and copy its words exactly.`,
      };
    return {
      ok: true,
      choice: { question: ask.question, options, open: ask.open, checkedAt: deps.now() },
    };
  };
}
