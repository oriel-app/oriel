// The night's recording (decision 0061): every eval case once against the
// live model; a case whose draw would fail CI's replay drawn again, up to
// twice; then CI's own replay, strict. scripts/nightly-evals.ts runs it on
// main.
//
// A case keeps its committed cassettes when they still replay: its requests
// didn't change, so tonight's draw would only swap one answer for another
// and grow the repo's history. It is still drawn, and its draw still counts
// in the pass rates. A case is recorded again when a request changed, its
// cassettes are missing, or packages/evals/stale.md names it.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type GraderName, type Split, splits } from "./case.ts";
import { type Command, defaults, type Io, main } from "./cli.ts";
import { readResults } from "./compare.ts";
import { type CaseResult, exitCode, type Failing } from "./runner.ts";

// Draws after the first, for a case whose draw would fail the replay.
const redraws = 2;

export type Night = {
  date: string;
  commit: string;
  // Each split's first draws, which are the agent's real rate.
  firstDraw: Record<Split, { passed: number; of: number }>;
  // Every case's first draw, its last if it was drawn again, and whether
  // tonight recorded its cassettes or kept the committed ones.
  cases: Record<
    string,
    { first: CaseResult["outcome"]; last: CaseResult["outcome"]; draws: number; kept: boolean }
  >;
  usd: number;
  replay: "pass" | "fail";
};

// What the night reads and writes. The script passes the repo's; tests pass
// their own, with a fake network.
export type NightIo = Io & {
  stale: URL;
  // The last night's summary, which tonight replaces.
  nightly: URL;
  // The .env holding the model key.
  env: string;
  date: string;
  commit: string;
};

// What leaves a case's cassettes unfit for CI: a draw that saved none, or
// one CI's replay would fail, as CI decides it. A judged case's verdict never
// fails it, so it is never drawn again for that.
const breaksReplay = (r: CaseResult, failing: Failing) =>
  r.error !== null || r.unrecorded !== null || exitCode([r], "replay", failing) === 1;

// Each case's file name and `failing` grader, by its ID.
function caseFiles(cases: URL): Map<string, { file: string; failing?: GraderName }> {
  const found = new Map<string, { file: string; failing?: GraderName }>();
  for (const file of readdirSync(cases).filter((name) => name.endsWith(".json"))) {
    const parsed = JSON.parse(readFileSync(new URL(file, cases), "utf8")) as {
      id: string;
      failing?: { grader: GraderName };
    };
    found.set(parsed.id, {
      file,
      ...(parsed.failing ? { failing: parsed.failing.grader } : {}),
    });
  }
  return found;
}

// The case IDs stale.md names, as words of its text.
function namedStale(stale: URL): Set<string> {
  if (!existsSync(stale)) return new Set();
  return new Set(readFileSync(stale, "utf8").split(/[^A-Za-z0-9_-]+/));
}

// Runs one round into its own directory under `step` and reads it back.
async function round(
  command: Command,
  io: Io,
  step: URL,
): Promise<{ code: number; results: CaseResult[]; usd: number }> {
  mkdirSync(step, { recursive: true });
  const code = await main(command, { ...io, rounds: step });
  const [id] = readdirSync(step);
  if (id === undefined) return { code, results: [], usd: 0 };
  const dir = new URL(`${id}/`, step);
  const summary = JSON.parse(readFileSync(new URL("summary.json", dir), "utf8")) as {
    spend?: { usd: number };
  };
  return { code, results: readResults(dir), usd: summary.spend?.usd ?? 0 };
}

const rate = ({ passed, of }: { passed: number; of: number }) =>
  `${passed}/${of}${of ? ` (${Math.round((100 * passed) / of)}%)` : ""}`;

function report(tonight: Night, before: Night | null, notes: readonly string[]): string {
  const lines = [
    `## The night's recording, ${tonight.date}`,
    "",
    `main at \`${tonight.commit.slice(0, 8)}\``,
    "",
  ];
  lines.push("| split | first draws tonight | last night |", "| --- | --- | --- |");
  for (const s of splits)
    lines.push(
      `| ${s} | ${rate(tonight.firstDraw[s])} | ${before ? rate(before.firstDraw[s]) : "none"} |`,
    );
  const ids = Object.keys(tonight.cases).sort();
  const newly = ids.filter(
    (id) => tonight.cases[id]?.first !== "pass" && before?.cases[id]?.first === "pass",
  );
  const redrawn = ids.filter((id) => (tonight.cases[id]?.draws ?? 1) > 1);
  const added = before ? ids.filter((id) => before.cases[id] === undefined) : [];
  const kept = ids.filter((id) => tonight.cases[id]?.kept);
  // A kept case's failing draw isn't in its cassettes, so the replay still
  // passes it; the line says so.
  const failed = (id: string) =>
    `\`${id}\` (${tonight.cases[id]?.first}${tonight.cases[id]?.kept ? ", cassettes kept" : ""})`;
  lines.push("", `**Newly failing:** ${newly.length ? newly.map(failed).join(", ") : "none"}`);
  lines.push(
    `**Drawn again:** ${redrawn.length ? redrawn.map((id) => `\`${id}\` ${tonight.cases[id]?.draws} draws, last ${tonight.cases[id]?.last}`).join("; ") : "none"}`,
  );
  if (added.length) lines.push(`**New cases:** ${added.map((id) => `\`${id}\``).join(", ")}`);
  lines.push(
    `**Recorded:** ${ids.length - kept.length} of ${ids.length} cases; the rest kept their cassettes, whose requests didn't change`,
  );
  lines.push(
    `**Replay:** ${tonight.replay === "pass" ? "passes" : "FAILS: a case failed or wasn't recorded on every draw; the hub decides"}`,
  );
  lines.push(`**Spend:** $${tonight.usd.toFixed(2)}`);
  for (const note of notes) lines.push(`- ${note}`);
  return `${lines.join("\n")}\n`;
}

// Runs the night, writes `io.nightly`, and returns the summary to paste into
// the PR, with 0 when the replay passes and 1 when it doesn't.
export async function recordNight(io: NightIo): Promise<{ code: number; text: string }> {
  const before = existsSync(io.nightly)
    ? (JSON.parse(readFileSync(io.nightly, "utf8")) as Night)
    : null;
  const files = caseFiles(io.cases);
  const failing: Failing = new Map(
    [...files].flatMap(([id, f]) => (f.failing ? [[id, f.failing] as const] : [])),
  );
  mkdirSync(io.rounds, { recursive: true });
  const night = pathToFileURL(`${mkdtempSync(join(fileURLToPath(io.rounds), "nightly-"))}/`);
  const replay: Command = { command: "replay", model: defaults.model, judge: defaults.judge };
  const live: Command = {
    command: "live",
    model: defaults.model,
    judge: defaults.judge,
    baseline: null,
    env: io.env,
  };
  const notes: string[] = [];

  // Which committed cassettes still replay, offline, with no case let off
  // as stale: a request that changed has none.
  const named = namedStale(io.stale);
  const check = await round(replay, { ...io, stale: undefined }, new URL("kept/", night));
  const kept = new Set(
    check.results.filter((r) => r.error === null && !named.has(r.id)).map((r) => r.id),
  );

  const first = await round(live, { ...io, keep: kept }, new URL("first/", night));
  if (!first.results.length) return { code: 1, text: "the live round ran no case\n" };
  const last = new Map(first.results.map((r) => [r.id, r]));
  const draws = new Map(first.results.map((r) => [r.id, 1]));
  let usd = first.usd + check.usd;
  for (let n = 1; n <= redraws; n++) {
    // A kept case's cassettes replay already; drawing it again records nothing.
    const again = [...last.values()]
      .filter((r) => !kept.has(r.id) && breaksReplay(r, failing))
      .map((r) => r.id);
    if (!again.length) break;
    // Only those cases, from a directory of their own; goldens and
    // cassettes are the repo's.
    const only = mkdtempSync(join(tmpdir(), "oriel-nightly-cases-"));
    try {
      for (const id of again) {
        const file = files.get(id)?.file;
        if (file) copyFileSync(new URL(file, io.cases), join(only, file));
      }
      const drawn = await round(
        live,
        { ...io, cases: pathToFileURL(`${only}/`) },
        new URL(`again-${n}/`, night),
      );
      usd += drawn.usd;
      for (const r of drawn.results) {
        last.set(r.id, r);
        draws.set(r.id, (draws.get(r.id) ?? 1) + 1);
      }
    } finally {
      rmSync(only, { recursive: true, force: true });
    }
  }
  // A case whose last draw saved no cassettes keeps its old ones, which
  // may be stale, so stale.md stays and the night fails.
  const unrecorded = [...last.values()]
    .filter((r) => !kept.has(r.id) && (r.error !== null || r.unrecorded !== null))
    .map((r) => r.id);
  if (unrecorded.length)
    notes.push(
      `not recorded on any draw, so packages/evals/stale.md stays: ${unrecorded.join(", ")}`,
    );
  else if (existsSync(io.stale)) {
    rmSync(io.stale);
    notes.push("packages/evals/stale.md is removed: every case is recorded again or kept.");
  }
  const strict = await round(
    replay,
    unrecorded.length ? io : { ...io, stale: undefined },
    new URL("replay/", night),
  );
  const firstDraw = Object.fromEntries(
    splits.map((s) => {
      const own = first.results.filter((r) => r.split === s);
      return [s, { passed: own.filter((r) => r.outcome === "pass").length, of: own.length }];
    }),
  ) as Night["firstDraw"];
  const tonight: Night = {
    date: io.date,
    commit: io.commit,
    firstDraw,
    cases: Object.fromEntries(
      first.results.map((r) => [
        r.id,
        {
          first: r.outcome,
          last: last.get(r.id)?.outcome ?? r.outcome,
          draws: draws.get(r.id) ?? 1,
          kept: kept.has(r.id),
        },
      ]),
    ),
    usd,
    replay: strict.code === 0 && !unrecorded.length ? "pass" : "fail",
  };
  writeFileSync(io.nightly, `${JSON.stringify(tonight, null, 2)}\n`);
  const text = report(tonight, before, notes);
  writeFileSync(new URL("summary.md", night), text);
  return { code: tonight.replay === "pass" ? 0 : 1, text };
}
