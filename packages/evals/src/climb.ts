import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  type Infer,
  isUlid,
  literal,
  number,
  object,
  optional,
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
  cap: positive,
  reps: count,
  cases: record(object({ hash: string, group: text })),
  subset: optional(literal(true)),
});
export type Climb = Infer<typeof climbShape>;

export const roundSplit = union(literal("train"), literal("test"), literal("all"));
export type RoundSplit = Infer<typeof roundSplit>;

const ledgerEntry = object({
  round: refine(string, isUlid, "expected a ULID"),
  label: string,
  split: roundSplit,
  trials: count,
  usd: refine(number, (n) => Number.isFinite(n) && n >= 0, "expected dollars"),
  estimated: optional(literal(true)),
});
export type LedgerEntry = Omit<Infer<typeof ledgerEntry>, "estimated"> & { estimated?: true };

export const firstTrialEstimate = 0.05;

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
    const { estimated, ...booked } = entry.value;
    ledger.push(estimated ? { ...booked, estimated } : booked);
  }
  return { climb: parsed.value, ledger };
}

export function freezeClimb(
  dir: URL,
  climb: string,
  plan: { cap: number; reps: number; cases?: readonly string[] },
  cases: readonly LoadedCase[],
): string | null {
  const file = fileOf(dir, climb, ".json");
  if (existsSync(file)) return `${file.pathname} exists; a climb's plan is frozen once written`;
  const named = plan.cases ? new Set(plan.cases) : null;
  const unknown = [...(named ?? [])].filter((id) => !cases.some((c) => c.case.id === id));
  if (unknown.length) return `no case ${unknown.join(", ")} to freeze`;
  mkdirSync(dir, { recursive: true });
  const frozen: Climb = {
    cap: plan.cap,
    reps: plan.reps,
    cases: Object.fromEntries(
      cases
        .filter((c) => !named || named.has(c.case.id))
        .map((c) => [c.case.id, { hash: caseHash(c), group: evalKinds[c.case.kind] }]),
    ),
    subset: named ? true : undefined,
  };
  writeFileSync(file, `${JSON.stringify(frozen, null, 2)}\n`);
  return null;
}

export const climbCases = (climb: Climb, cases: readonly LoadedCase[]) =>
  climb.subset ? cases.filter((c) => Object.hasOwn(climb.cases, c.case.id)) : cases;

export function unfrozen(climb: Climb, cases: readonly LoadedCase[]): string[] {
  const problems: string[] = [];
  const running = new Set(cases.map((c) => c.case.id));
  for (const loaded of climbCases(climb, cases)) {
    const frozen = climb.cases[loaded.case.id];
    if (!frozen) problems.push(`${loaded.case.id} isn't in the climb's plan`);
    else if (frozen.hash !== caseHash(loaded))
      problems.push(`${loaded.case.id} changed since the plan froze it`);
  }
  for (const id of Object.keys(climb.cases))
    if (!running.has(id)) problems.push(`${id} is in the climb's plan but not in the cases`);
  return problems;
}

const rounds = (ledger: readonly LedgerEntry[]) => [
  ...new Map(ledger.map((e) => [e.round, e])).values(),
];

export const spent = (ledger: readonly LedgerEntry[]) =>
  rounds(ledger).reduce((n, e) => n + e.usd, 0);

export function estimate(ledger: readonly LedgerEntry[], trials: number): number {
  const ended = rounds(ledger).filter((e) => !e.estimated);
  const done = ended.reduce((n, e) => n + e.trials, 0);
  return trials * (done ? ended.reduce((n, e) => n + e.usd, 0) / done : firstTrialEstimate);
}

export function writeLedger(dir: URL, climb: string, entry: LedgerEntry): void {
  appendFileSync(fileOf(dir, climb, ".ledger.jsonl"), `${JSON.stringify(entry)}\n`);
}
