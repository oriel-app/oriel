// One proposal per turn, for every agent (decision 0024). The last run that
// finished and captured mutations makes the turn's change set; the last
// that finished and recorded intents gives the intents that apply; and the
// last that finished and drafted any gives the drafts held for the user
// (decision 0051). A run with only some of them doesn't drop an earlier
// run's others, and a run that failed proposes nothing. A stopped turn
// applies and holds nothing. When the turn ends, the change set is captured
// first, then the intents apply, so the host can refuse one that would
// break it, then the drafts are held. Only a run's additions to the
// thread's own workstream apply sooner, as the run ends, so the rest of the
// turn can read and write what joined (OA-312): no later run replaces them.
import type {
  ActionLine,
  CapturedMutation,
  ChallengeRun,
  Draft,
  Intent,
  Log,
  Region,
  RunResult,
  Thread,
  Ulid,
} from "@oriel/core";
import type { AgentDeps, AgentEvent, TurnInput } from "./contract.ts";

// What a run's bindings get in a second look (decision 0054): its
// `challenge`, which records under the run's ID. Any other turn's get none.
// A second look's turn proposes nothing: its writes are suggestions the
// server keeps, so it never settles a proposal.
export const challengeOf = (
  input: Pick<TurnInput, "challenge">,
  runId: Ulid,
): { challenge: ChallengeRun } | undefined => {
  const { challenge } = input;
  if (!challenge) return undefined;
  return { challenge: { diff: challenge.diff, record: (f) => challenge.record(runId, f) } };
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// What a finished run replaced of an earlier run's proposal in the turn.
export type Replaced = { mutations: number; intents: number; drafts: number };

// Whether an intent adds items to the thread's own workstream.
const joins = (intent: Intent, thread: Thread) =>
  intent.action === "workstream.add" && intent.input["workstream"] === thread.workstreamId;

// What a run's additions to the thread's own workstream came to, applied as
// it ended: the run as the rest of the turn proposes it, without them; the
// host's lines for them; and the region the turn uses from then on.
export type Joined = { result: RunResult; lines: ActionLine[]; region: Region };

export function proposal() {
  let writes: { runId: Ulid; mutations: CapturedMutation[] } | null = null;
  let asked: { runId: Ulid; intents: Intent[] } | null = null;
  let drafted: { runId: Ulid; drafts: Draft[] } | null = null;

  return {
    // A run that finished: its additions to the thread's own workstream
    // apply now, in a turn that isn't stopped or a second look's, and the
    // turn moves to the version they made. Its other intents wait for the
    // turn's end, as `ran` takes them.
    async *joined(
      deps: Pick<AgentDeps, "actions">,
      input: Pick<TurnInput, "thread" | "challenge">,
      region: Region,
      runId: Ulid,
      result: RunResult,
      signal: AbortSignal,
      log: Log,
    ): AsyncGenerator<AgentEvent, Joined, undefined> {
      const { thread } = input;
      const now = result.intents.filter((intent) => joins(intent, thread));
      if (result.outcome !== "ok" || !now.length || input.challenge || signal.aborted)
        return { result, lines: [], region };
      const rest = { ...result, intents: result.intents.filter((i) => !joins(i, thread)) };
      try {
        const lines = await deps.actions.apply({ thread, changeSetId: null }, now);
        log("agent.joined", {
          run_id: runId,
          applied: lines.filter((line) => line.applied).length,
          refused: lines.filter((line) => !line.applied).length,
        });
        yield { kind: "actions", runId, lines };
        const moved = deps.actions.region(thread);
        const same = moved?.workstreamId === region.workstreamId;
        return { result: rest, lines, region: moved && same ? moved : region };
      } catch (error) {
        const message = `Oriel couldn't carry out what the agent asked of it: ${errorText(error)}`;
        log("agent.error", { error: message });
        yield { kind: "error", message };
        // They wait for the turn's end, as any other intent does.
        return { result, lines: [], region };
      }
    },

    // A run that finished: its writes, its intents and its drafts replace
    // earlier ones.
    ran(runId: Ulid, result: RunResult): Replaced {
      const replaced = { mutations: 0, intents: 0, drafts: 0 };
      if (result.outcome !== "ok") return replaced;
      if (result.mutations.length) {
        replaced.mutations = writes?.mutations.length ?? 0;
        writes = { runId, mutations: result.mutations };
      }
      if (result.intents.length) {
        replaced.intents = asked?.intents.length ?? 0;
        asked = { runId, intents: result.intents };
      }
      if (result.drafts.length) {
        replaced.drafts = drafted?.drafts.length ?? 0;
        drafted = { runId, drafts: result.drafts };
      }
      return replaced;
    },

    // The turn's end, however it ended, unless it was stopped: its change
    // set, then what became of its intents, then its drafts, held.
    async *settle(
      deps: Pick<AgentDeps, "changeSets" | "actions" | "drafts">,
      thread: Thread,
      signal: AbortSignal,
      log: Log,
    ): AsyncGenerator<AgentEvent, void, undefined> {
      if (signal.aborted) return;
      let changeSetId: Ulid | null = null;
      if (writes) {
        const { runId, mutations } = writes;
        try {
          const changeSet = await deps.changeSets.capture(
            { id: runId, threadId: thread.id, workspaceId: thread.workspaceId },
            mutations,
          );
          changeSetId = changeSet.id;
          log("agent.change-set", {
            run_id: runId,
            change_set_id: changeSet.id,
            mutations: mutations.length,
          });
          yield { kind: "change-set", changeSetId: changeSet.id };
        } catch (error) {
          const message = `The proposed changes couldn't be saved for review: ${errorText(error)}`;
          log("agent.error", { error: message });
          yield { kind: "error", message };
        }
      }
      // Stopped while its change set was saved: none of its actions apply.
      if (asked && !signal.aborted) {
        const { runId, intents } = asked;
        try {
          const lines = await deps.actions.apply({ thread, changeSetId }, intents);
          log("agent.actions", {
            run_id: runId,
            applied: lines.filter((line) => line.applied).length,
            refused: lines.filter((line) => !line.applied).length,
          });
          yield { kind: "actions", runId, lines };
        } catch (error) {
          const message = `Oriel couldn't carry out what the agent asked of it: ${errorText(error)}`;
          log("agent.error", { error: message });
          yield { kind: "error", message };
        }
      }
      // Stopped by now: none of its drafts are held.
      if (!drafted || signal.aborted) return;
      const { runId, drafts } = drafted;
      try {
        await deps.drafts.hold(thread, drafts);
        log("agent.drafts", { run_id: runId, drafts: drafts.length });
      } catch (error) {
        const message = `Oriel couldn't hold what the agent drafted: ${errorText(error)}`;
        log("agent.error", { error: message });
        yield { kind: "error", message };
      }
    },
  };
}
