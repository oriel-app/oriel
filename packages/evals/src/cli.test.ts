import assert from "node:assert/strict";
import { test } from "node:test";
import { ulid } from "@oriel/core";
import { defaults, parseCommand, usage } from "./cli.ts";

const a = ulid(Date.UTC(2026, 9, 28), new Uint8Array(10));
const b = ulid(Date.UTC(2026, 9, 29), new Uint8Array(10));

test("no verb runs live, with default models and an optional baseline", () => {
  assert.deepEqual(parseCommand([]), {
    command: "live",
    model: defaults.model,
    judge: defaults.judge,
    baseline: null,
  });
  assert.deepEqual(
    parseCommand(["--model", "claude-sonnet-5-5", "--judge", "claude-opus-5-5", "--baseline", a]),
    {
      command: "live",
      model: "claude-sonnet-5-5",
      judge: "claude-opus-5-5",
      baseline: a,
    },
  );
});

test("replay and compare take what they need and nothing else", () => {
  assert.deepEqual(parseCommand(["replay"]), {
    command: "replay",
    model: defaults.model,
    judge: defaults.judge,
  });
  assert.deepEqual(parseCommand(["compare", a, b]), {
    command: "compare",
    baseline: a,
    candidate: b,
  });
  for (const args of [
    ["replay", "--baseline", a],
    ["compare", a],
    ["compare", a, "../../etc"],
    ["compare", a, b, "--model", "claude-opus-5-5"],
    ["--baseline", "last-week"],
    ["--verbose"],
    ["record"],
  ]) {
    assert.deepEqual(parseCommand(args), { error: usage }, args.join(" "));
  }
});

test("the judge can't be the model under test", () => {
  assert.deepEqual(parseCommand(["--judge", defaults.model]), {
    error: "the judge model must differ from the model under test",
  });
});
