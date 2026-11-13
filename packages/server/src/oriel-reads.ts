// The agent's namespaces and the window's search both call it, so both doors find the same things. It reads no source.
import {
  type ChangeSetRead,
  type ChangeSets,
  findThreads,
  type Instant,
  type Known,
  type OrielReads,
  type ThreadRead,
  type Ulid,
} from "@oriel/core";
import type { Message, ThreadStore, WorkstreamStore } from "@oriel/db";
import { history } from "./turns.ts";
import { changeSetState } from "./views.ts";
import { listedWorkstreams } from "./window-chat.ts";

export type OrielReadDeps = {
  workspaceId: Ulid;
  workstreams: WorkstreamStore;
  threads: ThreadStore;
  changeSets: Pick<ChangeSets, "ofThread" | "changes">;
  title(threadId: Ulid): string | null;
  known(): Known;
  now(): Instant;
};

// A message held from anyone else is in neither until the user sends it, as their own.
const said = (messages: readonly Message[]): string =>
  history(messages, () => "")
    .flatMap((m) => (m.role === "user" || m.role === "assistant" ? [m.text] : []))
    .join("\n");

export function orielReads(deps: OrielReadDeps): OrielReads {
  const { threads, workstreams } = deps;

  const threadReads = (): ThreadRead[] =>
    threads
      .list(deps.workspaceId, deps.now())
      .toSorted((a, b) => b.activityAt.localeCompare(a.activityAt))
      .map(({ thread, activityAt }) => ({
        id: thread.id,
        name: deps.title(thread.id),
        state: thread.state,
        workstream: {
          id: thread.workstreamId,
          name: workstreams.get(thread.workstreamId)?.name ?? "",
        },
        activityAt,
      }));

  const setsOf = async (ids: readonly Ulid[]): Promise<ChangeSetRead[]> => {
    const known = deps.known();
    const each = await Promise.all(
      ids.map(async (thread) => {
        const all = await deps.changeSets.ofThread(thread);
        return Promise.all(
          all.map(async (set): Promise<ChangeSetRead> => ({
            id: set.id,
            thread,
            state: changeSetState(set, all),
            createdAt: set.createdAt,
            decided: set.decision && {
              kind: set.decision.kind,
              by: set.decision.by,
              at: set.decision.at,
            },
            changes: await deps.changeSets.changes(set, known),
          })),
        );
      }),
    );
    return each
      .flat()
      .toSorted((a, b) =>
        a.createdAt === b.createdAt
          ? b.id.localeCompare(a.id)
          : b.createdAt.localeCompare(a.createdAt),
      );
  };

  return {
    async workstreams() {
      const listed = listedWorkstreams({ workstreams, threads, now: deps.now });
      return workstreams
        .list(deps.workspaceId)
        .filter(listed)
        .map((workstream) => ({
          id: workstream.id,
          name: workstream.name,
          items:
            workstreams.region(workstream.id, workstream.version)?.items.map((m) => m.id) ?? [],
          threads: threads.ofWorkstream(workstream.id, deps.now()).length,
          done: threads.workstreamDone(workstream.id, deps.now()) !== null,
        }));
    },

    async threads() {
      return threadReads();
    },

    async changeSets(thread) {
      const ids = thread === null ? threadReads().map((t) => t.id) : [thread];
      const live = ids.filter(
        (id) => threads.get(id, deps.now())?.workspaceId === deps.workspaceId,
      );
      return setsOf(live);
    },

    async find(query, limit) {
      const all = threadReads();
      return findThreads(
        all,
        (thread) => said(threads.messages(thread.id)),
        await setsOf(all.map((thread) => thread.id)),
        query,
        limit,
      );
    },
  };
}
