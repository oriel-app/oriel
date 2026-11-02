import assert from "node:assert/strict";
import { test } from "node:test";
import { type ChangeSet, type ItemId, type MutationRecord, type Ulid, ulid } from "@oriel/core";
import { jiraSpecs } from "@oriel/jira";
import { slackSpecs } from "@oriel/slack";
import { changesOf } from "./change-sets.ts";

const id = (n: number) => ulid(Date.UTC(2026, 9, 1), new Uint8Array(10).fill(n));
const t0 = "2026-10-01T09:00:00.000Z" as ChangeSet["createdAt"];

const mutation = (n: number, fields: Partial<MutationRecord>): MutationRecord => ({
  id: id(n),
  changeSetId: id(0),
  seq: n,
  op: "setStatus",
  target: null,
  ref: null,
  args: {},
  preview: null,
  status: "pending",
  applied: null,
  error: null,
  reverts: null,
  version: 1,
  ...fields,
});

const set = (mutations: MutationRecord[]): ChangeSet => ({
  id: id(0),
  workspaceId: id(1) as Ulid,
  threadId: id(2) as Ulid,
  runId: null,
  mutations,
  hash: "",
  decision: null,
  revertOf: null,
  createdAt: t0,
  completedAt: null,
});

const specs = { jira: jiraSpecs, slack: slackSpecs };
const names: Record<string, string> = { C0FWTEAM001: "oriel-team", U0FWAMARA1: "Amara" };
const titles: Record<string, string> = { "jira:OA-50": "Search your threads" };
const known = {
  name: (key: string) => names[key] ?? null,
  title: (item: ItemId) => titles[item] ?? null,
};

test("a change set's lines are its diff's sentences, from its rows and what Oriel knows", async () => {
  const lines = await changesOf(
    set([
      mutation(1, {
        op: "postMessage",
        ref: "new:1",
        args: { channel: "C0FWTEAM001", text: "Test post from Oriel", author: "U0FWAMARA1" },
      }),
      mutation(2, {
        op: "setStatus",
        target: "jira:OA-50" as ItemId,
        args: { status: "Done" },
        status: "applied",
        applied: {
          item: { id: "jira:OA-50" as ItemId, stableId: "10050" },
          before: { status: "In Progress" },
          after: { status: "Done" },
          at: t0,
        },
      }),
    ]),
    specs,
    known,
  );
  assert.deepEqual(lines, [
    {
      source: "Slack",
      sentence: "Post in #oriel-team as Amara.",
      text: ["Test post from Oriel"],
    },
    {
      source: "Jira",
      sentence: "Move “Search your threads” (OA-50) from In Progress to Done.",
      text: ["Done"],
    },
  ]);
});

test("a name or title Oriel doesn't know reads as the diff says one it can't name", async () => {
  const [line] = await changesOf(
    set([
      mutation(1, {
        op: "postMessage",
        ref: "new:1",
        args: { channel: "C0FWOTHER01", text: "Hello", author: "U0FWNOBODY" },
      }),
    ]),
    specs,
    { name: () => null, title: () => null },
  );
  assert.equal(line?.sentence, "Post in a channel Oriel can't name as a person Oriel can't name.");
});

test("a change whose stored arguments no longer pass says so, and writes nothing", async () => {
  const lines = await changesOf(
    set([mutation(1, { op: "setStatus", target: "jira:OA-50" as ItemId, args: { status: "" } })]),
    specs,
    known,
  );
  assert.deepEqual(lines, [
    {
      source: "Jira",
      sentence: "This change's stored arguments are no longer valid.",
      text: [],
    },
  ]);
});

test("a story's epic, an item ID, is never written text", async () => {
  const [line] = await changesOf(
    set([
      mutation(1, {
        op: "createStory",
        ref: "new:1",
        args: { summary: "Search box", epic: "jira:OA-50" },
      }),
    ]),
    specs,
    known,
  );
  assert.deepEqual(line?.text, ["Search box"]);
  assert.match(line?.sentence ?? "", /in the epic “Search your threads” \(OA-50\)/);
});
