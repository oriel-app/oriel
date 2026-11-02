// A climb: a hill-climb's pre-registered plan, as the CLI enforces it. Its
// file, `climbs/<name>.json`, freezes the cases (each by its content hash,
// with the group a comparison guards it in), the runs a case each round, and
// a cap on what its rounds may spend. Its ledger, `climbs/<name>.ledger.jsonl`,
// has one line per round with what it cost. Both are committed: the plan
// before the first round, the ledger as it grows. The plan's prose (the
// changes to try, in order, and any later change to the plan, with why) is
// `climbs/<name>.md`.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  type Infer,
  isUlid,
  literal,
  number,
  object,
  record,
  refine,
  string,
  union,
} from "@oriel/core";
import { evalKinds, type LoadedCase } from "./case.ts";
import { caseHash } from "./runner.ts";

const name = refine(
  string,
  (n) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(n),
  "expected a kebab-case name",
);
const positive = refine(number, (n) => Number.isFinite(n) && n > 0, "expected a positive number");
const count = refine(
  number,
  (n) => Number.isInteger(n) && n >= 1,
  "expected a whole number of 1 or more",
);
const text = refine(string, (value) => value.trim() !== "", "expected non-empty text");

export const isClimbName = (value: string) => name(value).ok;

const climbShape = object({
  // Dollars of live model calls, across every round.
  cap: positive,
  reps: count,
  cases: record(object({ hash: string, group: text })),
});
export type Climb = Infer<typeof climbShape>;

export const roundSplit = union(literal("train"), literal("test"), literal("all"));
export type RoundSplit = Infer<typeof roundSplit>;

const ledgerEntry = object({
  round: refine(string, isUlid, "expected a ULID"),
  label: string,
  split: roundSplit,
  runs: count,
  usd: refine(number, (n) => Number.isFinite(n) && n >= 0, "expected dollars"),
});
export type LedgerEntry = Infer<typeof ledgerEntry>;

// What a round costs before any has run: on the high side, so the first
// round can't overshoot by much.
export const firstRunEstimate = 0.05;

const fileOf = (dir: URL, climb: string, suffix: string) => new URL(`${climb}${suffix}`, dir);

export function loadClimb(
  dir: URL,
  climb: string,
): { climb: Climb; ledger: LedgerEntry[] } | { problem: string } {
  const file = fileOf(dir, climb, ".json");
  if (!existsSync(file)) return { problem: `no climb at ${file.pathname}; freeze one first` };
  const parsed = climbShape(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.ok)
    return {
      problem: `${file.pathname}: ${parsed.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    };
  const ledgerFile = fileOf(dir, climb, ".ledger.jsonl");
  const lines = existsSync(ledgerFile) ? readFileSync(ledgerFile, "utf8").split("\n") : [];
  const ledger: LedgerEntry[] = [];
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    const entry = ledgerEntry(JSON.parse(line));
    if (!entry.ok) return { problem: `${ledgerFile.pathname} line ${i + 1} is not a ledger entry` };
    ledger.push(entry.value);
  }
  return { climb: parsed.value, ledger };
}

// A new climb over the cases as they are now, each in the group of its eval
// kind until the plan says otherwise. It never overwrites one.
export function freezeClimb(
  dir: URL,
  climb: string,
  plan: { cap: number; reps: number },
  cases: readonly LoadedCase[],
): string | null {
  const file = fileOf(dir, climb, ".json");
  if (existsSync(file)) return `${file.pathname} exists; a climb's plan is frozen once written`;
  const frozen: Climb = {
    cap: plan.cap,
    reps: plan.reps,
    cases: Object.fromEntries(
      cases.map((c) => [c.case.id, { hash: caseHash(c), group: evalKinds[c.case.kind] }]),
    ),
  };
  writeFileSync(file, `${JSON.stringify(frozen, null, 2)}\n`);
  return null;
}

// What keeps a round from running: a case added, removed or edited since the
// plan froze it.
export function unfrozen(climb: Climb, cases: readonly LoadedCase[]): string[] {
  const problems: string[] = [];
  const running = new Set(cases.map((c) => c.case.id));
  for (const loaded of cases) {
    const frozen = climb.cases[loaded.case.id];
    if (!frozen) problems.push(`${loaded.case.id} isn't in the climb's plan`);
    else if (frozen.hash !== caseHash(loaded))
      problems.push(`${loaded.case.id} changed since the plan froze it`);
  }
  for (const id of Object.keys(climb.cases))
    if (!running.has(id)) problems.push(`${id} is in the climb's plan but not in the cases`);
  return problems;
}

export const spent = (ledger: readonly LedgerEntry[]) => ledger.reduce((n, e) => n + e.usd, 0);

// A round's cost before it runs: its runs at the ledger's mean cost a run.
export function estimate(ledger: readonly LedgerEntry[], runs: number): number {
  const done = ledger.reduce((n, e) => n + e.runs, 0);
  return runs * (done ? spent(ledger) / done : firstRunEstimate);
}

export function writeLedger(dir: URL, climb: string, entry: LedgerEntry): void {
  appendFileSync(fileOf(dir, climb, ".ledger.jsonl"), `${JSON.stringify(entry)}\n`);
}
