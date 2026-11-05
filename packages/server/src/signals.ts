// Noticed's signals (decision 0052): what Oriel finds in
// the window by its own rules, computed from the index, the change log and
// the workstreams, as the overview is, never by a model. Each kind has a
// read that needs no region, declared as a block's read is (decision 0030),
// so a card's block is built by Oriel and pinned as a saved read that reruns
// with no model.
import {
  buildBlock,
  type ChangeLogEntry,
  daysSince,
  type Instant,
  type IndexRecord,
  type ItemId,
  isItemId,
  maxEvidence,
  parseItemId,
  type ResultFields,
  type Signal,
  type SignalKind,
  stuckDays,
  weights,
  type WorkstreamMember,
} from "@oriel/core";
import { assigneeOf } from "@oriel/groupings";
import { declarationOf } from "@oriel/sources";

export type SignalInput = {
  records: readonly IndexRecord[];
  // Every change log entry kept, in the order they committed.
  changes: readonly ChangeLogEntry[];
  // The open workstreams, with their members now.
  workstreams: readonly { id: string; name: string; members: readonly WorkstreamMember[] }[];
  // When each workstream's threads were last active.
  threadActivity: ReadonlyMap<string, Instant>;
  // The declared facet whose values each source's items add up, if any.
  estimateKey: (source: string) => { key: string; label: string } | null;
  now: Instant;
};

// The declared facet whose values a source's items add up, such as Jira's
// estimate, by its connection's prefix, with its label; null for none.
export const estimateKey = (source: string): { key: string; label: string } | null => {
  const kind = parseItemId(`${source}:x`)?.kind;
  const facets = (kind && declarationOf(kind)?.facets) || {};
  const found = Object.entries(facets).find(([, facet]) => facet.sums);
  return found ? { key: found[0], label: found[1].label } : null;
};

const identity = (source: string, stableId: string) => `${source}\u0000${stableId}`;
const identityOf = (item: { id: string; stableId: string }) =>
  identity(parseItemId(item.id)?.prefix ?? "", item.stableId);

// What the signals and their reads share: lookups made once.
type Lookups = {
  byIdentity: ReadonlyMap<string, IndexRecord>;
  byId: ReadonlyMap<string, IndexRecord>;
  members: (workstream: SignalInput["workstreams"][number]) => IndexRecord[];
  doneAt: ReadonlyMap<string, Instant>;
  // Chat messages by the stable ID of each item they name.
  named: ReadonlyMap<string, readonly IndexRecord[]>;
  // Change log entries by item, and those that moved an item into a
  // container by the container's stable ID, each in the order they
  // committed, so no signal scans the whole log.
  changesOf: ReadonlyMap<string, readonly ChangeLogEntry[]>;
  joinedTo: ReadonlyMap<string, readonly ChangeLogEntry[]>;
};

function lookups(input: SignalInput): Lookups {
  const byIdentity = new Map(input.records.map((record) => [identityOf(record), record]));
  const doneAt = new Map<string, Instant>();
  for (const entry of input.changes)
    if (entry.facets.state?.after === "done")
      doneAt.set(identity(entry.source, entry.stableId), entry.at);
  const changesOf = Map.groupBy(input.changes, (entry) => identity(entry.source, entry.stableId));
  const joinedTo = Map.groupBy(
    input.changes.filter((entry) => entry.facets.container?.after),
    (entry) => entry.facets.container?.after?.stableId ?? "",
  );
  return {
    changesOf,
    joinedTo,
    byIdentity,
    byId: new Map(input.records.map((record) => [record.id as string, record])),
    members: (workstream) =>
      [...new Set(workstream.members.map(identityOf))].flatMap((key) => byIdentity.get(key) ?? []),
    doneAt,
    named: new Map(
      [
        ...Map.groupBy(
          input.records.flatMap((record) =>
            record.facets.kind === "message"
              ? [...new Set((record.facets.references ?? []).map((ref) => ref.stableId))].map(
                  (stableId) => ({ stableId, record }),
                )
              : [],
          ),
          ({ stableId }) => stableId,
        ),
      ].map(([stableId, list]) => [stableId, list.map(({ record }) => record)]),
    ),
  };
}

const latest = (instants: readonly string[]) =>
  instants.reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// How long ago, in steps that double, so a dismissal holds while a stall
// grows a little and lets go when it has doubled.
const doubling = (n: number, from: number) => {
  let step = from;
  while (step * 2 <= n) step *= 2;
  return step;
};

const keyOf = (record: IndexRecord) => parseItemId(record.id)?.key ?? record.id;

// The reads a card's block names. Each declares its result's fields, as
// search() does, so `buildBlock` refuses anything else, and takes only IDs
// and whole numbers, checked again on every rerun.
type SignalRead = {
  fields: ResultFields;
  // Its result, or null when its arguments name nothing there is.
  run: (input: SignalInput, args: readonly unknown[], at: Lookups) => unknown[] | null;
};

const days = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 90 ? value : null;

// The estimate changes the change log has for these items within `within`
// days, each item's first before and last after.
function estimateChanges(
  input: SignalInput,
  records: readonly IndexRecord[],
  within: number,
  at: Lookups,
): { record: IndexRecord; before: number; after: number }[] {
  return [...new Map(records.map((record) => [identityOf(record), record])).values()].flatMap(
    (record) => {
      let first: number | null = null;
      let last: number | null = null;
      for (const entry of at.changesOf.get(identityOf(record)) ?? []) {
        if (daysSince(entry.at, input.now) >= within) continue;
        const key = input.estimateKey(entry.source)?.key;
        const change = key ? entry.facets.declared?.[key] : undefined;
        if (typeof change?.before !== "number" || typeof change.after !== "number") continue;
        first ??= change.before;
        last = change.after;
      }
      return first !== null && last !== null && first !== last
        ? [{ record, before: first, after: last }]
        : [];
    },
  );
}

// What a workstream's summed facet is called, by the source of its first
// changed item, lower-cased in a sentence: "estimate".
const labelOf =
  (input: SignalInput) =>
  (changes: readonly { record: IndexRecord }[]): string =>
    (
      input.estimateKey(parseItemId(changes[0]?.record.id ?? "")?.prefix ?? "")?.label ?? "Total"
    ).toLowerCase();

// Items whose container became `container` within `within` days.
function joined(
  input: SignalInput,
  container: IndexRecord,
  within: number,
  at: Lookups,
): { record: IndexRecord; at: Instant }[] {
  const found = new Map<string, { record: IndexRecord; at: Instant }>();
  for (const entry of at.joinedTo.get(container.stableId) ?? []) {
    if (daysSince(entry.at, input.now) >= within) continue;
    const record = at.byIdentity.get(identity(entry.source, entry.stableId));
    // Still there: one that left again isn't growth.
    if (record && record.facets.container?.stableId === container.stableId)
      found.set(identityOf(record), { record, at: entry.at });
  }
  return [...found.values()];
}

// Chat messages that name `item` after it was done.
function namedAfterDone(input: SignalInput, item: IndexRecord, at: Lookups): IndexRecord[] {
  if (item.facets.state !== "done") return [];
  const since = at.doneAt.get(identityOf(item)) ?? item.updatedAt;
  return (at.named.get(item.stableId) ?? []).filter((record) => record.updatedAt > since);
}

const inProgress = (record: IndexRecord) =>
  record.facets.state === "in-progress" && record.facets.kind !== "epic";

function load(input: SignalInput) {
  const byPerson = Map.groupBy(
    input.records.filter(inProgress).flatMap((record) => {
      const person = assigneeOf(record);
      return person ? [{ person, record }] : [];
    }),
    ({ person }) => person.id,
  );
  return [...byPerson].map(([id, list]) => ({
    id,
    name: list[0]?.person.name ?? id,
    records: list.map(({ record }) => record),
  }));
}

const workstreamNamed = (input: SignalInput, id: unknown) =>
  typeof id === "string" ? input.workstreams.find((each) => each.id === id) : undefined;

export const signalReads: Readonly<Record<string, SignalRead>> = {
  // A workstream's members not done, longest quiet first.
  "signals.open": {
    fields: {
      source: "the index: a workstream's items not done, quiet longest first",
      lists: { "": { id: "Item", state: "State", idleDays: "Days since an update" } },
    },
    run: (input, [id], at) => {
      const workstream = workstreamNamed(input, id);
      if (!workstream) return null;
      return at
        .members(workstream)
        .filter((record) => record.facets.state !== "done" && record.facets.kind !== "epic")
        .map((record) => ({
          id: record.id,
          state: record.facets.state ?? null,
          idleDays: daysSince(record.updatedAt, input.now),
        }))
        .toSorted((a, b) => b.idleDays - a.idleDays || a.id.localeCompare(b.id));
    },
  },
  // A workstream's estimate changes in the last `days` days, the largest
  // rise first.
  "signals.estimates": {
    fields: {
      source: "the change log: estimate changes",
      lists: {
        "": { id: "Item", key: "Key", title: "Title", before: "Before", after: "After" },
      },
    },
    run: (input, [id, within], at) => {
      const workstream = workstreamNamed(input, id);
      const span = days(within);
      if (!workstream || span === null) return null;
      return estimateChanges(input, at.members(workstream), span, at)
        .map(({ record, before, after }) => ({
          id: record.id,
          key: keyOf(record),
          title: record.title,
          before,
          after,
        }))
        .toSorted((a, b) => b.after - b.before - (a.after - a.before) || a.id.localeCompare(b.id));
    },
  },
  // Items in progress by person, most first.
  "signals.load": {
    fields: {
      source: "the index: items in progress, by person",
      lists: { "": { name: "Person", inProgress: "In progress" } },
    },
    run: (input) =>
      load(input)
        .map((person) => ({ name: person.name, inProgress: person.records.length }))
        .toSorted((a, b) => b.inProgress - a.inProgress || a.name.localeCompare(b.name)),
  },
  // The chat messages naming an item since it was done.
  "signals.after-done": {
    fields: {
      source: "the index: chat messages naming an item after it was done",
      lists: { "": { id: "Message" } },
    },
    run: (input, [id], at) => {
      const item = typeof id === "string" && isItemId(id) ? at.byId.get(id) : undefined;
      if (!item) return null;
      return namedAfterDone(input, item, at)
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((record) => ({ id: record.id }));
    },
  },
  // The items that joined a container in the last `days` days.
  "signals.joined": {
    fields: {
      source: "the change log: items that joined it",
      lists: { "": { id: "Item" } },
    },
    run: (input, [id, within], at) => {
      const container = typeof id === "string" && isItemId(id) ? at.byId.get(id) : undefined;
      const span = days(within);
      if (!container || span === null) return null;
      return joined(input, container, span, at)
        .toSorted((a, b) => b.at.localeCompare(a.at))
        .map(({ record }) => ({ id: record.id }));
    },
  },
};

// Runs a signal read for a block, as a pin's rerun does: its result, or
// null when the read is unknown or names nothing there now.
export function runSignalRead(
  input: SignalInput,
  read: string,
  args: readonly unknown[],
): { value: unknown[]; fields: ResultFields } | null {
  const declared = Object.hasOwn(signalReads, read) ? signalReads[read] : undefined;
  if (!declared) return null;
  const value = declared.run(input, args, lookups(input));
  return value ? { value, fields: declared.fields } : null;
}

// The rules, each the same for every signal of its kind.
export const signalRules: Record<SignalKind, string> = {
  stalled: `An open workstream with items not done, and no member update or thread activity in ${stuckDays} days`,
  drift:
    "Items in an open workstream whose estimates, summed, rose by 5 or more, or by a quarter and at least 3, in 14 days",
  overloaded: "A person with at least 5 items in progress, twice the median or more",
  contradicted: "A chat message that names an item after it was marked done",
  scope:
    "An epic that gained 3 items or more, and a quarter or more of its size, in 7 days. Only items that moved in count: Oriel doesn't log new items yet",
};

// Every signal that holds now, heaviest first.
export function signalsOf(input: SignalInput): Signal[] {
  const at = lookups(input);
  const label = labelOf(input);
  const found: Signal[] = [];

  for (const workstream of input.workstreams) {
    const members = at.members(workstream);
    const open = members.filter(
      (record) => record.facets.state !== "done" && record.facets.kind !== "epic",
    );
    // The workstream's epics, at most one, as the items behind a stall or a
    // drift: the place its reason is often written.
    const epics = members
      .filter((record) => record.facets.kind === "epic")
      .slice(0, 1)
      .map((record) => record.id);
    const lastActivity = latest([
      ...members.map((record) => record.updatedAt),
      ...[input.threadActivity.get(workstream.id) ?? []].flat(),
    ]);
    const idle = lastActivity ? daysSince(lastActivity as Instant, input.now) : 0;
    if (open.length > 0 && idle >= stuckDays)
      found.push({
        id: `stalled:${workstream.id}`,
        kind: "stalled",
        subject: { kind: "workstream", id: workstream.id, name: workstream.name },
        headline: `${workstream.name}: nothing moved in ${idle} days, with ${plural(open.length, "item")} not done`,
        rule: signalRules.stalled,
        weight: weights.stalled * Math.min(open.length, 4),
        // The stall's start, so a new stall later is a new card.
        fingerprint: `since ${lastActivity?.slice(0, 10)}, idle≥${doubling(idle, stuckDays)}`,
        // Its epic first, where a stall's reason is often written down.
        items: [
          ...epics,
          ...open.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((r) => r.id),
        ].slice(0, maxEvidence),
        block: {
          read: "signals.open",
          args: [workstream.id],
          from: undefined,
          where: undefined,
          form: "rows",
        },
      });

    const changes = estimateChanges(input, members, 14, at);
    const before = changes.reduce((sum, change) => sum + change.before, 0);
    const after = changes.reduce((sum, change) => sum + change.after, 0);
    const rise = after - before;
    if (rise >= 5 || (before > 0 && rise / before >= 0.25 && rise >= 3))
      found.push({
        id: `drift:${workstream.id}`,
        kind: "drift",
        subject: { kind: "workstream", id: workstream.id, name: workstream.name },
        headline: `${workstream.name}: ${label(changes)} rose on ${plural(changes.length, "item")}, from ${before} to ${after} in all, in 14 days`,
        rule: signalRules.drift,
        weight: weights.moved * changes.length + 1,
        fingerprint: `after=${after}`,
        items: [
          ...epics,
          ...changes
            .toSorted((a, b) => b.after - b.before - (a.after - a.before))
            .map(({ record }) => record.id),
        ].slice(0, maxEvidence),
        block: {
          read: "signals.estimates",
          args: [workstream.id, 14],
          from: undefined,
          where: undefined,
          form: "table",
          columns: ["key", "title", "before", "after"],
        },
      });
  }

  const people = load(input);
  const counts = people.map((person) => person.records.length).toSorted((a, b) => a - b);
  const median = counts.length
    ? counts.length % 2
      ? (counts[(counts.length - 1) / 2] ?? 0)
      : ((counts[counts.length / 2 - 1] ?? 0) + (counts[counts.length / 2] ?? 0)) / 2
    : 0;
  for (const person of people) {
    const n = person.records.length;
    if (n < 5 || n < 2 * median) continue;
    found.push({
      id: `overloaded:${person.id}`,
      kind: "overloaded",
      subject: { kind: "person", id: person.id, name: person.name },
      headline: `${person.name} has ${n} items in progress; the median person has ${median}`,
      rule: signalRules.overloaded,
      weight: weights.glance * (n - median),
      fingerprint: `n≥${doubling(n, 5)}`,
      items: person.records
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, maxEvidence)
        .map((record) => record.id),
      block: {
        read: "signals.load",
        args: [],
        from: undefined,
        where: undefined,
        form: "bars",
        label: "name",
        value: "inProgress",
      },
    });
  }

  for (const item of input.records) {
    const messages = namedAfterDone(input, item, at);
    if (messages.length > 0)
      found.push({
        id: `contradicted:${item.id}`,
        kind: "contradicted",
        subject: { kind: "item", id: item.id },
        headline: `${plural(messages.length, "chat message")} named ${keyOf(item)} after it was marked done`,
        rule: signalRules.contradicted,
        weight: weights.asks * messages.length,
        fingerprint: messages
          .map((message) => message.id)
          .toSorted()
          .join(","),
        items: [
          item.id,
          ...messages
            .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, maxEvidence - 1)
            .map((message) => message.id),
        ],
        block: {
          read: "signals.after-done",
          args: [item.id],
          from: undefined,
          where: undefined,
          form: "rows",
        },
      });

    if (item.facets.kind !== "epic") continue;
    const added = joined(input, item, 7, at);
    const size = input.records.filter(
      (record) => record.facets.container?.stableId === item.stableId,
    ).length;
    if (added.length >= 3 && added.length * 4 >= size)
      found.push({
        id: `scope:${item.id}`,
        kind: "scope",
        subject: { kind: "item", id: item.id },
        headline: `${keyOf(item)} gained ${plural(added.length, "item")} in 7 days, and now holds ${size}`,
        rule: signalRules.scope,
        weight: weights.moved * added.length,
        fingerprint: `size=${size}`,
        items: [
          item.id,
          ...added
            .toSorted((a, b) => b.at.localeCompare(a.at))
            .slice(0, maxEvidence - 1)
            .map(({ record }) => record.id),
        ],
        block: {
          read: "signals.joined",
          args: [item.id, 7],
          from: undefined,
          where: undefined,
          form: "rows",
        },
      });
  }

  return found.toSorted((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

// A signal's block, built by Oriel from its read now, as a pin's rerun
// builds it; null when its read names nothing there now.
export function signalBlock(input: SignalInput, spec: Signal["block"]) {
  const read = runSignalRead(input, spec.read, spec.args ?? []);
  if (!read) return null;
  const built = buildBlock(spec, { value: read.value, outside: false, fields: read.fields });
  return built.ok ? built.block : null;
}

// The items a signal names, for the model: what each is and where it
// stands, from the index; its text is the run's to read.
export function evidenceFacts(input: SignalInput, ids: readonly ItemId[]) {
  const byId = new Map(input.records.map((record) => [record.id as string, record]));
  return ids.flatMap((id) => {
    const record = byId.get(id);
    if (!record) return [];
    return [
      {
        id,
        kind: record.facets.kind ?? null,
        state: record.facets.state ?? null,
        assignee: assigneeOf(record)?.name ?? null,
        estimate: record.facets.estimate ?? null,
        daysSinceUpdate: daysSince(record.updatedAt, input.now),
      },
    ];
  });
}
