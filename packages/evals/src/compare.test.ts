import assert from "node:assert/strict";
import { test } from "node:test";
import type { Split } from "./case.ts";
import { compareChange, formatChange, keeps } from "./compare.ts";
import type { CaseResult } from "./runner.ts";
import { signTest, wilson } from "./stats.ts";

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} is not ${expected}`);

test("the Wilson interval matches its textbook values", () => {
  const half = wilson(5, 10);
  near(half.low, 0.2366);
  near(half.high, 0.7634);
  const all = wilson(10, 10);
  near(all.low, 0.7225);
  assert.equal(all.high, 1);
  assert.deepEqual(wilson(0, 0), { passed: 0, cases: 0, rate: 0, low: 0, high: 1 });
});

test("the sign test gives the binomial tail, and stays finite for large counts", () => {
  near(signTest(5, 0), 1 / 32);
  near(signTest(3, 0), 1 / 8);
  near(signTest(6, 1), 8 / 128);
  assert.equal(signTest(0, 0), 1);
  assert.equal(signTest(0, 4), 1);
  const large = signTest(1100, 900);
  assert.ok(large > 0 && large < 1e-5, String(large));
});

const result = (
  id: string,
  split: Split,
  pass: boolean,
  outcome: CaseResult["outcome"] = pass ? "pass" : "fail",
): CaseResult => ({
  id,
  hash: `hash of ${id}`,
  split,
  kind: 2,
  outcome,
  grades: [],
  error: outcome === "error" ? "judge: HTTP 529: overloaded" : null,
  unrecorded: null,
  ms: 0,
});

// One round: each split's cases, passing or not, in order.
const round = (train: boolean[], test: boolean[]) => [
  ...train.map((pass, i) => result(`train-${i}`, "train", pass)),
  ...test.map((pass, i) => result(`test-${i}`, "test", pass)),
];

const no = (n: number) => Array.from({ length: n }, () => false);
const yes = (n: number) => Array.from({ length: n }, () => true);

// With one run a case, a fix's test is the sign test over the cases that
// moved (decision 0029 replaced the rule that both splits must improve).
test("with one run a case, a fix is kept only when its split improves beyond noise", () => {
  const baseline = round(no(8), []);
  const kept = compareChange(baseline, round([...yes(5), ...no(3)], []), "better");
  assert.ok(keeps(kept));
  assert.deepEqual(
    kept.splits.map((s) => [s.split, s.moved.length]),
    [["train", 5]],
  );
  assert.match(formatChange(kept), /\nkeep: better beyond noise at p ≤ 0\.05/);

  // Three fixed cases could be a coin flip: p = 1/8.
  const noisy = compareChange(baseline, round([...yes(3), ...no(5)], []), "better");
  assert.equal(keeps(noisy), false);
  assert.match(formatChange(noisy), /\nrevert: train: not better beyond noise \(p=0\.125\)$/);
});

test("a change that fixes as many cases as it breaks is noise", () => {
  const baseline = round([true, true, false, false, ...no(4)], []);
  const traded = compareChange(baseline, round([false, false, true, true, ...no(4)], []), "better");
  const [train] = traded.splits;
  assert.deepEqual(
    train?.moved.map((m) => m.id),
    ["train-0", "train-1", "train-2", "train-3"],
  );
  assert.equal(keeps(traded), false);
});

test("only cases in both rounds, in the same split and unedited, are compared", () => {
  const baseline = [...round(no(6), no(6)), result("retired", "train", true)];
  const candidate = [
    ...round(yes(6), yes(6)).filter((r) => r.id !== "test-4" && r.id !== "train-5"),
    result("test-4", "train", true),
    { ...result("train-5", "train", true), hash: "an edited case" },
    result("brand-new", "test", true),
  ];
  const compared = compareChange(baseline, candidate, "better");
  assert.deepEqual(compared.unpaired, ["brand-new", "retired", "test-4", "train-5"]);
  assert.deepEqual(
    compared.splits.map((s) => [s.split, s.baseline.cases, s.candidate.passed]),
    [
      ["train", 5, 5],
      ["test", 5, 5],
    ],
  );
  assert.ok(keeps(compared));
  assert.match(
    formatChange(compared),
    /not compared \(new, gone, edited or never finished\): brand-new, retired, test-4, train-5/,
  );
});

test("a run that errored is left out, so an outage can't look like a fix", () => {
  // The baseline lost five train cases to judge outages; the candidate didn't.
  const baseline = [
    ...no(5).map((_, i) => result(`train-${i}`, "train", false, "error")),
    ...round([], no(5)),
  ];
  const outage = compareChange(baseline, round(yes(5), yes(5)), "better");
  assert.equal(outage.errored, 5);
  assert.deepEqual(outage.unpaired, ["train-0", "train-1", "train-2", "train-3", "train-4"]);
  assert.deepEqual(
    outage.splits.map((s) => s.split),
    ["test"],
  );
  assert.match(formatChange(outage), /errored runs, left out: 5\n/);
});
