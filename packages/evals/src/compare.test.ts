import assert from "node:assert/strict";
import { test } from "node:test";
import type { Split } from "./case.ts";
import { compareRounds, formatComparison } from "./compare.ts";
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
  ms: 0,
});

// One round: each split's cases, passing or not, in order.
const round = (train: boolean[], test: boolean[]) => [
  ...train.map((pass, i) => result(`train-${i}`, "train", pass)),
  ...test.map((pass, i) => result(`test-${i}`, "test", pass)),
];

const no = (n: number) => Array.from({ length: n }, () => false);
const yes = (n: number) => Array.from({ length: n }, () => true);

test("keep a change only when both splits improve beyond noise", () => {
  const baseline = round(no(8), no(8));
  const kept = compareRounds(baseline, round([...yes(5), ...no(3)], [...yes(6), ...no(2)]));
  assert.equal(kept.keep, true);
  assert.deepEqual(
    kept.splits.map((s) => [s.split, s.fixed.length, s.broken.length, s.improved]),
    [
      ["train", 5, 0, true],
      ["test", 6, 0, true],
    ],
  );
  assert.match(formatComparison(kept), /\nkeep: both splits improved beyond noise$/);

  // Three fixed cases could be a coin flip: p = 1/8.
  const noisy = compareRounds(baseline, round([...yes(5), ...no(3)], [...yes(3), ...no(5)]));
  assert.equal(noisy.keep, false);
  assert.match(formatComparison(noisy), /\nrevert: test did not improve beyond noise$/);
});

test("a change that fixes as many cases as it breaks is noise", () => {
  const baseline = round(no(6), [true, true, false, false]);
  const traded = compareRounds(baseline, round(yes(6), [false, false, true, true]));
  const [train, test] = traded.splits;
  assert.equal(train?.improved, true);
  assert.deepEqual(
    [test?.fixed, test?.broken],
    [
      ["test-2", "test-3"],
      ["test-0", "test-1"],
    ],
  );
  assert.equal(test?.improved, false);
  assert.equal(traded.keep, false);
});

test("only cases in both rounds, in the same split and unedited, are compared", () => {
  const baseline = [...round(no(6), no(6)), result("retired", "train", true)];
  const candidate = [
    ...round(yes(6), yes(6)).filter((r) => r.id !== "test-4" && r.id !== "train-5"),
    result("test-4", "train", true),
    { ...result("train-5", "train", true), hash: "an edited case" },
    result("brand-new", "test", true),
  ];
  const compared = compareRounds(baseline, candidate);
  assert.deepEqual(compared.unpaired, ["brand-new", "retired", "test-4", "train-5"]);
  assert.deepEqual(
    compared.splits.map((s) => [s.split, s.baseline.cases, s.candidate.passed]),
    [
      ["train", 5, 5],
      ["test", 5, 5],
    ],
  );
  assert.equal(compared.keep, true);
  assert.match(
    formatComparison(compared),
    /not compared \(new, gone or edited\): brand-new, retired, test-4, train-5/,
  );
});

test("a case that errored in either round is left out, so an outage can't look like a fix", () => {
  // The baseline lost five train cases to judge outages; the candidate didn't.
  const baseline = [
    ...no(5).map((_, i) => result(`train-${i}`, "train", false, "error")),
    ...round([], no(5)),
  ];
  const outage = compareRounds(baseline, round(yes(5), yes(5)));
  assert.deepEqual(outage.errored, ["train-0", "train-1", "train-2", "train-3", "train-4"]);
  assert.deepEqual(outage.splits[0]?.baseline.cases, 0);
  assert.equal(outage.keep, false);
  assert.match(
    formatComparison(outage),
    /not compared \(errored in a round\): train-0, train-1, train-2, train-3, train-4\nrevert: train did not improve/,
  );
});
