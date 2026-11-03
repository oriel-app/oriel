import assert from "node:assert/strict";
import { test } from "node:test";
import { cost, responseUsage } from "./anthropic.ts";
import type { Split } from "./case.ts";
import { compareChange, formatChange, keeps, method, noChange } from "./compare.ts";
import type { CaseResult } from "./runner.ts";
import { differenceLow, signTest, stratifiedTest } from "./stats.ts";
import { message, streamed } from "./testing.ts";

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

const arms = (baseline: [number, number], candidate: [number, number]) => ({
  baseline: { passed: baseline[0], trials: baseline[1] },
  candidate: { passed: candidate[0], trials: candidate[1] },
});

test("with one trial a case in each arm, the stratified test is the sign test", () => {
  const cases = [
    arms([0, 1], [1, 1]),
    arms([0, 1], [1, 1]),
    arms([1, 1], [0, 1]),
    arms([0, 1], [0, 1]),
    arms([1, 1], [1, 1]),
  ];
  near(stratifiedTest(cases, "better"), signTest(2, 1));
  near(stratifiedTest(cases.slice(0, 2), "better"), signTest(2, 0));
});

test("the stratified test is the hypergeometric tail, convolved across cases", () => {
  // A case going 0/3 to 3/3: 1 of the 20 ways to deal its three passes.
  near(stratifiedTest([arms([0, 3], [3, 3])], "better"), 1 / 20);
  near(stratifiedTest([arms([0, 3], [3, 3]), arms([0, 3], [3, 3])], "better"), 1 / 400);
  // 3/3 to 1/3: 4 of 20 deals leave the candidate one pass or none.
  near(stratifiedTest([arms([3, 3], [1, 3])], "worse"), 4 / 20);
  // Arms of different sizes: 1/8 against 4/4.
  near(stratifiedTest([arms([1, 8], [4, 4])], "better"), 8 / 792);
  // A case that always passes, or never, carries no evidence.
  near(stratifiedTest([arms([4, 4], [4, 4]), arms([0, 4], [0, 4])], "worse"), 1);
});

test("the bound on a drop narrows with trials, and ignores how far apart the cases are", () => {
  const twelve = (arm: (i: number) => ReturnType<typeof arms>) =>
    Array.from({ length: 12 }, (_, i) => arm(i));
  near(differenceLow(twelve(() => arms([4, 4], [4, 4]))), -0.1007353);
  near(differenceLow(twelve(() => arms([8, 8], [8, 8]))), -0.0543873);
  // Four cases that always fail beside eight that always pass: no wider.
  near(
    differenceLow(twelve((i) => (i < 4 ? arms([0, 8], [0, 8]) : arms([8, 8], [8, 8])))),
    -0.0543873,
  );
  // Two cases dropping three trials in eight each.
  near(
    differenceLow(twelve((i) => (i < 2 ? arms([8, 8], [5, 8]) : arms([8, 8], [8, 8])))),
    -0.1243706,
  );
  near(differenceLow([arms([8, 8], [4, 4])]), -0.2804165);
  assert.equal(differenceLow([]), -1);
});

const trial = (
  id: string,
  pass: boolean,
  { split = "train", group = "replies", rep = 0, hash = `hash of ${id}`, error = false } = {} as {
    split?: Split;
    group?: string;
    rep?: number;
    hash?: string;
    error?: boolean;
  },
): CaseResult => ({
  id,
  hash,
  split,
  kind: 2,
  ...(rep ? { rep } : {}),
  group,
  outcome: error ? "error" : pass ? "pass" : "fail",
  grades: [],
  error: error ? "HTTP 529" : null,
  unrecorded: null,
  ms: 0,
});

// `passes` of `total` trials of one case.
const trials = (
  id: string,
  passes: number,
  total: number,
  group = "replies",
  split: Split = "train",
) => Array.from({ length: total }, (_, rep) => trial(id, rep < passes, { group, rep, split }));

// Eight cases that always pass, in two groups.
const steady = (n: number) => [
  ...["a", "b", "c", "d"].flatMap((id) => trials(`replies-${id}`, n, n)),
  ...["a", "b", "c", "d"].flatMap((id) => trials(`links-${id}`, n, n, "links")),
];

test("a fix is kept when its cases get better beyond noise and no group gets worse", () => {
  const baseline = [
    ...steady(8),
    ...trials("inject-a", 0, 8, "injection"),
    ...trials("inject-b", 1, 8, "injection"),
  ];
  const candidate = [
    ...steady(4),
    ...trials("inject-a", 4, 4, "injection"),
    ...trials("inject-b", 4, 4, "injection"),
  ];
  const fixed = compareChange(baseline, candidate, "better");
  assert.ok(keeps(fixed), formatChange(fixed));
  const [train] = fixed.splits;
  assert.ok(train && train.better < 0.001);
  assert.deepEqual(
    train?.moved.map((m) => m.id),
    ["inject-a", "inject-b"],
  );
  assert.match(formatChange(fixed), /\nkeep: better beyond noise at p ≤ 0\.05, and no group worse/);

  // The same gain, but one link case now fails every trial: its group is worse.
  const broke = [
    ...candidate.filter((r) => r.id !== "links-a"),
    ...trials("links-a", 0, 4, "links"),
  ];
  const guarded = compareChange(baseline, broke, "better");
  assert.equal(keeps(guarded), false);
  // Its failures also offset the fix's gain.
  assert.deepEqual(guarded.reasons, [
    "train: links is worse (p=0.002)",
    "train: not better beyond noise (p=0.094)",
  ]);
});

test("a fix within noise is reverted, however its rate moved", () => {
  const baseline = [...steady(4), ...trials("inject-a", 1, 4, "injection")];
  const candidate = [...steady(4), ...trials("inject-a", 3, 4, "injection")];
  const noisy = compareChange(baseline, candidate, "better");
  assert.equal(keeps(noisy), false);
  assert.match(noisy.reasons[0] ?? "", /^train: not better beyond noise \(p=0\.243\)$/);
});

test("a trim is kept when the bound on its drop stays inside the margin", () => {
  const many = (n: number) =>
    ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"].flatMap((id) =>
      trials(`case-${id}`, n, n, id < "f" ? "replies" : "links"),
    );
  const neutral = compareChange(many(8), many(8), "no-worse");
  assert.ok(keeps(neutral), formatChange(neutral));
  assert.ok((neutral.splits[0]?.low ?? -1) > -method.margin);

  // With a quarter of the trials on one side the bound can't rule out the margin.
  // Two cases dropping three trials in eight each: a drop of 8 points can't be ruled out.
  const dropped = many(8).map((r) =>
    (r.id === "case-a" || r.id === "case-b") && (r.rep ?? 0) < 3
      ? { ...r, outcome: "fail" as const }
      : r,
  );
  const worse = compareChange(many(8), dropped, "no-worse");
  assert.equal(keeps(worse), false);
  assert.match(
    worse.reasons.at(-1) ?? "",
    /^train: can't rule out a drop of 8\.0 points \(bound −1/,
  );

  // Two trials a case can't show it, even when all pass: the verdict says so.
  const thin = compareChange(many(8), many(2), "no-worse");
  assert.equal(keeps(thin), false);
  assert.match(
    thin.reasons[0] ?? "",
    /^train: too few trials to show no worse; even every trial passing gives −\d+\.\d points, so pool more rounds in each arm$/,
  );
});

test("an arm pools its rounds; edited, mixed, new and errored trials are left out", () => {
  const baseline = [
    ...trials("kept", 2, 2),
    trial("edited", true),
    trial("mixed", true),
    trial("mixed", true, { rep: 1, hash: "another hash" }),
    trial("gone", true),
    trial("errored", true),
  ];
  const candidate = [
    ...trials("kept", 2, 2),
    trial("edited", true, { hash: "an edited case" }),
    trial("mixed", true),
    trial("new", true),
    trial("errored", true, { error: true }),
  ];
  const compared = compareChange(baseline, candidate, "no-worse");
  assert.deepEqual(compared.unpaired, ["edited", "errored", "gone", "mixed", "new"]);
  assert.equal(compared.errored, 1);
  assert.deepEqual(
    compared.splits.map((s) => [s.split, s.cases, s.baseline.cases]),
    [["train", 1, 2]],
  );
  assert.match(
    formatChange(compared),
    /not compared \(new, gone, edited or never finished\): edited/,
  );
});

test("only the splits both arms ran are judged, and with none there's nothing to keep", () => {
  const train = trials("train-case", 4, 4);
  const held = trials("test-case", 4, 4, "replies", "test");
  assert.deepEqual(
    compareChange([...train, ...held], train, "no-worse").splits.map((s) => s.split),
    ["train"],
  );
  assert.deepEqual(compareChange(train, held, "no-worse").reasons, ["no split ran in both arms"]);
});

test("an A/A check judges every split of the trials both ways", () => {
  // Four slots of a case that passes three trials in four: three splits, each both ways.
  const slots = [true, true, true, false].map((pass, rep) => ({
    slot: `round:${rep}`,
    result: trial("flaky", pass, { rep }),
  }));
  assert.deepEqual(noChange(slots), { judged: 6, better: 0, noWorse: 0, guarded: 0 });
  // Three slots: one against two, every way, each both ways.
  assert.equal(noChange(slots.slice(0, 3)).judged, 6);
  assert.throws(() => noChange(slots.slice(0, 1)), /2 to 16 trial slots/);
});

test("usage comes from a JSON body or a stream, and costs what the model's price says", async () => {
  const json = await message("ok").text();
  assert.deepEqual(responseUsage(json), { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
  const stream = await streamed({ text: "ok" }).text();
  assert.deepEqual(responseUsage(stream), { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 });
  const tokens = { input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 100_000 };
  // $4 in, $2 out, $0.20 read, $0.50 written.
  near(cost("claude-opus-5-5", tokens) ?? 0, 6.7);
  near(cost("claude-sonnet-5-5-20261001", tokens) ?? 0, 3.45);
  assert.equal(cost("claude-unknown-1", tokens), null);
});
