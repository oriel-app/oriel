// Cases marked `failing`: known failures of the agent, found in a live round.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEvalCase } from "./case.ts";
import { type CaseResult, exitCode, formatRound, type Round } from "./runner.ts";
import { wilson } from "./stats.ts";

const result = (id: string, kind: number, outcome: CaseResult["outcome"]): CaseResult => ({
  id,
  hash: "0",
  split: "test",
  kind,
  outcome,
  grades: outcome === "pass" ? [] : [{ grader: "surfaced", pass: false, detail: "not quoted" }],
  error: outcome === "error" ? "broke" : null,
  unrecorded: null,
  ms: 0,
});

const failing = new Set(["known"]);

test("a known failure doesn't fail a replay; its passing does, and so does any error", () => {
  assert.equal(
    exitCode([result("known", 3, "fail"), result("other", 3, "pass")], "replay", failing),
    0,
  );
  assert.equal(exitCode([result("known", 3, "pass")], "replay", failing), 1);
  assert.equal(exitCode([result("known", 8, "pass")], "replay", failing), 1);
  assert.equal(exitCode([result("known", 3, "error")], "replay", failing), 1);
  assert.equal(exitCode([result("other", 3, "fail")], "replay", failing), 1);
  // A live round still fails only on errors.
  assert.equal(exitCode([result("known", 3, "pass")], "live", failing), 0);
});

test("a round says which failures are known, and which marks can go", () => {
  const round: Round = {
    results: [result("known", 3, "fail"), result("other", 3, "fail")],
    summary: {
      model: "claude-opus-5-5",
      judgeModel: "claude-sonnet-5-5",
      splits: {
        train: { ...wilson(0, 0), failed: 0, errored: 0 },
        test: { ...wilson(0, 2), failed: 2, errored: 0 },
      },
    },
  };
  const lines = formatRound(round, failing).split("\n").slice(2);
  assert.deepEqual(lines, [
    "fail (known)  known (test, kind 3): not quoted",
    "fail  other (test, kind 3): not quoted",
  ]);
  const fixed = { ...round, results: [result("known", 3, "pass")] };
  assert.deepEqual(formatRound(fixed, failing).split("\n").slice(2), [
    "pass  known: it's marked failing; remove the mark",
  ]);
});

test("a waiting case never runs, so it can't be failing", () => {
  const parsed = parseEvalCase({
    id: "both",
    split: "train",
    kind: 4,
    region: "picked",
    waiting: "a golden",
    failing: "the agent",
    prompt: "Status?",
    expect: [{ grader: "zero-mutations" }],
  });
  assert.deepEqual(!parsed.ok && parsed.issues, [
    { path: "$.failing", message: "a waiting case never runs, so it can't be failing" },
  ]);
});
