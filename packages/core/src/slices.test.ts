import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, type ItemId, type Ulid } from "./ids.ts";
import {
  buildSlices,
  isStale,
  type SliceFact,
  type SliceSet,
  sliceFigures,
  slicesSaid,
  staleness,
  workOf,
} from "./slices.ts";

const at = instant(new Date("2026-11-01T00:00:00.000Z"));
const later = instant(new Date("2026-11-02T00:00:00.000Z"));
const id = "01M6JWP9PNJ013RK0Z1KBB772P" as Ulid;
const jira = (key: string) => `jira:${key}` as ItemId;
const message = "slack:C0FW1WEATHR-1788444000.000100" as ItemId;

// An epic, two open stories with estimates, one open with none, one done,
// and a Slack message, which has no state and so is never cut.
const facts: SliceFact[] = [
  { id: jira("SYN-3"), state: "in-progress", estimate: null, updatedAt: at, kind: "epic" },
  { id: jira("SYN-45"), state: "todo", estimate: null, updatedAt: at, container: jira("SYN-3") },
  { id: jira("SYN-61"), state: "todo", estimate: 3, updatedAt: at, container: jira("SYN-3") },
  {
    id: jira("SYN-102"),
    state: "in-progress",
    estimate: 8,
    updatedAt: at,
    container: jira("SYN-3"),
  },
  { id: jira("SYN-26"), state: "done", estimate: 5, updatedAt: at, container: jira("SYN-3") },
  { id: message, updatedAt: at },
];

const request = {
  slices: [
    {
      name: "Rebook",
      defer: ["jira:SYN-61"],
      keeps: ["Rebook in two taps [[jira:SYN-102]]."],
      loses: ["No SMS [[jira:SYN-61]]."],
    },
    {
      name: "Smallest",
      defer: ["jira:SYN-45", "jira:SYN-61"],
      keeps: ["Rebooking [[jira:SYN-102]]."],
      loses: [],
    },
  ],
  needs: [{ item: "jira:SYN-102", on: "jira:SYN-45", from: [message] }],
};

const built = (input: unknown = request, seen = new Map()) => {
  const result = buildSlices(id, input, facts, seen);
  if (!result.ok) assert.fail(result.why);
  return result.value;
};

test("the items a slice can cut are tracked work, never a container or a message", () => {
  assert.deepEqual(
    workOf(facts).map((f) => f.id),
    ["jira:SYN-45", "jira:SYN-61", "jira:SYN-102", "jira:SYN-26"],
  );
  // An epic with none of its stories here, and a subtask, by their kind.
  const alone: SliceFact[] = [
    { id: jira("SYN-7"), state: "todo", updatedAt: at, kind: "epic" },
    { id: jira("SYN-8"), state: "todo", updatedAt: at, kind: "subtask" },
    { id: jira("SYN-9"), state: "todo", updatedAt: at, kind: "story" },
  ];
  assert.deepEqual(
    workOf(alone).map((f) => f.id),
    ["jira:SYN-9"],
  );
  // Open first, then done, each in their keys' order.
  assert.deepEqual(built().items, ["jira:SYN-45", "jira:SYN-61", "jira:SYN-102", "jira:SYN-26"]);
});

test("Oriel computes a cut's figures, with missing estimates apart and done items aside", () => {
  const set = built();
  const smallest = sliceFigures(set, facts, new Set(["jira:SYN-45", "jira:SYN-61"]));
  assert.deepEqual(smallest.kept, { items: 1, points: 8, unestimated: 0 });
  assert.deepEqual(smallest.deferred, { items: 2, points: 3, unestimated: 1 });
  assert.deepEqual(smallest.done, { items: 1, points: 5, unestimated: 0 });
  // SYN-102 is kept and needs SYN-45, deferred here: the agent's reading.
  assert.deepEqual(smallest.broken, [
    { item: "jira:SYN-102", on: "jira:SYN-45", from: [message], deferred: "jira:SYN-45" },
  ]);
  // Toggled back in, nothing is broken.
  assert.deepEqual(sliceFigures(set, facts, new Set(["jira:SYN-61"])).broken, []);
  // A done item named in the cut stays done, not deferred.
  assert.equal(sliceFigures(set, facts, new Set(["jira:SYN-26"])).deferred.items, 0);
});

test("what the agent reads back is Oriel's figures, in points and never days", () => {
  const said = slicesSaid(built(), facts);
  assert.match(
    said,
    /Rebook: keeps 2 items, 8 recorded points, 1 with no estimate; defers 1 item, 3 recorded points\./,
  );
  assert.match(said, /It defers what jira:SYN-102 needs \(jira:SYN-45\), by your reading\./);
  assert.doesNotMatch(said, /\bdays? (saved|faster)\b/);
});

test("a proposal is refused, with what to change, when it names what it can't", () => {
  const refused = (input: unknown, why: RegExp, seen = new Map()) => {
    const result = buildSlices(id, input, facts, seen);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.why, why);
  };
  const one = (change: object) => ({
    ...request,
    slices: [{ ...request.slices[0], ...change }, request.slices[1]],
  });
  refused({ slices: [request.slices[0]] }, /propose 2 or 3 slices/);
  refused(one({ defer: [] }), /defers nothing/);
  refused(one({ defer: ["jira:SYN-26"] }), /SYN-26 is done/);
  refused(one({ defer: ["jira:SYN-3"] }), /holds other items/);
  refused(one({ defer: ["jira:SYN-999"] }), /isn't one of the workstream's items/);
  refused(one({ defer: ["jira:SYN-45", "jira:SYN-61"] }), /defers what another slice does/);
  refused(one({ keeps: ["Something [[jira:SYN-404]]."] }), /names jira:SYN-404/);
  refused(one({ name: "Smallest" }), /share its name/);
  refused(
    { ...request, needs: [{ item: "jira:SYN-102", on: "x", from: ["jira:SYN-777"] }] },
    /you read nothing in jira:SYN-777/,
  );
  refused({ slices: "all of them" }, /slices\(\{ slices:/);
  // A search() hit this run found may be cited.
  const hit = "jira:SYN-777";
  const cited = buildSlices(
    id,
    { ...request, needs: [{ item: "jira:SYN-102", on: "x", from: [hit] }] },
    facts,
    new Map([[hit, later]]),
  );
  assert.equal(cited.ok, true);
  if (cited.ok) assert.deepEqual(cited.value.evidence.at(-1), { id: hit, updatedAt: later });
});

test("slices go stale when what they rest on changes, and say what", () => {
  const set: SliceSet = built();
  const region = facts.map((f) => f.id);
  assert.equal(isStale(staleness(set, facts, region)), false);
  // The Slack message the agent read the need in was edited.
  const edited = facts.map((f) => (f.id === message ? { ...f, updatedAt: later } : f));
  assert.deepEqual(staleness(set, edited, region).changed, [message]);
  // A story joined the workstream, and one left the index.
  const joined: SliceFact = { id: jira("SYN-117"), state: "todo", updatedAt: at };
  const moved = [...facts.filter((f) => f.id !== jira("SYN-61")), joined];
  const stale = staleness(set, moved, [...region, joined.id]);
  assert.deepEqual(stale.added, ["jira:SYN-117"]);
  assert.deepEqual(stale.removed, ["jira:SYN-61"]);
  assert.deepEqual(stale.gone, ["jira:SYN-61"]);
});
