// `choices`, in the module of a run Oriel starts to find a workstream's open
// choices only (the decision-desk spike), as `window` is in the window
// chat's: empty, and undeclared, everywhere else, so no other module or
// prompt changes. The agent hands Oriel its reading of one choice; the turn
// checks each quote against its item and dates it (the server's
// `checkChoice`), and shows the choice under the reply, or refuses with
// what to change, as a tool result, rather than failing the run. The types
// say what each standing means, so the run's message stays short.
import { param, read, unknown } from "@oriel/core";
import type { Fn, Host } from "./fn.ts";

const add: Fn = {
  space: "choices",
  outsideRegion: false,
  ...read({
    name: "add",
    doc: "Hands Oriel one open choice, once per choice. Copy each quote exactly from its item; Oriel checks and dates it.",
    params: [param("c", "Choice", unknown)],
    returns: "string",
    run: async ([input], host: Host) => host.choice?.(input) ?? notHere,
  }),
};

const notHere = "Oriel shows choices only in a run it started to find them.";

export const choiceFns: readonly Fn[] = [add];

// Fixed text: what a choice is, and what each standing and role means.
export const choiceTypes = [
  "/** Someone put it forward | those who decide said yes to exactly it | a later agreed change replaced it. A later or louder reply is not agreement. */",
  'type Standing = "proposed" | "agreed" | "superseded";',
  'type Evidence = { id: RegionId; quote: string; role: "proposes" | "agrees" | "objects" | "amends" | "asks" };',
  "/** `open`: what nobody has answered yet. */",
  "type Choice = { question: string; options: { label: string; standing: Standing; evidence: Evidence[] }[]; open: string[] };",
];
