// One proposal per turn, for every agent (decision 0024). The last run that
// finished and captured mutations makes the turn's change set; the last
// that finished and recorded intents gives the intents that apply; and the
// last that finished and drafted any gives the drafts held for the user
// (decision 0051). A run with only some of them doesn't drop an earlier
// run's others, and a run that failed proposes nothing. A stopped turn
// applies and holds nothing. When the turn ends, the change set is captured
// first, then the intents apply, so the host can refuse one that would
// break it, then the drafts are held.
import type {
  CapturedMutation,
  ChallengeRun,
  Draft,
  Intent,
  Log,
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

export function proposal() {
  let writes: { runId: Ulid; mutations: CapturedMutation[] } | null = null;
  let asked: { runId: Ulid; intents: Intent[] } | null = null;
  let drafted: { runId: Ulid; drafts: Draft[] } | null = null;

  return {
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
