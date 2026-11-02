// A thread: a workstream, a chat and change sets (decision 0018). It is pinned to
// its workstream and works in one version of it, its region. Its state is derived
// from what happened in it, never stored (packages/db derives it).
import { holderName, maxReasonChars } from "./actions.ts";
import { type Instant, isUlid, type Ulid } from "./ids.ts";
import { boolean, type Infer, literal, object, refine, string, union } from "./validate.ts";

// Working until a change set applies or the user marks it done; handed off
// when the assignee changes or an external link is attached; dropped after 7
// idle days. A new message makes any of the others working again.
export const threadStates = ["working", "done", "handed-off", "dropped"] as const;
export type ThreadState = (typeof threadStates)[number];

export type Thread = {
  id: Ulid;
  workspaceId: Ulid;
  workstreamId: Ulid;
  // A working thread moves to its workstream's latest version when the workstream
  // changes, with a marker in the chat; any other keeps its version.
  regionVersion: number;
  state: ThreadState;
  // How a done thread got there; null unless done.
  doneBy: "applied" | "marked" | null;
  createdAt: Instant;
};

// Who a held message is from: anyone but the thread's user. Their words wait
// in the thread until the user sends them to the agent, as they are or
// edited, or discards them, and nothing held reaches the agent before then
// (decision 0024). Each kind of sender is one variant, named for the kind of
// actor it is, and carries what the user reads its message by. A review
// link's holder sends why they rejected the change set the link names, under
// the name they typed; `askFirst`: Oriel is to ask what was wrong with it
// before the reason reaches the agent, as it couldn't as it was held
// (mid-turn), and never does for an Undo. Another thread's agent (OA-89) and
// an outside tool (OA-75) join here, each as one more variant and its limit
// below.
export const heldSender = union(
  object({
    kind: literal("review-link"),
    by: holderName,
    changeSet: refine(string, isUlid, "expected a change set ID"),
    askFirst: boolean,
  }),
);
export type HeldSender = Infer<typeof heldSender>;

// How long a held message may be, by who it is from: what each sender
// controls, it is capped at.
export const maxHeldChars: Record<HeldSender["kind"], number> = {
  "review-link": maxReasonChars,
};

// What a held message says: not blank, and within its sender's limit.
export const heldText = (from: HeldSender, text: string): boolean =>
  text.trim() !== "" && text.length <= maxHeldChars[from.kind];

// A line Oriel writes in a thread about what someone did. It is Oriel's,
// never the agent's: the window shows it as Oriel's, and the agent reads it
// as a note from Oriel, never as something it said (OA-91). Each kind is one
// variant. `rejected`: a change set of the thread was rejected, in the thread
// or on its review link, and Oriel asks what was wrong with it, naming the
// change set so two rejections can't be confused (OA-86).
export const orielNote = union(
  object({
    kind: literal("rejected"),
    changeSet: refine(string, isUlid, "expected a change set ID"),
    via: union(literal("thread"), literal("review-link")),
  }),
);
export type OrielNote = Infer<typeof orielNote>;
