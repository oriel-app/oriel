// The interface the server builds the agent against. The lead owns it: change
// it there first.
import type {
  ActionLine,
  Bindings,
  Block,
  ChallengeHost,
  ChallengeRun,
  ChangeSets,
  ChangeSetState,
  Draft,
  Instant,
  Intent,
  Log,
  AgentNote,
  ProxiedRead,
  Region,
  Run,
  RunLimits,
  RunResult,
  Sandbox,
  SearchHit,
  Shown,
  Sketch,
  SketchRefusal,
  Thread,
  Ulid,
} from "@oriel/core";
import type { Provider } from "./provider.ts";

// One user message in a thread, run to completion.
export type TurnInput = {
  thread: Thread;
  // The version of the thread's workstream this turn uses.
  region: Region;
  // Prior messages, oldest first.
  history: ChatMessage[];
  // The user's message.
  text: string;
  // The index snapshot this turn reads (`indexStore.snapshot(workspaceId)`);
  // each run records it (SPEC §7). Required: a default of 0 would record
  // "never synced".
  snapshot: number;
  // Tokens spent in earlier turns, summed from their `done` events, so
  // `maxTokensPerThread` covers the whole thread. Required: optional would let
  // the cap silently become per-turn.
  spent: { inputTokens: number; outputTokens: number };
  // A run Oriel started for a second look at a change set (the challenger
  // spike): each run's module gets `challenge`, and the turn proposes
  // nothing. What its runs capture are only suggestions, which the server
  // keeps with what the run recorded; it captures no change set, applies no
  // intent and holds no draft.
  challenge?: ChallengeHost;
};

export type ChatMessage =
  | { role: "user"; text: string; at: Instant }
  | { role: "assistant"; text: string; at: Instant }
  // "added SYN-12", "removed plan.md" (decision 0018).
  | { role: "marker"; text: string; at: Instant }
  // What Oriel did with the intents a turn recorded: each call, applied or
  // refused and why (decision 0024).
  | { role: "actions"; text: string; at: Instant }
  // Oriel's own line about what someone did, such as rejecting a change set:
  // the model reads it as Oriel's, never as its own words (OA-91). Its check
  // of an answer's quotes is the window's alone.
  | { role: "note"; note: AgentNote; at: Instant }
  // Where each of the thread's change sets stands as the turn starts, as the
  // window shows it, newest first: never stored, so it is current whatever
  // happened to them between turns (OA-310).
  | { role: "states"; changeSets: readonly { id: Ulid; state: ChangeSetState }[]; at: Instant }
  // A compact record of a sandbox run, for history. With its script, history
  // replays the run faithfully.
  | { role: "run"; runId: Ulid; summary: string; script?: string; at: Instant };

// What a turn emits, in order. The server persists each and streams it to the
// window. A turn always ends with exactly one `done`, even when aborted, with
// the usage so far. `run.started` comes before the run row exists: the run is
// recorded when it finishes, so persist nothing with a foreign key to `runs`
// until `run.finished`.
export type AgentEvent =
  // Assistant text, possibly in deltas.
  | { kind: "text"; text: string }
  | { kind: "run.started"; runId: Ulid; script: string }
  // Reads and transcript.
  | { kind: "run.finished"; runId: Ulid; result: RunResult }
  // The escape hatch, rendered as its own block (SPEC §1.6).
  | { kind: "search"; runId: Ulid; hits: SearchHit[] }
  // A block the agent asked for, which Oriel built from a read the turn ran
  // (decision 0030): shown under the reply, so they come after its text.
  | { kind: "block"; runId: Ulid; block: Block }
  // A block a run asked for and Oriel refused, for telemetry; the run's
  // result told the agent why.
  | { kind: "block.refused"; runId: Ulid }
  // A sketch a run asked for, as Oriel checked it (decision 0033): shown
  // under the reply with the blocks, in the order asked for.
  | { kind: "sketch"; runId: Ulid; sketch: Sketch }
  // A sketch a run asked for and Oriel refused, by why, for telemetry; the
  // run's result told the agent what to change.
  | { kind: "sketch.refused"; runId: Ulid; reason: SketchRefusal }
  // Captured mutations awaiting approval.
  | { kind: "change-set"; changeSetId: Ulid }
  // What became of the intents the turn's last run (`runId`) recorded,
  // applied or refused, one line each: the host's record, shown under the
  // agent's reply (decision 0024). Or of the additions to the thread's own
  // workstream that run `runId` recorded, as it ended (OA-312).
  | { kind: "actions"; runId: Ulid; lines: ActionLine[] }
  // A per-thread cap that ends the turn: turns or tokens (SPEC §9). A
  // run-level cap (wall time, reads, mutations, output) isn't one: it shows as
  // `run.finished` with that outcome, and the model sees the error and can
  // carry on.
  | { kind: "limit"; reason: string }
  | { kind: "error"; message: string }
  | { kind: "done"; usage: { inputTokens: number; outputTokens: number } };

export interface Agent {
  turn(input: TurnInput, options: { signal: AbortSignal; log: Log }): AsyncIterable<AgentEvent>;
}

export type AgentLimits = {
  // User messages: the history's and this one.
  maxTurnsPerThread: number;
  maxTokensPerThread: number;
  run: RunLimits;
  maxMutationsPerChangeSet: number;
};

// The server builds the agent once at startup.
export type AgentDeps = {
  provider: Provider;
  sandbox: Sandbox;
  // The server wires each source's namespace in. Oriel's own actions
  // default to the thread's workstream and the thread. `shown` builds the
  // block a run asks for, from a read its turn ran, and shows the sketch it
  // asks for, and says what it did.
  bindingsFor: (
    region: Region,
    thread: Ulid,
    shown?: Shown,
    options?: { challenge?: ChallengeRun },
  ) => Bindings;
  // Captured mutations become a change set.
  changeSets: Pick<ChangeSets, "capture">;
  // Applies a turn's intents as the thread's agent, once its change set, if
  // it proposed one, is captured; says what it applied and what it refused.
  // A run's additions to the thread's own workstream apply as the run ends
  // (OA-312): `region` is then the version the thread works in, which the
  // rest of the turn uses.
  actions: {
    apply(
      turn: { thread: Thread; changeSetId: Ulid | null },
      intents: readonly Intent[],
    ): Promise<ActionLine[]>;
    region(thread: Thread): Region | null;
  };
  // Holds a turn's drafts in the thread, under its reply, for the user to
  // apply, edit or discard (decision 0051): never applied here.
  drafts: { hold(thread: Thread, drafts: readonly Draft[]): Promise<void> | void };
  runs: { record(run: Run, reads: ProxiedRead[]): void };
  limits: AgentLimits;
  now: () => Instant;
  newId: () => Ulid;
};
