// Reads the index and change log only, never a source; it returns IDs and facets, never content,
// and nothing it finds can be read or written through it.
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

export const historyTypes = [
  "/** A date at `since` means by then. */",
  "type History = { asOf: string; since: string; items: { id: string; kind: string | null; state: string | null; assignee: string | null; epic: string | null; estimate: number | null; startedAt: string | null; doneAt: string | null; daysInState: number | null }[] };",
];
