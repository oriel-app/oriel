import type {
  About,
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

export type TurnInput = {
  thread: Thread;
  region: Region;
  history: ChatMessage[];
  text: string;
  about?: About;
  windowChat?: true;
  // Required: a default of 0 would record "never synced".
  snapshot: number;
  // Required: optional would let `maxTokensPerThread` silently become per-turn.
  spent: { inputTokens: number; outputTokens: number };
  challenge?: ChallengeHost;
};

export type ChatMessage =
  | { role: "user"; text: string; about?: About; at: Instant }
  | { role: "assistant"; text: string; at: Instant }
  | { role: "marker"; text: string; at: Instant }
  | { role: "actions"; text: string; at: Instant }
  | { role: "note"; note: AgentNote; at: Instant }
  | { role: "states"; changeSets: readonly { id: Ulid; state: ChangeSetState }[]; at: Instant }
  | { role: "run"; runId: Ulid; summary: string; script?: string; at: Instant };

// `run.started` comes before the run row exists, so persist nothing with a foreign key to `runs`
// until `run.finished`.
export type AgentEvent =
  | { kind: "text"; text: string }
  | { kind: "run.started"; runId: Ulid; script: string }
  | { kind: "run.finished"; runId: Ulid; result: RunResult }
  | { kind: "search"; runId: Ulid; hits: SearchHit[] }
  | { kind: "block"; runId: Ulid; block: Block }
  | { kind: "block.refused"; runId: Ulid }
  | { kind: "sketch"; runId: Ulid; sketch: Sketch }
  | { kind: "sketch.refused"; runId: Ulid; reason: SketchRefusal }
  | { kind: "change-set"; changeSetId: Ulid; revised?: true }
  | { kind: "actions"; runId: Ulid; lines: ActionLine[] }
  | { kind: "limit"; reason: string }
  | { kind: "error"; message: string }
  | { kind: "done"; usage: { inputTokens: number; outputTokens: number } };

export interface Agent {
  turn(input: TurnInput, options: { signal: AbortSignal; log: Log }): AsyncIterable<AgentEvent>;
}

export type AgentLimits = {
  maxTurnsPerThread: number;
  maxTokensPerThread: number;
  run: RunLimits;
  maxMutationsPerChangeSet: number;
};

export type AgentDeps = {
  provider: Provider;
  sandbox: Sandbox;
  bindingsFor: (
    region: Region,
    thread: Ulid,
    shown?: Shown,
    options?: { challenge?: ChallengeRun; revise?: (id: string) => Promise<string> },
  ) => Bindings;
  changeSets: Pick<ChangeSets, "capture" | "revise" | "revisable">;
  actions: {
    apply(
      turn: { thread: Thread; changeSetId: Ulid | null },
      intents: readonly Intent[],
    ): Promise<ActionLine[]>;
    region(thread: Thread): Region | null;
  };
  drafts: { hold(thread: Thread, drafts: readonly Draft[]): Promise<void> | void };
  runs: { record(run: Run, reads: ProxiedRead[]): void };
  limits: AgentLimits;
  now: () => Instant;
  newId: () => Ulid;
};
