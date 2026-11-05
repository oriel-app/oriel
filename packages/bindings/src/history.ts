// `history()`, in every module: items as the index holds them, with when
// the change log saw each start, finish and last change state (core's
// `historyOf`). It reads the index and the change log only, never a source,
// so a block built from it can be pinned (decision 0053). Its items are
// outside the region, as search()'s are, but it returns IDs and facets,
// never content, and nothing it finds can be read or written through it.
import { historyFields, optionalParam, read, string } from "@oriel/core";
import type { Fn, Host } from "./fn.ts";

export const historyFn: Fn = {
  space: null,
  outsideRegion: true,
  fields: historyFields,
  ...read({
    name: "history",
    doc: "The window's items, with when each started and was done, from the change log: an epic's or a workstream's, by ID, or all.",
    params: [optionalParam("of", "string", string)],
    returns: "History",
    run: ([of], host: Host) => host.history(of ?? null),
  }),
};

// What it returns, under one doc. Fixed text.
export const historyTypes = [
  "/** A date at `since` means by then. */",
  "type History = { asOf: string; since: string; items: { id: string; kind: string | null; state: string | null; assignee: string | null; epic: string | null; estimate: number | null; startedAt: string | null; doneAt: string | null; daysInState: number | null }[] };",
];
