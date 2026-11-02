// The hillclimb's bookkeeping (SPEC §8). `compareChange` is the method the
// hill-climb skill describes: each case runs several times in each arm, a fix
// must be better beyond noise, a trim no worse within a stated margin, and no
// group of cases may get worse. `compareRounds` is the rule before it, one run
// a case and both splits improving; it stays until its tests are retired.
import { readFileSync } from "node:fs";
import { type Split, evalKinds, splits } from "./case.ts";
import { type CaseResult, caseResult } from "./runner.ts";
import {
  differenceLow,
  formatRate,
  percent,
  type Rate,
  signTest,
  stratifiedTest,
  type Tally,
  wilson,
} from "./stats.ts";

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
      if (parsed.ok) {
        const { rep, group, ...result } = parsed.value;
        return { ...result, ...(rep ? { rep } : {}), ...(group === undefined ? {} : { group }) };
      }
      const issues = parsed.issues.map((issue) => `${issue.path}: ${issue.message}`);
      throw new Error(`${file.pathname} line ${i + 1}: ${issues.join("; ")}`);
    });
}

// A fix must be better beyond noise; a trim, which isn't meant to improve
// anything, must be no worse than the baseline within the margin.
export type Mode = "better" | "no-worse";

// The method's settings, stated before any round uses them. `alpha` is the
// one-sided level of the stratified test a fix must pass; `guard` the level
// at which a group counts as worse, looser because a guard should err towards
// revert; `margin` the drop in pass rate a trim may not be shown to exceed,
// at the one-sided 95% bound `z` gives.
export const method = { alpha: 0.05, guard: 0.1, margin: 0.08, z: 1.645 } as const;

export type GroupChange = {
  group: string;
  cases: number;
  baseline: Rate;
  candidate: Rate;
  // The chance of a drop at least this large with no change.
  worse: number;
};

export type SplitChange = {
  split: Split;
  cases: number;
  baseline: Rate;
  candidate: Rate;
  // The chance of a gain at least this large with no change.
  better: number;
  // The lower end of the one-sided bound on candidate minus baseline.
  low: number;
  groups: GroupChange[];
  // Cases whose pass rate moved, as baseline and candidate tallies.
  moved: { id: string; baseline: Tally; candidate: Tally }[];
};

export type Change = {
  mode: Mode;
  splits: SplitChange[];
  // Case IDs only one arm ran, whose split or content changed, or with no
  // finished run in an arm.
  unpaired: string[];
  // Runs that errored, left out of every count: an error says nothing about
  // the change.
  errored: number;
  // Why to revert; empty to keep.
  reasons: string[];
};

export const keeps = (change: Change) => change.reasons.length === 0;

// A case's group: its climb group, or else its eval kind.
const groupOf = (r: CaseResult) =>
  r.group ?? evalKinds[r.kind as keyof typeof evalKinds] ?? `kind ${r.kind}`;

const sum = (tallies: readonly Tally[]): Tally => ({
  passed: tallies.reduce((n, t) => n + t.passed, 0),
  runs: tallies.reduce((n, t) => n + t.runs, 0),
});
const rateOf = (t: Tally) => wilson(t.passed, t.runs);
const gain = (cases: readonly { baseline: Tally; candidate: Tally }[]) =>
  cases.reduce(
    (n, c) => n + c.candidate.passed / c.candidate.runs - c.baseline.passed / c.baseline.runs,
    0,
  );

// Each arm is every run of one state of the agent, from one round or several
// pooled. Only the splits both arms ran are compared, and a case only when
// both arms ran it with the same content and finished a run.
export function compareChange(
  baseline: readonly CaseResult[],
  candidate: readonly CaseResult[],
  mode: Mode,
): Change {
  const tallies = (results: readonly CaseResult[]) => {
    const byId = new Map<string, { first: CaseResult; tally: Tally; mixed: boolean }>();
    for (const r of results) {
      const seen = byId.get(r.id);
      const entry = seen ?? { first: r, tally: { passed: 0, runs: 0 }, mixed: false };
      if (r.hash !== entry.first.hash || r.split !== entry.first.split) entry.mixed = true;
      if (r.outcome !== "error") {
        entry.tally.runs += 1;
        if (r.outcome === "pass") entry.tally.passed += 1;
      }
      byId.set(r.id, entry);
    }
    return byId;
  };
  const before = tallies(baseline);
  const after = tallies(candidate);
  const paired = [...after].flatMap(([id, now]) => {
    const was = before.get(id);
    const same =
      was &&
      !was.mixed &&
      !now.mixed &&
      was.first.hash === now.first.hash &&
      was.first.split === now.first.split;
    if (!same || !was.tally.runs || !now.tally.runs) return [];
    const r = now.first;
    return [{ id, split: r.split, group: groupOf(r), baseline: was.tally, candidate: now.tally }];
  });
  const isPaired = new Set(paired.map((p) => p.id));
  const unpaired = [...new Set([...before.keys(), ...after.keys()])]
    .filter((id) => !isPaired.has(id))
    .sort();
  const errored = [...baseline, ...candidate].filter((r) => r.outcome === "error").length;
  const compared = splits.flatMap((split): SplitChange[] => {
    const own = paired.filter((p) => p.split === split);
    if (!own.length) return [];
    const b = sum(own.map((p) => p.baseline));
    const c = sum(own.map((p) => p.candidate));
    const groups = [...new Set(own.map((p) => p.group))].sort().map((group): GroupChange => {
      const members = own.filter((p) => p.group === group);
      return {
        group,
        cases: members.length,
        baseline: rateOf(sum(members.map((p) => p.baseline))),
        candidate: rateOf(sum(members.map((p) => p.candidate))),
        worse: gain(members) < 0 ? stratifiedTest(members, "worse") : 1,
      };
    });
    return [
      {
        split,
        cases: own.length,
        baseline: rateOf(b),
        candidate: rateOf(c),
        better: gain(own) > 0 ? stratifiedTest(own, "better") : 1,
        low: differenceLow(b, c, method.z),
        groups,
        moved: own
          .filter(
            (p) => p.baseline.passed / p.baseline.runs !== p.candidate.passed / p.candidate.runs,
          )
          .map(({ id, baseline, candidate }) => ({ id, baseline, candidate })),
      },
    ];
  });
  const reasons = compared.length
    ? compared.flatMap((s) => why(s, mode))
    : ["no split ran in both arms"];
  return { mode, splits: compared, unpaired, errored, reasons };
}

function why(s: SplitChange, mode: Mode): string[] {
  const reasons = s.groups
    .filter((g) => g.worse <= method.guard)
    .map((g) => `${s.split}: ${g.group} is worse (p=${g.worse.toFixed(3)})`);
  if (mode === "better" && s.better > method.alpha)
    reasons.push(`${s.split}: not better beyond noise (p=${s.better.toFixed(3)})`);
  if (mode === "no-worse" && s.low <= -method.margin)
    reasons.push(
      `${s.split}: can't rule out a drop of ${size(method.margin)} (bound ${points(s.low)})`,
    );
  return reasons;
}

const size = (difference: number) => `${Math.abs(difference * 100).toFixed(1)} points`;
const points = (difference: number) => `${difference < 0 ? "−" : "+"}${size(difference)}`;
const tally = (t: Tally) => `${t.passed}/${t.runs}`;
const cell = (r: Rate) => `${r.passed}/${r.cases} ${percent(r.rate)}`.padEnd(13);

export function formatChange(change: Change): string {
  const lines: string[] = [];
  for (const s of change.splits) {
    lines.push(`${s.split}: ${s.cases} cases`);
    lines.push(
      `  ${"group".padEnd(24)} ${"baseline".padEnd(13)} ${"candidate".padEnd(13)} p(worse)`,
    );
    for (const g of s.groups)
      lines.push(
        `  ${`${g.group} (${g.cases})`.padEnd(24)} ${cell(g.baseline)} ${cell(g.candidate)} ${
          g.worse < 1 ? g.worse.toFixed(3) : "-"
        }${g.worse <= method.guard ? "  worse" : ""}`,
      );
    lines.push(`  ${"all".padEnd(24)} ${formatRate(s.baseline)}  ${formatRate(s.candidate)}`);
    for (const m of s.moved)
      lines.push(`  moved  ${m.id}: ${tally(m.baseline)} → ${tally(m.candidate)}`);
    lines.push(
      `  better: p=${s.better.toFixed(4)}; candidate − baseline ≥ ${points(s.low)} (one-sided 95%)`,
    );
  }
  if (change.unpaired.length)
    lines.push(`not compared (new, gone, edited or never finished): ${change.unpaired.join(", ")}`);
  if (change.errored) lines.push(`errored runs, left out: ${change.errored}`);
  const rule =
    change.mode === "better"
      ? `better beyond noise at p ≤ ${method.alpha}`
      : `no worse within ${size(method.margin)}`;
  lines.push(
    keeps(change)
      ? `keep: ${rule}, and no group worse at p ≤ ${method.guard}`
      : `revert: ${change.reasons.join("; ")}`,
  );
  return lines.join("\n");
}

// An A/A check: every way to split runs of one unchanged agent into two
// arms of equal size, by run slot (a round and a run within it), each judged
// both ways as if it were a change. A fix kept is a false keep; a trim
// reverted, a false revert; a group flagged worse, a false guard. With an odd
// count of slots one arm gets the extra slot.
export type NoChange = { judged: number; better: number; noWorse: number; guarded: number };

export function noChange(runs: readonly { slot: string; result: CaseResult }[]): NoChange {
  const slots = [...new Set(runs.map((r) => r.slot))];
  if (slots.length < 2 || slots.length > 16)
    throw new Error(`an A/A check needs 2 to 16 run slots, not ${slots.length}`);
  const [first, ...rest] = slots;
  const tally: NoChange = { judged: 0, better: 0, noWorse: 0, guarded: 0 };
  const judge = (baseline: CaseResult[], candidate: CaseResult[]) => {
    const fix = compareChange(baseline, candidate, "better");
    const trim = compareChange(baseline, candidate, "no-worse");
    tally.judged += 1;
    if (keeps(fix)) tally.better += 1;
    if (keeps(trim)) tally.noWorse += 1;
    if (trim.splits.some((s) => s.groups.some((g) => g.worse <= method.guard))) tally.guarded += 1;
  };
  // Subsets holding the first slot, so each split is drawn once.
  const size = Math.ceil(slots.length / 2) - 1;
  const choose = (from: number, picked: string[]) => {
    if (picked.length === size) {
      const chosen = new Set([first, ...picked]);
      const arm = (side: boolean) =>
        runs.filter((r) => chosen.has(r.slot) === side).map((r) => r.result);
      judge(arm(true), arm(false));
      judge(arm(false), arm(true));
      return;
    }
    for (let i = from; i < rest.length; i++) choose(i + 1, [...picked, rest[i] ?? ""]);
  };
  choose(0, []);
  return tally;
}
