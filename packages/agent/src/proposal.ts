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
// A run that called `thread.revise()` makes its writes replace that change
// set's instead of making a new one, which keeps its ID and review link
// (OA-309).
import {
  type ActionLine,
  type CapturedMutation,
  type ChallengeRun,
  type Draft,
  type Intent,
  type Log,
  type Region,
  type RunResult,
  type Thread,
  type Ulid,
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
  let writes: { runId: Ulid; mutations: CapturedMutation[]; revises: Ulid | null } | null = null;
  // The change set each run asked to revise, by run.
  const revising = new Map<Ulid, Ulid>();
  let asked: { runId: Ulid; intents: Intent[] } | null = null;
  let drafted: { runId: Ulid; drafts: Draft[] } | null = null;

  return {
    // What a run's bindings get besides its region: a second look's
    // `challenge`, or, in any other turn, `revise`, which checks the change
    // set the run names and, if the agent may revise it, makes the run's
    // writes revise it.
    runOptions(
      deps: Pick<AgentDeps, "changeSets">,
      input: Pick<TurnInput, "thread" | "challenge">,
      runId: Ulid,
    ): { challenge?: ChallengeRun; revise?: (id: string) => Promise<string> } {
      const challenge = challengeOf(input, runId);
      if (challenge) return challenge;
      return {
        revise: async (id) => {
          const why = await deps.changeSets.revisable(id as Ulid, input.thread.id);
          if (why !== null) return `Oriel won't revise ${id}: ${why}.`;
          revising.set(runId, id as Ulid);
          return `This run's writes will replace the changes of ${id} when this turn ends.`;
        },
      };
    },

    // The change set a run asked to revise, if any.
    revises: (runId: Ulid): Ulid | null => revising.get(runId) ?? null,

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
        writes = { runId, mutations: result.mutations, revises: revising.get(runId) ?? null };
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
        const { runId, mutations, revises } = writes;
        const run = { id: runId, threadId: thread.id, workspaceId: thread.workspaceId };
        try {
          const changeSet = revises
            ? await deps.changeSets.revise(revises, run, mutations)
            : await deps.changeSets.capture(run, mutations);
          changeSetId = changeSet.id;
          log("agent.change-set", {
            run_id: runId,
            change_set_id: changeSet.id,
            mutations: mutations.length,
            revised: revises !== null,
          });
          yield {
            kind: "change-set",
            changeSetId: changeSet.id,
            ...(revises && { revised: true }),
          };
        } catch (error) {
          const message = revises
            ? `Change set ${revises} couldn't be revised: ${errorText(error)}`
            : `The proposed changes couldn't be saved for review: ${errorText(error)}`;
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
