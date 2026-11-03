// The overview (decision 0027), computed when it is asked for from the
// index, the change log, workstreams, threads and change sets: never by a
// model. The page and the window chat's `window.overview()` read this one
// view. Each derived signal carries its rule.
import {
  type ChangeLogEntry,
  type Cluster,
  daysSince,
  type IndexRecord,
  type Instant,
  parseItemId,
  sourceKinds,
  stalled,
  stuckDays,
  thisWeek,
  weights,
  type WorkstreamMember,
} from "@oriel/core";
import { assigneeOf } from "@oriel/groupings";
import { candidatesFor, sources } from "@oriel/sources";
import {
  type CandidateView,
  type GroupingId,
  type HeadlineView,
  isGroupingId,
  type ItemRef,
  type OverviewView,
  type PersonRowView,
  type SignalView,
  statusCategories,
  type ThreadSummaryView,
  type UnopenedLinkView,
  waitsOnUser,
  type WorkstreamRowView,
} from "@oriel/web/view";
import { webUrl } from "./views.ts";

export type OverviewInput = {
  records: readonly IndexRecord[];
  // Every change log entry kept, in the order they committed.
  changes: readonly ChangeLogEntry[];
  // When the user last left the overview, and the last entry seen then.
  seen: { at: Instant; seq: number } | null;
  // The open workstreams, with their members now.
  workstreams: readonly {
    id: string;
    name: string;
    createdAt: Instant;
    members: readonly WorkstreamMember[];
  }[];
  threads: readonly ThreadSummaryView[];
  // Review links sent that nobody has opened.
  unopened: readonly { changeSetId: string; threadId: string; sentAt: Instant }[];
  // A grouping's clusters now, which a cluster candidate names.
  clusters: (grouping: GroupingId) => readonly Cluster[];
  now: Instant;
};

// How many rows a capped section sends.
export const caps = { candidates: 8, people: 10 };

const identity = (source: string, stableId: string) => `${source}\u0000${stableId}`;
const identityOf = (item: { id: string; stableId: string }) =>
  identity(parseItemId(item.id)?.source ?? "", item.stableId);

export const itemRef = (record: IndexRecord): ItemRef => ({
  id: record.id,
  key: parseItemId(record.id)?.key ?? record.id,
  title: record.title,
  url: webUrl(record.location),
});

const latest = (instants: readonly string[], fallback: string): string =>
  instants.reduce((a, b) => (b > a ? b : a), fallback);

// Which open workstream holds each item, the first one listed, by identity.
function holders(
  workstreams: OverviewInput["workstreams"],
): Map<string, { id: string; name: string }> {
  const holder = new Map<string, { id: string; name: string }>();
  for (const workstream of workstreams)
    for (const member of workstream.members)
      if (!holder.has(identityOf(member))) holder.set(identityOf(member), workstream);
  return holder;
}

// Whether an open workstream holds a record: what Not in a workstream yet
// leaves out, and Browse's "not in a workstream" filter too.
export function heldBy(
  workstreams: OverviewInput["workstreams"],
): (record: IndexRecord) => boolean {
  const holder = holders(workstreams);
  return (record) => holder.has(identityOf(record));
}

export function overviewView(input: OverviewInput): OverviewView {
  const { records, now } = input;
  const byIdentity = new Map(records.map((record) => [identityOf(record), record]));
  const byId = new Map(records.map((record) => [record.id as string, record]));
  const holder = holders(input.workstreams);
  const held = (record: IndexRecord) => holder.has(identityOf(record));

  const seq = input.changes.at(-1)?.seq ?? input.seen?.seq ?? 0;
  const since = input.changes.filter((entry) => entry.seq > (input.seen?.seq ?? 0));
  const changedSince = new Map<string, ChangeLogEntry[]>();
  for (const entry of since) {
    const key = identity(entry.source, entry.stableId);
    changedSince.set(key, [...(changedSince.get(key) ?? []), entry]);
  }
  const fortnight = input.changes.filter(
    (entry) => daysSince(entry.at, now) < 14 || entry.at > now,
  );

  const threadsOf = Map.groupBy(input.threads, (thread) => thread.workstream.id);
  const workstreams = input.workstreams
    .map((workstream): WorkstreamRowView => {
      const keys = new Set(workstream.members.map(identityOf));
      const members = [...keys].flatMap((key) => byIdentity.get(key) ?? []);
      const status = Object.fromEntries(
        statusCategories.map((category) => [
          category,
          members.filter((record) => record.facets.state === category).length,
        ]),
      ) as WorkstreamRowView["status"];
      const moved = [...keys].filter((key) => changedSince.has(key));
      const movedDone = moved.filter((key) =>
        changedSince.get(key)?.some((entry) => entry.facets.state?.after === "done"),
      );
      const activity = Array.from({ length: 14 }, () => 0);
      for (const entry of fortnight)
        if (keys.has(identity(entry.source, entry.stableId))) {
          const back = Math.min(daysSince(entry.at, now), 13);
          activity[13 - back] = (activity[13 - back] ?? 0) + 1;
        }
      const threads = threadsOf.get(workstream.id) ?? [];
      const lastActivity = latest(
        [
          ...members.map((record) => record.updatedAt),
          ...threads.map((thread) => thread.activityAt),
        ],
        workstream.createdAt,
      );
      const idleDays = daysSince(lastActivity as Instant, now);
      const stuck = members.filter((record) => stalled(record, now)).length;
      const signals: SignalView[] = [
        ...(idleDays >= stuckDays
          ? [
              {
                text: `Nothing moved in ${idleDays} days`,
                rule: `No member update and no thread activity in ${stuckDays} days`,
              },
            ]
          : []),
        ...(stuck > 0
          ? [
              {
                text: `${stuck} in progress, no update in ${stuckDays} days`,
                rule: `A member in progress with no update in ${stuckDays} days`,
              },
            ]
          : []),
      ];
      const bySource = [...Map.groupBy(members, (record) => parseItemId(record.id)?.source)]
        .flatMap(([kind, list]) =>
          kind ? [{ source: sources[kind].name, count: list.length }] : [],
        )
        .toSorted((a, b) => b.count - a.count);
      return {
        id: workstream.id,
        name: workstream.name,
        size: keys.size,
        bySource,
        status,
        moved: moved.length,
        movedDone: movedDone.length,
        movedItems: moved
          .flatMap((key) => byIdentity.get(key) ?? [])
          .slice(0, 3)
          .map(itemRef),
        activity,
        lastActivity,
        idleDays,
        quiet: idleDays >= stuckDays,
        threads: {
          working: threads.filter((t) => t.state === "working" && !waitsOnUser(t.waitingOn)).length,
          waiting: threads.filter((t) => waitsOnUser(t.waitingOn)).length,
          done: threads.filter((t) => t.state === "done" || t.state === "handed-off").length,
          dropped: threads.filter((t) => t.state === "dropped").length,
        },
        signals,
      };
    })
    .toSorted(
      (a, b) =>
        b.moved - a.moved ||
        b.lastActivity.localeCompare(a.lastActivity) ||
        a.id.localeCompare(b.id),
    );

  const needsYou = input.threads
    .filter((thread) => waitsOnUser(thread.waitingOn))
    .toSorted((a, b) => a.activityAt.localeCompare(b.activityAt));
  const threadById = new Map(input.threads.map((thread) => [thread.id, thread]));
  const unopened = input.unopened.flatMap((link): UnopenedLinkView[] => {
    const thread = threadById.get(link.threadId);
    return thread
      ? [
          {
            changeSetId: link.changeSetId,
            thread: { id: thread.id, title: thread.title },
            workstream: thread.workstream,
            sentAt: link.sentAt,
          },
        ]
      : [];
  });

  const candidates = rankCandidates(input, held, byId);
  const people = peopleOf(records, holder);
  const elsewhere = [...changedSince.keys()].filter((key) => !holder.has(key)).length;
  return {
    asOf: now,
    seq,
    lastSeen: input.seen?.at ?? null,
    counts: {
      changed: changedSince.size,
      workstreamsMoved: workstreams.filter((row) => row.moved > 0).length,
      needsYou: needsYou.length,
      notInWorkstream: candidates.length,
    },
    changed: {
      workstreams: workstreams
        .filter((row) => row.moved > 0)
        .map(({ id, name, moved }) => ({ id, name, moved })),
      elsewhere,
    },
    needsYou: { threads: needsYou, unopened },
    headlines: headlines(input, workstreams, candidates, holder, byIdentity),
    workstreams,
    candidates: { rows: candidates.slice(0, caps.candidates), total: candidates.length },
    people: { rows: people.slice(0, caps.people), total: people.length },
  };
}

// How many of the Linked grouping's clusters are candidates, the most
// linked first, and how many items no workstream holds one needs: the item
// named and at least two that name it, or that it names.
const linkedCandidates = 3;
const linkedAtLeast = 3;

// Every source's candidates, and the Linked clusters most worth curating,
// ranked together by weight, then by how recently their items changed
// (decision 0027). A cluster's items are its grouping's now, as Make a
// workstream copies them, and a candidate whose items an open workstream
// all holds is none.
function rankCandidates(
  input: OverviewInput,
  held: (record: IndexRecord) => boolean,
  byId: ReadonlyMap<string, IndexRecord>,
): CandidateView[] {
  const found = candidatesFor({
    records: input.records,
    changes: input.changes,
    held,
    now: input.now,
  });
  const items = (cluster: Cluster) =>
    [
      ...new Set([...(cluster.anchor === null ? [] : [cluster.anchor]), ...cluster.itemIds]),
    ].flatMap((id) => byId.get(id) ?? []);
  // A cluster as a candidate row; null when no item of it is left that no
  // workstream holds, so nothing to make a workstream of.
  const clusterRow = (
    grouping: GroupingId,
    cluster: Cluster,
    base: Pick<CandidateView, "rule" | "source" | "weight" | "detail">,
  ): CandidateView | null => {
    const members = items(cluster);
    if (!members.some((record) => !held(record))) return null;
    const lead = byId.get(cluster.anchor ?? cluster.itemIds[0] ?? "");
    return {
      ...base,
      subject: {
        kind: "cluster",
        grouping,
        key: cluster.key,
        label: cluster.label,
        lead: lead ? itemRef(lead) : null,
        size: members.length,
      },
      changedAt: latest(
        members.map((record) => record.updatedAt),
        "",
      ),
    };
  };
  const fromSources = found.flatMap((candidate): CandidateView[] => {
    const base = {
      rule: candidate.rule,
      source: sources[candidate.source].name,
      weight: candidate.weight,
      detail: candidate.detail ?? null,
    };
    if (candidate.subject.kind === "item") {
      const record = byId.get(candidate.subject.id);
      if (!record || held(record)) return [];
      return [
        { ...base, subject: { kind: "item", item: itemRef(record) }, changedAt: record.updatedAt },
      ];
    }
    const { grouping, key } = candidate.subject;
    if (!isGroupingId(grouping)) return [];
    const cluster = input.clusters(grouping).find((each) => each.key === key);
    const row = cluster && clusterRow(grouping, cluster, base);
    return row ? [row] : [];
  });
  // Weighed as the items in it no workstream holds, each an item to look at.
  const linked = input
    .clusters("linked")
    .flatMap((cluster) => {
      const members = items(cluster);
      const free = members.filter((record) => !held(record)).length;
      if (free < linkedAtLeast) return [];
      const kinds = new Set(members.map((record) => parseItemId(record.id)?.source));
      const row = clusterRow("linked", cluster, {
        rule: "An item and the items it names or that name it",
        source: sourceKinds
          .filter((kind) => kinds.has(kind))
          .map((kind) => sources[kind].name)
          .join(" · "),
        weight: free * weights.glance,
        detail: free < members.length ? `${free} in no workstream` : null,
      });
      return row ? [row] : [];
    })
    .toSorted(byRank)
    .slice(0, linkedCandidates);
  return [...fromSources, ...linked].toSorted(byRank);
}

const byRank = (a: CandidateView, b: CandidateView) =>
  b.weight - a.weight ||
  b.changedAt.localeCompare(a.changedAt) ||
  candidateId(a).localeCompare(candidateId(b));

const candidateId = (candidate: CandidateView) =>
  candidate.subject.kind === "item"
    ? candidate.subject.item.id
    : `${candidate.subject.grouping}:${candidate.subject.key}`;

// Who has items in progress, most first, each with the workstream holding
// most of them. An epic is a container here, not work in progress.
function peopleOf(
  records: readonly IndexRecord[],
  holder: ReadonlyMap<string, { id: string; name: string }>,
): PersonRowView[] {
  const working = records.filter(
    (record) => record.facets.state === "in-progress" && record.facets.kind !== "epic",
  );
  const byPerson = Map.groupBy(
    working.flatMap((record) => {
      const person = assigneeOf(record);
      return person ? [{ person, record }] : [];
    }),
    ({ person }) => person.id,
  );
  return [...byPerson]
    .map(([id, list]): PersonRowView => {
      const byWorkstream = Map.groupBy(
        list.flatMap(({ record }) => holder.get(identityOf(record)) ?? []),
        (workstream) => workstream.id,
      );
      const top = [...byWorkstream.values()]
        .map((each) => ({ id: each[0]?.id ?? "", name: each[0]?.name ?? "", count: each.length }))
        .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0];
      return { id, name: list[0]?.person.name ?? id, inProgress: list.length, top: top ?? null };
    })
    .toSorted((a, b) => b.inProgress - a.inProgress || names.compare(a.name, b.name));
}

const names = new Intl.Collator("en");

// The four standing questions (decision 0027's headlines): which workstream
// moved most since the user looked, which has been quiet longest, what chat
// names most this week, and the top candidate. Each is the extreme of one
// measure, with its rule.
function headlines(
  input: OverviewInput,
  workstreams: readonly WorkstreamRowView[],
  candidates: readonly CandidateView[],
  holder: ReadonlyMap<string, { id: string; name: string }>,
  byIdentity: ReadonlyMap<string, IndexRecord>,
): HeadlineView[] {
  const lines: HeadlineView[] = [];
  const moved = workstreams[0];
  if (moved && moved.moved > 0)
    lines.push({
      id: "moved",
      label: "Moved most since you looked",
      rule: "The workstream with the most members changed since you last left the overview",
      subject: { kind: "workstream", id: moved.id, name: moved.name },
      detail: `${moved.moved} ${moved.moved === 1 ? "item" : "items"} moved${moved.movedDone > 0 ? `, ${moved.movedDone} to done` : ""}`,
    });
  const quiet = workstreams.toSorted(
    (a, b) => a.lastActivity.localeCompare(b.lastActivity) || a.id.localeCompare(b.id),
  )[0];
  if (quiet && quiet.idleDays > 0 && workstreams.length > 1)
    lines.push({
      id: "quiet",
      label: "Quiet longest",
      rule: "The open workstream whose latest member update or thread activity is oldest",
      subject: { kind: "workstream", id: quiet.id, name: quiet.name },
      detail: `nothing moved in ${quiet.idleDays} ${quiet.idleDays === 1 ? "day" : "days"}`,
    });
  // Chat messages from the last 7 days, and the items they name.
  const named = new Map<string, number>();
  for (const record of input.records)
    if (record.facets.kind === "message" && thisWeek(record.updatedAt, input.now))
      for (const to of new Set((record.facets.references ?? []).map((ref) => identityOf(ref))))
        named.set(to, (named.get(to) ?? 0) + 1);
  const talked = [...named]
    .flatMap(([key, count]) => {
      const record = byIdentity.get(key);
      return record ? [{ record, count }] : [];
    })
    .toSorted((a, b) => b.count - a.count || a.record.id.localeCompare(b.record.id))[0];
  if (talked) {
    const where = holder.get(identityOf(talked.record));
    lines.push({
      id: "talked",
      label: "Named most in chat this week",
      rule: "The item chat messages from the last 7 days name most",
      subject: { kind: "item", item: itemRef(talked.record) },
      detail: `named ${talked.count}× · ${where ? `in ${where.name}` : "not in a workstream"}`,
    });
  }
  const top = candidates[0];
  const topItem = top && (top.subject.kind === "item" ? top.subject.item : top.subject.lead);
  if (top && topItem)
    lines.push({
      id: "top",
      label: "Top not in a workstream",
      rule: top.rule,
      subject: { kind: "item", item: topItem },
      detail: [top.source, top.detail].filter(Boolean).join(" · "),
    });
  return lines;
}
