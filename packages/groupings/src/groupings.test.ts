import assert from "node:assert/strict";
import { test } from "node:test";
import { type Cluster, type Grouping, type Instant, instant } from "@oriel/core";
import { fixtureSnapshot, type JiraRecord } from "@oriel/jira";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { assigneeGrouping, byKey, epicGrouping, stuckGrouping } from "./groupings.ts";

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const snapshot = (edited: number) => fixtureSnapshot(fixture, site, edited).records;

// The index after each number of source edits, from the base to all of them.
const states = Array.from({ length: fixture.edits.length + 1 }, (_, edited) => ({
  edited,
  records: snapshot(edited),
}));
const current = snapshot(fixture.edits.length);

const day = 86_400_000;
const at = (iso: string) => instant(new Date(iso));
const shift = (from: Instant, ms: number) => instant(new Date(Date.parse(from) + ms));
// The fixture's last event, then later instants, so items cross the 14 days.
const last = at("2026-10-02T11:00:00.000Z");
const nows = [last, ...[1, 2, 30, 400].map((days) => shift(last, days * day))];

const groupings = [epicGrouping, assigneeGrouping, stuckGrouping];

// Each derived rule Oriel shows, checked as its words read, independently of
// the grouping that wrote it. A rule missing here fails the check.
type Rule = (record: JiraRecord, now: Instant, index: readonly JiraRecord[]) => boolean;
const workItem = (record: JiraRecord) => ["Story", "Task", "Bug"].includes(record.attrs.issueType);
const notDone = (record: JiraRecord) => record.facets.state !== "done";
const epicOf = (record: JiraRecord) => record.facets.container ?? null;
const assigneeId = (record: JiraRecord) =>
  record.facets.people?.find((person) => person.role === "assignee")?.id ?? null;
const rules: Record<string, Rule> = {
  "Items not done and last updated 14 or more days ago; from Jira, only stories, tasks and bugs": (
    record,
    now,
  ) =>
    workItem(record) &&
    notDone(record) &&
    Date.parse(now) - Date.parse(record.updatedAt) >= 14 * day,
  "Jira stories, tasks and bugs not done and with no story point estimate": (record) =>
    workItem(record) && notDone(record) && record.attrs.points === null,
  "Items whose epic isn't in the index": (record, _now, index) => {
    const epic = epicOf(record);
    return epic !== null && !index.some((other) => other.stableId === epic.stableId);
  },
};

// What's wrong with a grouping's derived clusters: a rule we can't check, an
// item shown that the rule is false of, or one the rule fits that's left out.
// A cluster's anchor isn't one of the grouping's items, so rules skip anchors.
function ruleProblems(clusters: Cluster[], index: readonly JiraRecord[], now: Instant): string[] {
  const problems: string[] = [];
  const anchors = new Set(clusters.map((cluster) => cluster.anchor));
  for (const cluster of clusters) {
    if (cluster.origin === "source") continue;
    const rule = rules[cluster.origin.derived];
    if (!rule) {
      problems.push(`${cluster.key}: no check for "${cluster.origin.derived}"`);
      continue;
    }
    const shown = new Set(cluster.itemIds);
    for (const record of index) {
      if (anchors.has(record.id)) continue;
      const holds = rule(record, now, index);
      if (shown.has(record.id) && !holds) problems.push(`${cluster.key}: shows ${record.id}`);
      if (!shown.has(record.id) && holds) problems.push(`${cluster.key}: leaves out ${record.id}`);
    }
    const known = new Set<string>(index.map((record) => record.id));
    for (const id of shown) if (!known.has(id)) problems.push(`${cluster.key}: unknown ${id}`);
  }
  return problems;
}

// Every record of the index in exactly one cluster's items (`items`), or as
// exactly one cluster's anchor and in no cluster's items (`anchors`).
function placement(clusters: Cluster[], index: readonly JiraRecord[]) {
  const count = (ids: (string | null)[]) => {
    const counts = new Map<string, number>();
    for (const id of ids) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  };
  const items = count(clusters.flatMap((cluster) => cluster.itemIds));
  const anchors = count(clusters.map((cluster) => cluster.anchor));
  return index.map((record) => ({
    id: record.id,
    items: items.get(record.id) ?? 0,
    anchors: anchors.get(record.id) ?? 0,
  }));
}

test("every derived rule is true of each item it shows, and of none it leaves out", () => {
  let checked = 0;
  for (const { edited, records } of states) {
    for (const now of nows) {
      for (const grouping of groupings) {
        const clusters = grouping.group(records, now);
        assert.deepEqual(
          ruleProblems(clusters, records, now),
          [],
          `${grouping.id} ${edited} ${now}`,
        );
        checked += clusters.filter((cluster) => cluster.origin !== "source").length;
      }
    }
  }
  assert.equal(checked, states.length * nows.length * 2);
  // Not vacuous: the fixtures have items each stuck rule shows and leaves out.
  const [idle, unestimated] = stuckGrouping.group(current, last);
  assert.ok(idle && unestimated);
  assert.ok(idle.itemIds.length > 0 && idle.itemIds.length < current.length);
  assert.ok(unestimated.itemIds.length > 0 && unestimated.itemIds.length < current.length);
});

test("the rule check fails a grouping whose rule is wrong", () => {
  const index = current;
  const story = index.find((record) => record.id === "jira:SYN-88");
  assert.ok(story);
  const changed = (grouping: Grouping<JiraRecord>, change: (cluster: Cluster) => Cluster) => ({
    ...grouping,
    group: (records: readonly JiraRecord[], now: Instant) =>
      grouping.group(records, now).map(change),
  });
  const wrong: [string, Grouping<JiraRecord>][] = [
    ["a threshold a day short", stuckAfterDays(13)],
    ["a threshold a day long", stuckAfterDays(15)],
    [
      "an epic in a rule about stories, tasks and bugs",
      changed(stuckGrouping, (c) => ({ ...c, itemIds: [...c.itemIds, "jira:SYN-7"] })),
    ],
    ["an item left out", changed(stuckGrouping, (c) => ({ ...c, itemIds: c.itemIds.slice(1) }))],
    [
      "a rule nobody checks",
      changed(stuckGrouping, (c) => ({ ...c, origin: { derived: "Probably stuck" } })),
    ],
    [
      "a story whose epic is in the index",
      {
        ...epicGrouping,
        group: () => [
          {
            key: "epic-not-indexed",
            label: "Epic not in the index",
            anchor: null,
            itemIds: [story.id],
            origin: { derived: "Items whose epic isn't in the index" },
          },
        ],
      },
    ],
  ];
  for (const [name, grouping] of wrong) {
    const caught = nows.some((now) => ruleProblems(grouping.group(index, now), index, now).length);
    assert.ok(caught, name);
  }
});

// The stuck grouping as if its threshold were `days`, under the real rule's
// text: it groups as of a later or earlier instant than the one it's given.
function stuckAfterDays(days: number): Grouping<JiraRecord> {
  return {
    ...stuckGrouping,
    group: (records, now) => stuckGrouping.group(records, shift(now, (14 - days) * day)),
  };
}

test("no update in 14 days counts back from now to the millisecond", () => {
  const base = current.find((record) => record.id === "jira:SYN-88");
  assert.ok(base && notDone(base) && workItem(base));
  const now = at("2026-10-20T12:00:00.000Z");
  const updated = (ms: number, key: string): JiraRecord => ({
    ...base,
    id: `jira:${key}`,
    updatedAt: shift(now, -ms),
  });
  const records = [
    updated(14 * day, "SYN-900"),
    updated(14 * day - 1, "SYN-901"),
    updated(30 * day, "SYN-902"),
    // Updated after `now`: not idle, and no negative age either.
    updated(-day, "SYN-903"),
  ];
  const [idle] = stuckGrouping.group(records, now);
  // The longest idle first.
  assert.deepEqual(idle?.itemIds, ["jira:SYN-902", "jira:SYN-900"]);
});

test("stuck leaves out epics, done work, types it doesn't name and zero estimates", () => {
  const epic = current.find((record) => record.id === "jira:SYN-7");
  const done = current.find((record) => record.facets.state === "done");
  const story = current.find((record) => record.id === "jira:SYN-88");
  assert.ok(epic && done && story);
  const old = at("2020-01-01T00:00:00.000Z");
  const records: JiraRecord[] = [
    { ...epic, updatedAt: old },
    { ...done, updatedAt: old, attrs: { ...done.attrs, points: null } },
    {
      ...story,
      id: "jira:SYN-900",
      updatedAt: old,
      attrs: { ...story.attrs, issueType: "Sub-task", points: null },
    },
    { ...story, id: "jira:SYN-901", attrs: { ...story.attrs, points: 0 } },
  ];
  const clusters = stuckGrouping.group(records, last);
  assert.deepEqual(
    clusters.map((cluster) => [cluster.key, cluster.label, cluster.itemIds]),
    [
      ["no-update-14-days", "No update in 14 days", []],
      ["unestimated", "Unestimated", []],
    ],
  );
  assert.ok(clusters.every((cluster) => cluster.origin !== "source"));
});

test("each epic is a cluster keyed by its stable ID, anchored on it, holding its items", () => {
  for (const { edited, records } of states) {
    const clusters = epicGrouping.group(records, last);
    const epics = records.filter((record) => record.attrs.issueType === "Epic");
    const items = records.filter((record) => record.attrs.issueType !== "Epic").toSorted(byKey);
    assert.deepEqual(
      clusters.map(({ key, label, anchor, itemIds, origin }) => ({
        key,
        label,
        anchor,
        itemIds,
        origin,
      })),
      [
        ...epics.toSorted(byKey).map((epic) => ({
          key: epic.stableId,
          label: epic.title,
          anchor: epic.id,
          itemIds: items.filter((item) => epicOf(item)?.id === epic.id).map((item) => item.id),
          origin: "source",
        })),
        {
          key: "no-epic",
          label: "No epic",
          anchor: null,
          itemIds: items.filter((item) => epicOf(item) === null).map((item) => item.id),
          origin: "source",
        },
      ],
      `after ${edited} edits`,
    );
    for (const place of placement(clusters, records)) {
      const isEpic = epics.some((epic) => epic.id === place.id);
      assert.deepEqual(place, { id: place.id, items: isEpic ? 0 : 1, anchors: isEpic ? 1 : 0 });
    }
  }
});

test("over the base, the epic grouping reproduces each frozen epic region", () => {
  const [base] = states;
  assert.ok(base);
  const clusters = epicGrouping.group(base.records, last);
  const regions = fixture.regions.flatMap((region) =>
    region.origin.kind === "cluster" && region.origin.grouping === "epic"
      ? [{ ...region, origin: region.origin }]
      : [],
  );
  assert.equal(regions.length, 3);
  for (const region of regions) {
    const cluster = clusters.find((c) => c.key === region.origin.cluster);
    assert.ok(cluster, region.name);
    assert.equal(cluster.anchor, region.origin.anchor);
    const ids = [cluster.anchor ?? "", ...cluster.itemIds];
    assert.deepEqual(ids.toSorted(), region.items.toSorted(), region.name);
  }
});

test("the epic grouping follows the source edits and keeps an epic with no stories", () => {
  const clusters = epicGrouping.group(current, last);
  const keyed = (key: string) => clusters.find((cluster) => cluster.key === key);
  // SYN-88 moved from checkout (SYN-1) to weather (SYN-3); SYN-27 was deleted.
  assert.ok(keyed("10003")?.itemIds.includes("jira:SYN-88"));
  assert.equal(keyed("10001")?.itemIds.includes("jira:SYN-88"), false);
  assert.ok(clusters.every((cluster) => !cluster.itemIds.includes("jira:SYN-27")));
  assert.deepEqual(keyed("10007")?.itemIds, []);
  assert.equal(keyed("10005")?.itemIds.length, 40);
});

test("items whose epic isn't in the index get a derived cluster that says so", () => {
  // Without the weather epic, its stories still name it.
  const records = current.filter((record) => record.id !== "jira:SYN-3");
  const clusters = epicGrouping.group(records, last);
  const orphaned = records.filter((record) => epicOf(record)?.id === "jira:SYN-3");
  assert.ok(orphaned.length > 0);
  const missing = clusters.at(-1);
  assert.deepEqual(missing, {
    key: "epic-not-indexed",
    label: "Epic not in the index",
    anchor: null,
    itemIds: orphaned.toSorted(byKey).map((record) => record.id),
    origin: { derived: "Items whose epic isn't in the index" },
  });
  assert.deepEqual(ruleProblems(clusters, records, last), []);
  assert.equal(
    clusters.some((cluster) => cluster.key === "10003"),
    false,
  );
});

test("an item the source names as an epic anchors a cluster, whatever its type", () => {
  const story = current.find((record) => record.id === "jira:SYN-88");
  const other = current.find((record) => record.id === "jira:SYN-10");
  assert.ok(story && other);
  const child = {
    ...other,
    facets: { ...other.facets, container: { id: story.id, stableId: story.stableId } },
  };
  // Whether the story names an epic of its own or not, it's an anchor, never an item.
  for (const epic of [null, { id: "jira:SYN-3" as const, stableId: "10003" }]) {
    const records: JiraRecord[] = [
      { ...story, facets: { ...story.facets, container: epic } },
      child,
    ];
    const clusters = epicGrouping.group(records, last);
    assert.deepEqual(clusters.find((cluster) => cluster.anchor === story.id)?.itemIds, [child.id]);
    assert.deepEqual(ruleProblems(clusters, records, last), []);
    for (const place of placement(clusters, records)) {
      const anchor: boolean = place.id === story.id;
      assert.deepEqual(place, { id: place.id, items: anchor ? 0 : 1, anchors: anchor ? 1 : 0 });
    }
  }
});

test("one cluster per assignee by name, then the unassigned, with epics as items", () => {
  for (const { edited, records } of states) {
    const clusters = assigneeGrouping.group(records, last);
    const people = new Map(
      records.flatMap(({ facets }) =>
        (facets.people ?? []).flatMap((person) =>
          person.role === "assignee" ? [[person.id, person.name] as const] : [],
        ),
      ),
    );
    const names = [...people.values()].toSorted((a, b) => a.localeCompare(b, "en"));
    assert.deepEqual(
      clusters.map((cluster) => cluster.label),
      [...names, "Unassigned"],
      `after ${edited} edits`,
    );
    for (const cluster of clusters) {
      assert.equal(cluster.origin, "source");
      assert.equal(cluster.anchor, null);
      const members = records.filter((record) => cluster.itemIds.includes(record.id));
      const accountId = cluster.key === "unassigned" ? null : cluster.key.slice("person:".length);
      assert.ok(members.every((record) => assigneeId(record) === accountId));
      assert.deepEqual(
        cluster.itemIds,
        members.toSorted(byKey).map((record) => record.id),
      );
    }
    for (const place of placement(clusters, records)) {
      assert.deepEqual(place, { id: place.id, items: 1, anchors: 0 });
    }
  }
  // Stale (inactive) assignees keep their clusters, and epics are items.
  const clusters = assigneeGrouping.group(current, last);
  const labels = clusters.map((cluster) => cluster.label);
  assert.ok(labels.includes("Greta Lindqvist") && labels.includes("Hiro Tanabe"));
  assert.ok(clusters.find((c) => c.label === "Amara Okafor")?.itemIds.includes("jira:SYN-1"));
  assert.ok(clusters.find((c) => c.key === "unassigned")?.itemIds.includes("jira:SYN-7"));
});

test("groupings are pure: the same records in any order give the same clusters", () => {
  const shuffled = current.toReversed();
  for (const grouping of groupings) {
    for (const now of nows) {
      assert.deepEqual(grouping.group(shuffled, now), grouping.group(current, now), grouping.id);
    }
  }
});
