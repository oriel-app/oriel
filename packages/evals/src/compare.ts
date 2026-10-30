// The hillclimb's bookkeeping (SPEC §8): one change per round, compared with
// the baseline round on train and on test. Keep the change only if both
// splits improve beyond noise; otherwise revert it.
import { readFileSync } from "node:fs";
import { type Split, splits } from "./case.ts";
import { type CaseResult, caseResult } from "./runner.ts";
import { formatRate, type Rate, signTest, wilson } from "./stats.ts";

export type SplitComparison = {
  split: Split;
  // Only cases paired across the rounds are compared.
  baseline: Rate;
  candidate: Rate;
  // Cases that went from failing to passing, and back.
  fixed: string[];
  broken: string[];
  p: number;
  improved: boolean;
};

export type Comparison = {
  splits: SplitComparison[];
  // Case IDs only one round has, or whose split or content changed.
  unpaired: string[];
  // Case IDs that errored in either round: an error says nothing about the
  // change, only about the pipeline or the network.
  errored: string[];
  keep: boolean;
};

// `alpha` is the one-sided significance level of the sign test.
export function compareRounds(
  baseline: readonly CaseResult[],
  candidate: readonly CaseResult[],
  alpha = 0.05,
): Comparison {
  const before = new Map(baseline.map((r) => [r.id, r]));
  const after = new Map(candidate.map((r) => [r.id, r]));
  const matched = [...after.values()].flatMap((r) => {
    const b = before.get(r.id);
    return b && b.split === r.split && b.hash === r.hash
      ? [{ id: r.id, split: r.split, was: b, now: r }]
      : [];
  });
  const isPaired = new Set(matched.map((p) => p.id));
  const unpaired = [...new Set([...before.keys(), ...after.keys()])]
    .filter((id) => !isPaired.has(id))
    .sort();
  const broke = (r: CaseResult) => r.outcome === "error";
  const errored = matched
    .filter((p) => broke(p.was) || broke(p.now))
    .map((p) => p.id)
    .sort();
  const pairs = matched.filter((p) => !broke(p.was) && !broke(p.now));
  const passes = (r: CaseResult) => r.outcome === "pass";
  const compared = splits.map((s): SplitComparison => {
    const own = pairs.filter((p) => p.split === s);
    const fixed = own.filter((p) => !passes(p.was) && passes(p.now)).map((p) => p.id);
    const broken = own.filter((p) => passes(p.was) && !passes(p.now)).map((p) => p.id);
    const p = signTest(fixed.length, broken.length);
    return {
      split: s,
      baseline: wilson(own.filter((x) => passes(x.was)).length, own.length),
      candidate: wilson(own.filter((x) => passes(x.now)).length, own.length),
      fixed,
      broken,
      p,
      improved: fixed.length > broken.length && p <= alpha,
    };
  });
  return { splits: compared, unpaired, errored, keep: compared.every((c) => c.improved) };
}

export function formatComparison(comparison: Comparison): string {
  const lines = comparison.splits.map((c) =>
    [
      c.split.padEnd(5),
      `baseline ${formatRate(c.baseline)}`,
      `candidate ${formatRate(c.candidate)}`,
      `fixed ${c.fixed.length}, broken ${c.broken.length}, p=${c.p.toFixed(3)}`,
      c.improved ? "improved" : "within noise",
    ].join("  "),
  );
  if (comparison.unpaired.length)
    lines.push(`not compared (new, gone or edited): ${comparison.unpaired.join(", ")}`);
  if (comparison.errored.length)
    lines.push(`not compared (errored in a round): ${comparison.errored.join(", ")}`);
  const noisy = comparison.splits.filter((c) => !c.improved).map((c) => c.split);
  lines.push(
    comparison.keep
      ? "keep: both splits improved beyond noise"
      : `revert: ${noisy.join(" and ")} did not improve beyond noise`,
  );
  return lines.join("\n");
}

// A round's `results.jsonl`, validated line by line.
export function readResults(round: URL): CaseResult[] {
  const file = new URL("results.jsonl", round);
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const parsed = caseResult(JSON.parse(line));
      if (parsed.ok) return parsed.value;
      const issues = parsed.issues.map((issue) => `${issue.path}: ${issue.message}`);
      throw new Error(`${file.pathname} line ${i + 1}: ${issues.join("; ")}`);
    });
}
