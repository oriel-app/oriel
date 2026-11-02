// The hillclimb's bookkeeping (SPEC §8, decision 0030), as the hill-climb
// skill describes it: each case runs several times in each arm, a fix must be
// better beyond noise, a trim no worse within a stated margin, and no group of
// cases may get worse.
import { readFileSync } from "node:fs";
import { type Split, evalKinds, splits } from "./case.ts";
import { type CaseResult, caseResult } from "./runner.ts";
import {
  differenceLow,
  formatRate,
  percent,
  type Rate,
  stratifiedTest,
  type Tally,
  wilson,
} from "./stats.ts";

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
// at the one-sided 95% bound, stratified by case, that `z` gives.
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
  // The lower end of the one-sided bound on candidate minus baseline,
  // stratified by case, and what it would be if every candidate trial passed:
  // when that can't clear the margin, the arms are too small to show a trim
  // no worse, whatever it does.
  low: number;
  best: number;
  groups: GroupChange[];
  // Cases whose pass rate moved, as baseline and candidate tallies.
  moved: { id: string; baseline: Tally; candidate: Tally }[];
};

export type Change = {
  mode: Mode;
  splits: SplitChange[];
  // Case IDs only one arm ran, whose split or content changed, or with no
  // finished trial in an arm.
  unpaired: string[];
  // Trials that errored, left out of every count: an error says nothing about
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
  trials: tallies.reduce((n, t) => n + t.trials, 0),
});
const rateOf = (t: Tally) => wilson(t.passed, t.trials);
const gain = (cases: readonly { baseline: Tally; candidate: Tally }[]) =>
  cases.reduce(
    (n, c) => n + c.candidate.passed / c.candidate.trials - c.baseline.passed / c.baseline.trials,
    0,
  );

// Each arm is every trial of one state of the agent, from one round or several
// pooled. Only the splits both arms ran are compared, and a case only when
// both arms ran it with the same content and finished a trial.
export function compareChange(
  baseline: readonly CaseResult[],
  candidate: readonly CaseResult[],
  mode: Mode,
): Change {
  const tallies = (results: readonly CaseResult[]) => {
    const byId = new Map<string, { first: CaseResult; tally: Tally; mixed: boolean }>();
    for (const r of results) {
      const seen = byId.get(r.id);
      const entry = seen ?? { first: r, tally: { passed: 0, trials: 0 }, mixed: false };
      if (r.hash !== entry.first.hash || r.split !== entry.first.split) entry.mixed = true;
      if (r.outcome !== "error") {
        entry.tally.trials += 1;
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
    if (!same || !was.tally.trials || !now.tally.trials) return [];
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
        low: differenceLow(own, method.z),
        best: differenceLow(
          own.map((p) => ({
            baseline: p.baseline,
            candidate: { passed: p.candidate.trials, trials: p.candidate.trials },
          })),
          method.z,
        ),
        groups,
        moved: own
          .filter(
            (p) =>
              p.baseline.passed / p.baseline.trials !== p.candidate.passed / p.candidate.trials,
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
  if (mode === "no-worse" && s.best <= -method.margin)
    reasons.push(
      `${s.split}: too few trials to show no worse; even every trial passing gives ${points(s.best)}, so pool more rounds in each arm`,
    );
  else if (mode === "no-worse" && s.low <= -method.margin)
    reasons.push(
      `${s.split}: can't rule out a drop of ${size(method.margin)} (bound ${points(s.low)})`,
    );
  return reasons;
}

const size = (difference: number) => `${Math.abs(difference * 100).toFixed(1)} points`;
const points = (difference: number) => `${difference < 0 ? "−" : "+"}${size(difference)}`;
const tally = (t: Tally) => `${t.passed}/${t.trials}`;
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
  if (change.errored) lines.push(`errored trials, left out: ${change.errored}`);
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

// An A/A check: every way to split trials of one unchanged agent into two
// arms as equal as can be, by trial slot (a round and a trial within it), each judged
// both ways as if it were a change. A fix kept is a false keep; a trim
// reverted, a false revert; a group flagged worse, a false guard.
export type NoChange = { judged: number; better: number; noWorse: number; guarded: number };

export function noChange(trials: readonly { slot: string; result: CaseResult }[]): NoChange {
  const slots = [...new Set(trials.map((r) => r.slot))];
  if (slots.length < 2 || slots.length > 16)
    throw new Error(`an A/A check needs 2 to 16 trial slots, not ${slots.length}`);
  // With an even count, subsets holding the first slot, so each split is
  // drawn once; with an odd count, every subset of the smaller size.
  const even = slots.length % 2 === 0;
  const [first, ...others] = slots;
  const rest = even ? others : slots;
  const tally: NoChange = { judged: 0, better: 0, noWorse: 0, guarded: 0 };
  const judge = (baseline: CaseResult[], candidate: CaseResult[]) => {
    const fix = compareChange(baseline, candidate, "better");
    const trim = compareChange(baseline, candidate, "no-worse");
    tally.judged += 1;
    if (keeps(fix)) tally.better += 1;
    if (keeps(trim)) tally.noWorse += 1;
    if (trim.splits.some((s) => s.groups.some((g) => g.worse <= method.guard))) tally.guarded += 1;
  };
  const size = even ? slots.length / 2 - 1 : (slots.length - 1) / 2;
  const choose = (from: number, picked: string[]) => {
    if (picked.length === size) {
      const chosen = new Set(even ? [first, ...picked] : picked);
      const arm = (side: boolean) =>
        trials.filter((r) => chosen.has(r.slot) === side).map((r) => r.result);
      judge(arm(true), arm(false));
      judge(arm(false), arm(true));
      return;
    }
    for (let i = from; i < rest.length; i++) choose(i + 1, [...picked, rest[i] ?? ""]);
  };
  choose(0, []);
  return tally;
}
