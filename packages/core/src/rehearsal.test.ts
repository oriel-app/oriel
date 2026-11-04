import assert from "node:assert/strict";
import { test } from "node:test";
import type { Instant, ItemId } from "./ids.ts";
import { rehearsalBody, staleness } from "./rehearsal.ts";
import { recordedArgs } from "./sketch.ts";

const [a, b, c] = ["jira:SYN-1", "jira:SYN-2", "jira:SYN-3"] as ItemId[];
const t1 = "2026-10-01T00:00:00.000Z" as Instant;
const t2 = "2026-10-02T00:00:00.000Z" as Instant;

test("a rehearsal is stale by what changed, went, joined or left since it was kept", () => {
  const kept = {
    seen: [
      { id: a as ItemId, updatedAt: t1 },
      { id: b as ItemId, updatedAt: t1 },
      { id: c as ItemId, updatedAt: t1 },
    ],
  };
  const at = new Map<string, Instant>([
    [a as string, t1],
    [b as string, t2],
  ]);
  assert.deepEqual(
    staleness(kept, {
      members: [a as ItemId, b as ItemId, "folder:x" as ItemId],
      updatedAt: (id) => at.get(id) ?? null,
    }),
    [
      { kind: "changed", ids: [b] },
      { kind: "added", ids: ["folder:x"] },
      { kind: "removed", ids: [c] },
    ],
  );
  assert.deepEqual(staleness(kept, { members: [a as ItemId], updatedAt: () => null }), [
    { kind: "gone", ids: [a] },
    { kind: "removed", ids: [b, c] },
  ]);
});

test("a rehearsal holds 1 to 8 situations, and an item's words only as a quote", () => {
  assert.equal(rehearsalBody([]).ok, false);
  const one = { title: "Cancelled", evidence: [], unanswered: [] };
  assert.equal(rehearsalBody([one]).ok, true);
  assert.equal(rehearsalBody(Array.from({ length: 9 }, () => one)).ok, false);
  const scored = [{ ...one, evidence: [{ id: a, says: "ready", quote: null, against: null }] }];
  assert.equal(rehearsalBody(scored).ok, false);
});

test("a run's record keeps a rehearsal as its count and items, never its words", () => {
  const given = [
    {
      title: "Cancelled",
      evidence: [
        { id: "jira:SYN-2", says: "contradiction", quote: "Not done", against: "jira:SYN-1" },
      ],
      unanswered: [{ question: "Who owns it?", id: "slack:C1-1.0", quote: "who?" }],
    },
  ];
  assert.deepEqual(recordedArgs("rehearsal.record", [given]), [
    { situations: 1, items: ["jira:SYN-1", "jira:SYN-2", "slack:C1-1.0"] },
  ]);
  assert.deepEqual(recordedArgs("rehearsal.record", ["nonsense"]), [{ situations: 0, items: [] }]);
});
