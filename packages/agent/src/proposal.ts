// The change set is captured before the intents apply, so the host can refuse one that would
// break it.
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
import { errorText } from "./provider.ts";

export const challengeOf = (
  input: Pick<TurnInput, "challenge">,
  runId: Ulid,
): { challenge: ChallengeRun } | undefined => {
  const { challenge } = input;
  if (!challenge) return undefined;
  return { challenge: { diff: challenge.diff, record: (f) => challenge.record(runId, f) } };
};

export type Replaced = { mutations: number; intents: number; drafts: number };

const joins = (intent: Intent, thread: Thread) =>
  intent.action === "workstream.add" && intent.input["workstream"] === thread.workstreamId;

export type Joined = { result: RunResult; lines: ActionLine[]; region: Region };

export function proposal() {
  let writes: { runId: Ulid; mutations: CapturedMutation[]; revises: Ulid | null } | null = null;
  const revising = new Map<Ulid, Ulid>();
  let asked: { runId: Ulid; intents: Intent[] } | null = null;
  let drafted: { runId: Ulid; drafts: Draft[] } | null = null;

  return {
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

    revises: (runId: Ulid): Ulid | null => revising.get(runId) ?? null,

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
        return { result, lines: [], region };
      }
    },

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
