import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { type TestContext, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ulid } from "@oriel/core";
import type { Fetch } from "./anthropic.ts";
import { firstRunEstimate } from "./climb.ts";
import { defaults, type Io, main, parseCommand, usage } from "./cli.ts";
import { readResults } from "./compare.ts";
import { streamed, tempDir } from "./testing.ts";

const a = ulid(Date.UTC(2026, 9, 28), new Uint8Array(10));
const b = ulid(Date.UTC(2026, 9, 29), new Uint8Array(10));
const live = { command: "live", model: defaults.model, judge: defaults.judge, baseline: null };

test("a climb's round names the climb, and may name a split and a label", () => {
  assert.deepEqual(parseCommand(["--climb", "oa-144"]), { ...live, climb: "oa-144" });
  assert.deepEqual(
    parseCommand(["--climb", "oa-144", "--split", "test", "--label", "final", "--env", "/x/.env"]),
    { ...live, climb: "oa-144", split: "test", label: "final", env: "/x/.env" },
  );
  for (const args of [
    ["--split", "train"],
    ["--label", "no climb"],
    ["--climb", "Not A Name"],
    ["--climb", "oa-144", "--split", "both"],
    ["--climb", "oa-144", "--label", " "],
    ["--climb", "oa-144", "--trim"],
    ["--climb", "oa-144", "--reps", "4"],
    ["replay", "--climb", "oa-144"],
  ])
    assert.deepEqual(parseCommand(args), { error: usage }, args.join(" "));
});

test("compare pools rounds with + and takes --trim; aa takes rounds; freeze takes a plan", () => {
  assert.deepEqual(parseCommand(["compare", `${a}+${b}`, b, "--trim"]), {
    command: "compare",
    baseline: `${a}+${b}`,
    candidate: b,
    trim: true,
  });
  assert.deepEqual(parseCommand(["aa", `${a}+${b}`]), { command: "aa", rounds: `${a}+${b}` });
  assert.deepEqual(parseCommand(["freeze", "oa-144", "--cap", "30", "--reps", "4"]), {
    command: "freeze",
    climb: "oa-144",
    cap: 30,
    reps: 4,
  });
  for (const args of [
    ["compare", `${a}+`, b],
    ["compare", a, b, "--climb", "oa-144"],
    ["aa", a, b],
    ["aa", a, "--trim"],
    ["freeze", "oa-144", "--cap", "30"],
    ["freeze", "oa-144", "--cap", "-3", "--reps", "4"],
    ["freeze", "oa-144", "--cap", "30", "--reps", "0"],
    ["freeze", "oa-144", "--cap", "30", "--reps", "4", "--split", "train"],
  ])
    assert.deepEqual(parseCommand(args), { error: usage }, args.join(" "));
});

const realDir = (t: TestContext) => pathToFileURL(`${realpathSync(fileURLToPath(tempDir(t)))}/`);

// Two cases graded without a judge, one in each split.
function writeCases(dir: URL, prompt = "How do I undo a change here?"): URL {
  const cases = new URL("cases/", dir);
  mkdirSync(cases, { recursive: true });
  for (const split of ["train", "test"])
    writeFileSync(
      new URL(`revert-${split}.json`, cases),
      JSON.stringify({
        id: `revert-${split}`,
        split,
        kind: 2,
        region: "checkout-epic",
        prompt,
        expect: [{ grader: "mentions", text: ["Revert"] }],
      }),
    );
  return cases;
}

function harness(t: TestContext) {
  const dir = realDir(t);
  writeFileSync(new URL(".env", dir), "ANTHROPIC_API_KEY=sk-ant-fake-0123456789abcdef\n");
  mkdirSync(new URL("climbs/", dir));
  let calls = 0;
  const network: Fetch = async () => {
    calls += 1;
    return streamed({ text: "Approve it, then Revert it from the thread." });
  };
  const lines: string[] = [];
  let now = Date.UTC(2026, 10, 1);
  const io: Io = {
    cases: writeCases(dir),
    climbs: new URL("climbs/", dir),
    cassettes: new URL("cassettes/", dir),
    rounds: new URL("rounds/", dir),
    envFile: new URL(".env", dir),
    network,
    now: () => (now += 1000),
    clock: () => 0,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  const run = async (...args: string[]) => {
    lines.length = 0;
    const command = parseCommand(args);
    if ("error" in command) assert.fail(command.error);
    return main(command, io);
  };
  return { dir, io, lines, run, calls: () => calls };
}

const ledger = (io: Io, climb: string) =>
  readFileSync(new URL(`${climb}.ledger.jsonl`, io.climbs), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { round: string; split: string; runs: number; usd: number });

test("a climb's round runs train alone, each case its runs, and books what it spent", async (t) => {
  const { io, lines, run } = harness(t);
  assert.equal(await run("freeze", "demo", "--cap", "5", "--reps", "3"), 0, lines.join("\n"));
  const plan = JSON.parse(readFileSync(new URL("demo.json", io.climbs), "utf8"));
  assert.deepEqual(Object.keys(plan), ["cap", "reps", "cases"]);
  assert.deepEqual(Object.keys(plan.cases), ["revert-test", "revert-train"]);
  assert.equal(plan.cases["revert-train"].group, "change-set completeness");
  assert.equal(await run("freeze", "demo", "--cap", "9", "--reps", "1"), 1);
  assert.match(lines.join("\n"), /a climb's plan is frozen once written/);

  assert.equal(await run("--climb", "demo", "--label", "baseline"), 0, lines.join("\n"));
  const [entry] = ledger(io, "demo");
  assert.ok(entry);
  assert.deepEqual([entry.split, entry.runs], ["train", 3]);
  assert.ok(entry.usd > 0);
  const results = readResults(new URL(`${entry.round}/`, io.rounds));
  assert.deepEqual(
    results.map((r) => [r.id, r.rep ?? 0, r.group]),
    [
      ["revert-train", 0, "change-set completeness"],
      ["revert-train", 1, "change-set completeness"],
      ["revert-train", 2, "change-set completeness"],
    ],
  );
  assert.deepEqual(readdirSync(new URL(`${entry.round}/transcripts/`, io.rounds)).sort(), [
    "revert-train.json",
    "revert-train.rep1.json",
    "revert-train.rep2.json",
  ]);
  // Only the first run records: one exchange, one cassette.
  const cassettes = readdirSync(io.cassettes, { recursive: true }).filter((p) =>
    String(p).endsWith(".json"),
  );
  assert.equal(cassettes.length, 1);
  assert.match(lines.join("\n"), /^3 runs a case; each split counts runs$/m);
  assert.match(lines.join("\n"), /^spent \$0\.00; climb demo has spent \$0\.00 of \$5\.00$/m);

  assert.equal(await run("--climb", "demo", "--split", "all"), 0, lines.join("\n"));
  assert.deepEqual(
    ledger(io, "demo").map((e) => [e.split, e.runs]),
    [
      ["train", 3],
      ["all", 6],
    ],
  );
  // Every case's first run, then every case's second: an outage in a burst
  // costs many cases a run each, not one case all of them.
  const all = ledger(io, "demo")[1];
  assert.ok(all);
  assert.deepEqual(
    readResults(new URL(`${all.round}/`, io.rounds)).map((r) => `${r.id}.${r.rep ?? 0}`),
    [
      "revert-test.0",
      "revert-train.0",
      "revert-test.1",
      "revert-train.1",
      "revert-test.2",
      "revert-train.2",
    ],
  );
});

test("a round that would pass the cap is refused before any model call", async (t) => {
  const { io, lines, run, calls } = harness(t);
  await run("freeze", "tight", "--cap", "0.2", "--reps", "2");
  // No ledger yet: two runs at the first estimate.
  assert.ok(2 * firstRunEstimate <= 0.2);
  assert.equal(await run("--climb", "tight"), 0, lines.join("\n"));
  const made = calls();
  writeFileSync(
    new URL("tight.ledger.jsonl", io.climbs),
    `${JSON.stringify({ round: a, label: "", split: "train", runs: 2, usd: 0.19 })}\n`,
  );
  assert.equal(await run("--climb", "tight"), 1);
  assert.deepEqual(lines, [
    "refused: this round would cost about $0.19, taking the climb to $0.38 of its $0.20 cap",
  ]);
  assert.equal(calls(), made);
});

test("a case added, removed or edited since the plan froze it stops the round", async (t) => {
  const { dir, lines, run, calls } = harness(t);
  await run("freeze", "frozen", "--cap", "5", "--reps", "1");
  writeCases(dir, "How do I take a change back?");
  assert.equal(await run("--climb", "frozen"), 1);
  assert.deepEqual(lines, [
    "revert-test changed since the plan froze it",
    "revert-train changed since the plan froze it",
  ]);
  assert.equal(calls(), 0);
  assert.equal(await run("--climb", "missing"), 1);
  assert.match(lines.join("\n"), /no climb at .*missing\.json; freeze one first/);
});
