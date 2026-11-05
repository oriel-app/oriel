// What works for any item in the region, whatever its source: `items.read()`
// and `items.list()`, which return its title and text, and the escape hatch.
import { type ItemId, number, optionalParam, param, read, searchFields, string } from "@oriel/core";
import { type Fn, type Host, outside } from "./fn.ts";

const field = (content: unknown, key: string): unknown =>
  typeof content === "object" && content !== null && key in content
    ? (content as Record<string, unknown>)[key]
    : null;

// The guest's view of any item: its title and text, and nothing the reader
// added. Both are the source's content, read live like the rest: they reach
// the model in the run's result, never in the declarations.
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

// A second look's `items.read()` (decision 0054) reads this run's
// search() hits too, read-only, since what else a change touches is mostly
// outside its workstream: the host refuses any other ID, and a read of one
// outside the region is the escape hatch, as a namespace's is.
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

export const searchFn: Fn = {
  space: null,
  outsideRegion: true,
  fields: searchFields,
  ...read({
    name: "search",
    doc: "Anything indexed, in this region or outside it, by key or title words.",
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
      }));
    },
  }),
};

const itemDoc = "An item read live, from any source: its title and its text.";

// What `items` and `search()` add to the declarations: `Item` says what the
// items of each source the region holds are, one line per source.
export const itemTypes = (docs: readonly string[]) => [
  ...(docs.length
    ? ["/**", ` * ${itemDoc}`, ...docs.map((doc) => ` * - ${doc}`), " */"]
    : [`/** ${itemDoc} */`]),
  "type Item = { id: RegionId; gone: false; title: string; text: string };",
  "/** An item that can't be read any more. */",
  'type Gone = { id: RegionId; gone: true; reason: "deleted" | "forbidden" | "moved" };',
  "/** An ID that search() found. Writes don't take it. */",
  'type FoundId = string & { __brand: "FoundId" };',
  "/** A search() result, read-only. */",
  "type Found = { id: FoundId; title: string; location: string; updatedAt: string };",
];
