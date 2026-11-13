import { type ItemId, number, optionalParam, param, read, searchFields, string } from "@oriel/core";
import { type Fn, type Host, outside } from "./fn.ts";

const field = (content: unknown, key: string): unknown =>
  typeof content === "object" && content !== null && key in content
    ? (content as Record<string, unknown>)[key]
    : null;

// Both are the source's content: they reach the model in the run's result, never in the declarations.
function itemView(id: ItemId, content: unknown) {
  const title = field(content, "title");
  const text = field(content, "text");
  if (typeof title !== "string" || typeof text !== "string")
    throw new Error(`the source returned ${id} in a shape Oriel can't read`);
  return { id, gone: false as const, title, text };
}

const readItem: Fn = {
  space: "items",
  outsideRegion: false,
  ...read({
    name: "read",
    doc: "One item in this region, read live.",
    params: [param("id", "RegionId", string)],
    returns: "Item | Gone",
    run: async ([id], host: Host) => {
      if (!host.has(id)) throw outside(id);
      const [view] = await host.read([id], itemView);
      return view;
    },
  }),
};

const listItems: Fn = {
  space: "items",
  outsideRegion: false,
  fields: {
    source: "this workstream's items, read live",
    lists: { "": { id: "Item", title: "Title" } },
  },
  ...read({
    name: "list",
    doc: "Every item in this region, in RegionId order.",
    params: [],
    returns: "readonly (Item | Gone)[]",
    run: (_, host: Host) => host.read(host.ids, itemView),
  }),
};

export const itemFns: readonly Fn[] = [readItem, listItems];

// Reads this run's search() hits too, read-only: the host refuses any other ID, and a read outside the region is the escape hatch.
const readAnyItem: Fn = {
  space: "items",
  outsideRegion: false,
  ...read({
    name: "read",
    doc: "One item in this region, or one this run's search() found, read live.",
    params: [param("id", "RegionId | FoundId", string)],
    returns: "Item | Gone",
    run: async ([id], host: Host) => {
      const [view] = await host.read([id as ItemId], itemView);
      return view;
    },
  }),
};

export const challengeItemFns: readonly Fn[] = [readAnyItem, listItems];

// Reads the items the messages were about too, read-only: no write takes them.
const readLookedItem: Fn = {
  space: "items",
  outsideRegion: false,
  ...read({
    name: "read",
    doc: "One item in this region, or one the user looked at, read live.",
    params: [param("id", "RegionId | LookedId", string)],
    returns: "Item | Gone",
    run: async ([id], host: Host) => {
      const [view] = await host.read([id as ItemId], itemView);
      return view;
    },
  }),
};

export const lookedItemFns: readonly Fn[] = [readLookedItem, listItems];

export const searchFn: Fn = {
  space: null,
  outsideRegion: true,
  fields: searchFields,
  ...read({
    name: "search",
    doc: "Anything indexed, in this region or outside it, by key, title or text words; title hits first.",
    params: [param("query", "string", string), optionalParam("limit", "number", number)],
    returns: "readonly Found[]",
    run: async ([query, limit], host: Host) => {
      const count = Math.min(Math.max(Math.trunc(limit ?? 20), 1), 50);
      const records = await host.search(query, count);
      return records.slice(0, count).map((r) => ({
        id: r.id,
        title: r.title,
        location: r.location,
        updatedAt: r.updatedAt,
        ...(r.excerpt === undefined ? {} : { excerpt: r.excerpt }),
      }));
    },
  }),
};

const itemDoc = "An item read live, from any source: its title and its text.";

export const itemTypes = (docs: readonly string[]) => [
  ...(docs.length
    ? ["/**", ` * ${itemDoc}`, ...docs.map((doc) => ` * - ${doc}`), " */"]
    : [`/** ${itemDoc} */`]),
  "type Item = { id: RegionId; gone: false; title: string; text: string };",
  "/** An item that can't be read any more. */",
  'type Gone = { id: RegionId; gone: true; reason: "deleted" | "forbidden" | "moved" };',
  "/** An ID that search() found. Writes don't take it. */",
  'type FoundId = string & { __brand: "FoundId" };',
  "/** A search() result, read-only. `excerpt`: where its text matched. */",
  "type Found = { id: FoundId; title: string; location: string; updatedAt: string; excerpt?: string };",
];
