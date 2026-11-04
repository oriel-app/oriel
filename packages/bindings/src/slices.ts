// `slices()`: the agent proposes release slices of its workstream (the
// scope-lab spike). It names what each slice defers, the outcomes kept and
// lost in its own words, and what items need, citing what it read; the turn
// checks it against the region (core's `buildSlices`) and Oriel computes
// every figure, which the result tells the agent. A wrong one is refused
// with what to change, as a tool result, rather than failing the run.
import { param, read, unknown } from "@oriel/core";
import type { Fn, Host } from "./fn.ts";

export const slicesFn: Fn = {
  space: null,
  outsideRegion: false,
  ...read({
    name: "slices",
    doc: "Propose 2-3 release slices; Oriel computes every figure.",
    params: [
      param(
        "p",
        "{ slices: { name: string; defer: string[]; keeps: string[]; loses: string[] }[]; needs?: { item: string; on: string; from: string[] }[] }",
        unknown,
      ),
    ],
    returns: "string",
    run: async ([input], host: Host) => host.slices(input),
  }),
};
