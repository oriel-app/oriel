// What a diff's lines say about the items they name and the fields they list.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedMutation } from "@oriel/core";
import { approve, nth, setup } from "./testing.ts";

const rename = (target: string, summary: string): CapturedMutation => ({
  op: "setSummary",
  target: target as CapturedMutation["target"],
  ref: null,
  args: { summary },
});

const story = (ref: string, summary: string, epic: string | null): CapturedMutation => ({
  op: "createStory",
  target: null,
  ref: ref as CapturedMutation["ref"],
  args: { summary, epic },
});

const renamed = "“Checkout v2: wallets, saved cards and gift cards”";

test("an item renamed in the change set is named by its new title, on lines before and after the rename", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [
    { op: "setEstimate", target: "jira:SYN-1", ref: null, args: { points: 8 } },
    rename("jira:SYN-1", "Checkout v2: wallets, saved cards and gift cards"),
    story("new:1", "Pay with a gift card", "jira:SYN-1"),
  ]);
  const { lines } = await changeSets.diff(set.id);
  assert.deepEqual(
    lines.map((line) => [line.kind, line.sentence]),
    [
      ["change", `Estimate ${renamed} (SYN-1) at 8 points.`],
      ["change", `Rename “Checkout v2: phone wallets and saved cards” (SYN-1) to ${renamed}.`],
      ["create", `Create a story “Pay with a gift card” in the epic ${renamed} (SYN-1).`],
    ],
  );
  const epic = nth(lines, 2).fields.find((f) => f.name === "epic");
  assert.deepEqual(epic, {
    name: "epic",
    before: null,
    after: "jira:SYN-1",
    titles: { before: null, after: "Checkout v2: wallets, saved cards and gift cards" },
  });
});

test("an epic the change set creates is named by its title as the change set leaves it", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [
    { op: "createEpic", target: null, ref: "new:1", args: { summary: "Kiosk" } },
    story("new:2", "Tap to pay", "new:1"),
    rename("new:1", "Kiosk wallets"),
  ]);
  const { lines } = await changeSets.diff(set.id);
  assert.equal(
    nth(lines, 1).sentence,
    "Create a story “Tap to pay” in the new epic “Kiosk wallets”.",
  );
  assert.deepEqual(
    nth(lines, 1).fields.find((f) => f.name === "epic"),
    {
      name: "epic",
      before: null,
      after: "new:1",
      createdAbove: true,
      titles: { before: null, after: "Kiosk wallets" },
    },
  );
  // Its own rename names it by its title before it.
  assert.equal(nth(lines, 2).sentence, "Rename the new story “Kiosk” to “Kiosk wallets”.");
});

test("a delete lists every field, empty ones too, before and after it applies", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [story("new:1", "Pay with a gift card", "jira:SYN-1")]);
  await approve(changeSets, set.id);
  await changeSets.apply(set.id);
  const back = await changeSets.revert(set.id);
  assert.ok(!("conflicts" in back));
  const every = [
    ["summary", "Pay with a gift card", null],
    ["description", "", null],
    ["points", null, null],
    ["assignee", null, null],
    ["epic", "jira:SYN-1", null],
  ];
  const shown = nth((await changeSets.diff(back.id)).lines, 0);
  assert.equal(shown.kind, "delete");
  assert.deepEqual(
    shown.fields.map((f) => [f.name, f.before, f.after]),
    every,
  );
  assert.deepEqual(shown.fields.find((f) => f.name === "epic")?.titles, {
    before: "Checkout v2: phone wallets and saved cards",
    after: null,
  });

  await approve(changeSets, back.id);
  assert.deepEqual((await changeSets.apply(back.id)).failed, []);
  const applied = nth((await changeSets.diff(back.id)).lines, 0);
  assert.equal(applied.kind, "delete");
  assert.deepEqual(
    applied.fields.map((f) => [f.name, f.before, f.after]),
    every,
  );
});
