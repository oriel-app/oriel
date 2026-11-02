// The one read layer over Oriel's own data (decision 0024, OA-108): the
// workspace's workstreams and threads, what each thread's change sets wrote
// where, and the one search over them. The agent's `workstream` and `thread`
// namespaces and the window's search route both call it, so both doors find
// the same things. It reads no source: what a change set wrote is told from
// its rows and the index (`ChangeSets.changes`).
import {
  type ChangeSet,
  changeSetLink,
  type ChangeSetRead,
  type ChangeSets,
  type ChangeSetState,
  type Instant,
  type Known,
  type OrielReads,
  type ThreadRead,
  threadLink,
  type Ulid,
} from "@oriel/core";
import type { Message, ThreadStore, WorkstreamStore } from "@oriel/db";
import { type Findable, find } from "./find.ts";
import { changeSetStatus } from "./views.ts";

export type OrielReadDeps = {
  workspaceId: Ulid;
  workstreams: WorkstreamStore;
  threads: ThreadStore;
  changeSets: Pick<ChangeSets, "ofThread" | "changes">;
  // A thread's title as the window shows it, or null before it has one.
  title(threadId: Ulid): string | null;
  // What a person calls an ID a change set names, such as a channel, and an
  // item's title, from what Oriel has indexed.
  known(): Known;
  now(): Instant;
};

// Where a change set stands, in a person's words. One a revert undid, in any
// part, is reverted; one applied in part is applied; one approved but
// stopped before anything landed is still approved.
export function changeSetState(set: ChangeSet, all: readonly ChangeSet[]): ChangeSetState {
  const undone = all.some(
    (other) => other.revertOf === set.id && other.mutations.some((m) => m.status === "applied"),
  );
  if (undone) return "reverted";
  const status = changeSetStatus(set);
  if (status === "applied" || status === "partial") return "applied";
  if (status === "approved" || status === "stopped") return "approved";
  return status === "rejected" ? "rejected" : "pending";
}

// What was said in a thread, as one text: the user's words, the agent's
// replies, and messages held from others.
function said(messages: readonly Message[]): string {
  return messages
    .flatMap((m) => {
      if (m.role === "user" || m.role === "held") return [m.text];
      if (m.role !== "agent") return [];
      const { event } = m;
      return typeof event === "object" &&
        event !== null &&
        "kind" in event &&
        event.kind === "text" &&
        "text" in event &&
        typeof event.text === "string"
        ? [event.text]
        : [];
    })
    .join("\n");
}

export function orielReads(deps: OrielReadDeps): OrielReads {
  const { threads, workstreams } = deps;

  const threadReads = (): ThreadRead[] =>
    threads.list(deps.workspaceId, deps.now()).map(({ thread, activityAt }) => ({
      id: thread.id,
      name: deps.title(thread.id),
      state: thread.state,
      workstream: {
        id: thread.workstreamId,
        name: workstreams.get(thread.workstreamId)?.name ?? "",
      },
      activityAt,
      link: threadLink(thread.id),
    }));

  // Each thread's change sets, newest first, read as a person reads them.
  const setsOf = async (
    ids: readonly Ulid[],
  ): Promise<{ set: ChangeSet; read: ChangeSetRead }[]> => {
    const known = deps.known();
    const each = await Promise.all(
      ids.map(async (thread) => {
        const all = await deps.changeSets.ofThread(thread);
        return Promise.all(
          all.map(async (set) => ({
            set,
            read: {
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
              link: changeSetLink(thread, set.id),
            },
          })),
        );
      }),
    );
    return each
      .flat()
      .toSorted((a, b) =>
        a.set.createdAt === b.set.createdAt
          ? b.set.id.localeCompare(a.set.id)
          : b.set.createdAt.localeCompare(a.set.createdAt),
      );
  };

  return {
    async workstreams() {
      return workstreams.list(deps.workspaceId).map((workstream) => ({
        id: workstream.id,
        name: workstream.name,
        items: workstreams.region(workstream.id, workstream.version)?.items.map((m) => m.id) ?? [],
        threads: threads.ofWorkstream(workstream.id, deps.now()).length,
      }));
    },

    async threads() {
      return threadReads();
    },

    async changeSets(thread) {
      const ids = thread === null ? threadReads().map((t) => t.id) : [thread];
      // A thread that isn't in the workspace, or was deleted, has none to show.
      const live = ids.filter(
        (id) => threads.get(id, deps.now())?.workspaceId === deps.workspaceId,
      );
      return (await setsOf(live)).map(({ read }) => read);
    },

    async find(query, limit) {
      const all = threadReads();
      const byId = new Map(all.map((thread) => [thread.id, thread]));
      const sets = await setsOf(all.map((thread) => thread.id));
      const findable: Findable<{ thread: ThreadRead; changeSet: ChangeSetRead | null }>[] = [
        ...all.map((thread) => ({
          target: { thread, changeSet: null },
          at: thread.activityAt,
          fields: [
            { in: "name" as const, text: thread.name ?? "" },
            { in: "chat" as const, text: said(threads.messages(thread.id)) },
          ],
        })),
        ...sets.flatMap(({ set, read }) => {
          const thread = byId.get(read.thread);
          if (!thread) return [];
          // What it wrote, where, and where it stands, so "approved" finds
          // the change set the person approved.
          const wrote = read.changes.map((change) =>
            [`${change.source}: ${change.sentence}`, ...change.text].join("\n"),
          );
          const stood = [
            read.state,
            read.decided ? `${read.decided.kind} by ${read.decided.by}` : "",
          ];
          return [
            {
              target: { thread, changeSet: read },
              at: set.decision?.at ?? set.createdAt,
              fields: [
                ...wrote.map((text) => ({ in: "change-set" as const, text })),
                { in: "change-set" as const, text: stood.join(" ") },
              ],
            },
          ];
        }),
      ];
      return find(findable, query, limit).map(({ target, matched, excerpt }) => ({
        ...target,
        matched,
        excerpt,
      }));
    },
  };
}
