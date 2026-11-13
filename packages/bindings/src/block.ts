// The turn builds the block from what the named read returned, so a script can't hand Oriel a block's numbers.
import { param, read, unknown } from "@oriel/core";
import type { Fn, Host } from "./fn.ts";

export const showFn: Fn = {
  space: null,
  outsideRegion: false,
  ...read({
    name: "show",
    doc: "A block from a read this turn ran (same args): rows, bars (summed by label), a table, or a chart.",
    params: [
      param(
        "b",
        '{ read: string; args?: unknown[]; from?: string; form: "rows" | "bars" | "table" | "series" | "timeline" | "spread" | "pivot"; [k: string]: unknown }',
        unknown,
      ),
    ],
    returns: "string",
    run: async ([spec], host: Host) => host.show(spec),
  }),
};
