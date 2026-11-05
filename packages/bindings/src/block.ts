// `show()`: the one binding for blocks (decision 0030). The agent names a
// read this turn ran, its arguments and the block's form; the turn builds
// the block from what that read returned (core's `buildBlock`), so a script
// can't hand Oriel a block's numbers. The turn checks the spec too, so a
// wrong one is refused with what each form takes, rather than failing the
// run: the declaration stays short, and the refusal teaches the rest:
// `from`, and each form's fields, which the type leaves open.
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
