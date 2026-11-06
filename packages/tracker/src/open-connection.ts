// The stand-in tracker's one connection, over Oriel's own store of its issues
// (decision 0059), which the composition root lends it: its source reads
// them, its writer writes them, and a person's edit in its panel applies at
// once. Nothing syncs it: its index rows are its issues.
import type { Instant, Opened, OpenVia, OwnItems, ToOpen } from "@oriel/core";
import { unknown } from "@oriel/core";
import { trackerEditor } from "./edit.ts";
import { trackerSource } from "./source.ts";

// What its writer is built from: the store, and the clock its issues' update
// times are read from.
export type TrackerWrites = { own: OwnItems; now: () => Instant };

// Its namespace's context: that it's on. A namespace with none offers
// nothing, as the tracker is off.
export type TrackerOn = { on: true };

export async function openTracker(
  _connection: ToOpen,
  via: OpenVia,
): Promise<Opened<TrackerOn, undefined, TrackerWrites>> {
  const own = via.own;
  if (!own) throw new Error("the tracker opens only over Oriel's own store");
  const writes = { own, now: via.now };
  const edit = trackerEditor(writes);
  return {
    source: trackerSource(own),
    attrs: unknown,
    about: "Oriel's own tracker",
    scope: undefined,
    context: () => ({ on: true }),
    writes,
    edit,
    problem: () => "Oriel couldn't read its own tracker.",
  };
}
