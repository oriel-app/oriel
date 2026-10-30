// The view data the JSON routes return, built from the stores. Plain data in
// the shapes @oriel/web/view declares; the window renders it as it is.
import {
  byItemId,
  type ChangeSet,
  type Diff,
  type GroupMember,
  type IndexRecord,
  type Instant,
  type ItemId,
  parseItemId,
  type Presentations,
  type Ulid,
} from "@oriel/core";
import type { GroupStore, Message, ThreadStore, ThreadSummary } from "@oriel/db";
import { itemRow } from "@oriel/groupings";
import type {
  ChangeSetStatus,
  ChangeSetView,
  ChatEntry,
  DiffView,
  GroupChangeView,
  GroupSummary,
  GroupView,
  ItemRef,
  MemberView,
  RunView,
  ThreadStateId,
  ThreadSummaryView,
  ThreadView,
} from "@oriel/web/view";
import { agentEvent, type AgentEvent } from "./agent.ts";

export type ViewDeps = {
  groups: GroupStore;
  threads: ThreadStore;
  // The index's live records, from every source.
  records: () => readonly IndexRecord[];
  presentations: Presentations;
  // The instant item rows count idle days back from.
  asOf: () => Instant;
  now: () => Instant;
  running: (threadId: Ulid) => boolean;
  writable: boolean;
};

const maxTitleChars = 120;

// Only an http(s) location becomes a link.
export function webUrl(location: string): string | null {
  const url = URL.parse(location);
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
}

const keyOf = (id: string) => parseItemId(id)?.key ?? id;

const identity = (item: { id: string; stableId: string }) =>
  `${parseItemId(item.id)?.source ?? ""}\u0000${item.stableId}`;

// The member of a group a handle names. Through the index, by identity, so
// an item that moved is found under its current handle; failing that, by the
// handle the member was added with, if no live item has that member's
// identity (it was deleted, or its key was reused by another item).
export function memberOf(
  handle: string,
  held: readonly GroupMember[],
  records: readonly IndexRecord[],
): GroupMember | undefined {
  const record = records.find((r) => r.id === handle);
  const live = new Set(records.map(identity));
  return (
    (record && held.find((m) => identity(m) === identity(record))) ??
    held.find((m) => m.id === handle && !live.has(identity(m)))
  );
}

// What a diff field's value reads as: a person by name, an item by its key,
// a link by its title.
function display(
  field: string,
  value: unknown,
  person: (id: string) => string | null,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && field === "assignee") return person(value) ?? value;
  if (typeof value === "string") return parseItemId(value) ? keyOf(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "title" in value && typeof value.title === "string")
    return value.title;
  return JSON.stringify(value) ?? null;
}

// Why a change stopped, as a person reads it: a source's refusal loses its
// request line and status code and keeps what the source said. Oriel's own
// reasons are already plain.
export function plainError(error: string): string {
  const refused = /^(?:GET|PUT|POST|DELETE) \S+: (\d{3})(?: ([\s\S]*))?$/.exec(error);
  if (!refused) return error;
  const [, status, said] = refused;
  return said
    ? `The source refused this change: ${said}`
    : `The source refused this change (it answered ${status}).`;
}

// Where a change set stands, from its rows: applied in full or in part; or,
// with nothing applied, approved, stopped (approved, and apply stopped at a
// change, which says why), rejected or open.
export function changeSetStatus(set: ChangeSet): ChangeSetStatus {
  const applied = set.mutations.filter((m) => m.status === "applied").length;
  if (applied > 0 && applied === set.mutations.length) return "applied";
  if (applied > 0) return "partial";
  if (set.decision?.kind === "approved")
    return set.mutations.some((m) => m.error !== null) ? "stopped" : "approved";
  if (set.decision) return set.decision.kind;
  return "open";
}

export function changeSetView(set: ChangeSet, all: readonly ChangeSet[]): ChangeSetView {
  return {
    id: set.id,
    status: changeSetStatus(set),
    approved: set.decision?.kind === "approved",
    // A change sent with no answer may have landed; revert waits for it.
    sentUnapplied: set.mutations.some((m) => m.status === "failed"),
    decision: set.decision && {
      kind: set.decision.kind,
      via: set.decision.via,
      by: set.decision.by,
      at: set.decision.at,
    },
    errors: set.mutations.flatMap((m) =>
      m.status !== "applied" && m.error !== null
        ? [{ mutationId: m.id, error: plainError(m.error) }]
        : [],
    ),
    revertOf: set.revertOf,
    reverts: all.filter((other) => other.revertOf === set.id).map((other) => other.id),
    createdAt: set.createdAt,
  };
}

function runView(result: Extract<AgentEvent, { kind: "run.finished" }>["result"]): RunView {
  const last = result.transcript.findLast((e) => e.kind !== "log");
  return {
    outcome: result.outcome,
    wallMs: result.wallMs,
    reads: result.reads.map((read) => ({
      fn: read.fn,
      status: read.status,
      outsideRegion: read.outsideRegion,
    })),
    mutations: result.mutations.length,
    logs: result.transcript.flatMap((e) => (e.kind === "log" ? [e.text] : [])),
    returned:
      last?.kind === "return" && last.value !== undefined
        ? (JSON.stringify(last.value, null, 2) ?? null)
        : null,
    error:
      last?.kind === "error"
        ? { phase: last.error.phase, message: last.error.message, hint: last.error.hint ?? null }
        : null,
  };
}

export function views(deps: ViewDeps) {
  const { groups, threads } = deps;

  // The index by handle and by identity (source and stable ID), which
  // outlives a handle.
  const lookup = () => {
    const records = deps.records();
    const byId = new Map(records.map((r) => [r.id, r]));
    const byIdentity = new Map(
      records.map((r) => [`${parseItemId(r.id)?.source}\u0000${r.stableId}`, r]),
    );
    // By identity only: a handle another item has taken since names that
    // other item, not this one.
    const find = (member: GroupMember): IndexRecord | undefined =>
      byIdentity.get(`${parseItemId(member.id)?.source}\u0000${member.stableId}`);
    return { byId, find };
  };

  const ref = (record: IndexRecord | undefined, id: string): ItemRef => ({
    id: record?.id ?? id,
    key: keyOf(record?.id ?? id),
    title: record?.title ?? null,
    url: record ? webUrl(record.location) : null,
  });

  const people = () => {
    const names = new Map<string, string>();
    for (const record of deps.records())
      for (const person of record.facets.people ?? []) names.set(person.id, person.name);
    return (id: string) => names.get(id) ?? null;
  };

  const members = (items: readonly GroupMember[]): MemberView[] => {
    const { find } = lookup();
    const asOf = deps.asOf();
    return items
      .map((member) => {
        const record = find(member);
        return {
          ref: ref(record, member.id),
          row: record ? itemRow(record, asOf, deps.presentations) : null,
        };
      })
      .toSorted((a, b) => byItemId(a.ref.id, b.ref.id));
  };

  const counts = (summaries: readonly ThreadSummary[]): Record<ThreadStateId, number> => {
    const out: Record<ThreadStateId, number> = {
      working: 0,
      done: 0,
      "handed-off": 0,
      dropped: 0,
    };
    for (const { thread } of summaries) out[thread.state] += 1;
    return out;
  };

  const groupSummary = (id: Ulid): GroupSummary => {
    const group = groups.get(id);
    if (!group) throw new RangeError(`no group ${id}`);
    const latest = groups.region(id, group.version);
    const { origin } = group;
    return {
      id: group.id,
      name: group.name,
      origin:
        origin.kind === "cluster"
          ? { kind: "cluster", grouping: origin.grouping, label: group.name || null }
          : { kind: "picked" },
      version: group.version,
      size: latest?.items.length ?? 0,
      createdAt: group.createdAt,
      threads: counts(threads.ofGroup(id, deps.now())),
    };
  };

  const title = (threadId: Ulid): string | null => {
    const first = threads.messages(threadId).find((m) => m.role === "user");
    if (first?.role !== "user") return null;
    const text = first.text.trim().replace(/\s+/g, " ");
    return text.length > maxTitleChars ? `${text.slice(0, maxTitleChars - 1)}…` : text;
  };

  const threadSummary = ({ thread, activityAt }: ThreadSummary): ThreadSummaryView => ({
    id: thread.id,
    title: title(thread.id),
    group: { id: thread.groupId, name: groups.get(thread.groupId)?.name ?? "" },
    state: thread.state,
    doneBy: thread.doneBy,
    activityAt,
  });

  const changeView = (groupId: Ulid, from: number, to: number): GroupChangeView[] => {
    // By identity, so an item that moved since keeps its title.
    const { find } = lookup();
    return groups
      .changes(groupId, from)
      .filter((change) => change.version <= to)
      .map((change) => ({
        version: change.version,
        at: change.at,
        added: change.added.map((m) => ref(find(m), m.id)),
        removed: change.removed.map((m) => ref(find(m), m.id)),
        cause: change.cause.kind,
      }));
  };

  // A stored chat message as the window shows it; null for an agent event
  // in a shape this server doesn't know.
  const entry = (
    message: Message,
    groupId: Ulid,
    region: ReadonlySet<string>,
  ): ChatEntry | null => {
    const at = { seq: message.seq, at: message.at };
    if (message.role === "user") return { ...at, kind: "user", text: message.text };
    if (message.role === "marker") {
      const changes = changeView(groupId, message.from, message.to);
      return {
        ...at,
        kind: "marker",
        from: message.from,
        to: message.to,
        added: changes.flatMap((c) => c.added),
        removed: changes.flatMap((c) => c.removed),
      };
    }
    const checked = agentEvent(message.event);
    if (!checked.ok) return null;
    const event = checked.value;
    switch (event.kind) {
      case "text":
        return { ...at, kind: "text", text: event.text };
      case "run.started":
        return { ...at, kind: "run.started", runId: event.runId, script: event.script };
      case "run.finished":
        return { ...at, kind: "run.finished", runId: event.runId, run: runView(event.result) };
      case "search": {
        return {
          ...at,
          kind: "search",
          runId: event.runId,
          hits: event.hits.map((hit) => ({
            id: hit.id,
            key: keyOf(hit.id),
            title: hit.title,
            url: webUrl(hit.location),
            inRegion: region.has(hit.id),
          })),
        };
      }
      case "change-set":
        return { ...at, kind: "change-set", changeSetId: event.changeSetId };
      case "limit":
        return { ...at, kind: "limit", reason: event.reason };
      case "error":
        return { ...at, kind: "error", message: event.message };
      case "done":
        return { ...at, kind: "done" };
    }
  };

  const regionIds = (groupId: Ulid, version: number): Set<string> =>
    new Set(groups.region(groupId, version)?.items.map((m) => m.id) ?? []);

  return {
    groupSummary,
    members,

    groups(workspaceId: Ulid): GroupSummary[] {
      return groups.list(workspaceId).map((group) => groupSummary(group.id));
    },

    group(id: Ulid): GroupView | null {
      const group = groups.get(id);
      if (!group) return null;
      return {
        group: groupSummary(id),
        members: members(groups.region(id, group.version)?.items ?? []),
        changes: changeView(id, 0, group.version).toReversed(),
        threads: threads.ofGroup(id, deps.now()).map(threadSummary),
      };
    },

    inbox(workspaceId: Ulid): ThreadSummaryView[] {
      return threads.list(workspaceId, deps.now()).map(threadSummary);
    },

    entry(message: Message, threadId: Ulid): ChatEntry | null {
      const thread = threads.get(threadId, deps.now());
      if (!thread) return null;
      return entry(message, thread.groupId, regionIds(thread.groupId, thread.regionVersion));
    },

    thread(id: Ulid, sets: readonly ChangeSet[]): ThreadView | null {
      const thread = threads.get(id, deps.now());
      if (!thread) return null;
      const group = groups.get(thread.groupId);
      if (!group) return null;
      const region = groups.region(thread.groupId, thread.regionVersion);
      const messages = threads.messages(id);
      // Each entry against the version the thread was in when it was stored:
      // the one its last marker moved it to, or the one it opened in.
      const firstMarker = messages.find((m) => m.role === "marker");
      let version = firstMarker?.role === "marker" ? firstMarker.from : thread.regionVersion;
      const versions = new Map<number, Set<string>>();
      const idsAt = (at: number) => {
        const known = versions.get(at) ?? regionIds(thread.groupId, at);
        versions.set(at, known);
        return known;
      };
      const entries = messages.flatMap((m) => {
        if (m.role === "marker") version = m.to;
        return entry(m, thread.groupId, idsAt(version)) ?? [];
      });
      return {
        id,
        title: title(id),
        group: { id: group.id, name: group.name, version: group.version },
        state: thread.state,
        doneBy: thread.doneBy,
        regionVersion: thread.regionVersion,
        members: members(region?.items ?? []),
        entries,
        lastSeq: messages.at(-1)?.seq ?? 0,
        running: deps.running(id),
        changeSets: sets.map((set) => changeSetView(set, sets)),
        writable: deps.writable,
      };
    },

    diff(diff: Diff, set: ChangeSet): DiffView {
      const { byId } = lookup();
      const person = people();
      const rows = new Map(set.mutations.map((m) => [m.id, m]));
      const status = changeSetStatus(set);
      return {
        changeSetId: diff.changeSetId,
        hash: diff.hash,
        lines: diff.lines.map((line) => {
          const row = rows.get(line.mutationId);
          const applied = row?.status === "applied";
          const error = !applied && row?.error ? plainError(row.error) : null;
          return {
            mutationId: line.mutationId,
            sentence: line.sentence,
            target:
              line.target !== null && parseItemId(line.target)
                ? ref(byId.get(line.target as ItemId), line.target)
                : null,
            applied,
            error,
            // A change that stopped can be left out, as its message says; while
            // open, any can. An edit never empties a change set.
            removable:
              !applied &&
              set.mutations.length > 1 &&
              status !== "rejected" &&
              (status === "open" || error !== null),
            fields: line.fields.map((field) => ({
              name: field.name,
              before: display(field.name, field.before, person),
              after: display(field.name, field.after, person),
            })),
          };
        }),
      };
    },
  };
}

export type Views = ReturnType<typeof views>;
