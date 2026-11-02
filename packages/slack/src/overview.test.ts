import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexRecord, Instant } from "@oriel/core";
import { asks, type SlackAttrs } from "./attrs.ts";
import { slackOverview } from "./overview.ts";

const now = "2026-10-30T12:00:00.000Z" as Instant;
const daysAgo = (days: number) =>
  new Date(Date.parse(now) - days * 86_400_000).toISOString() as Instant;

const message = (ts: string, attrs: Partial<SlackAttrs>, age: number): IndexRecord => ({
  id: `slack:C0FW1WEATHR-${ts}`,
  stableId: `C0FW1WEATHR-${ts}`,
  title: "Robin: a message",
  location: "https://example.slack.com/archives/C0FW1WEATHR/p1",
  updatedAt: daysAgo(age),
  facets: { kind: "message" },
  attrs: {
    channel: { id: "C0FW1WEATHR", name: "weather" },
    author: { id: "U1", name: "Robin" },
    replies: 0,
    ...attrs,
  },
});

const candidates = (records: IndexRecord[], held: string[] = []) =>
  slackOverview({ records, changes: [], held: (r) => held.includes(r.id), now });

test("a question from the last 30 days with no reply is a candidate", () => {
  assert.deepEqual(candidates([message("1788444000.000100", { asks: true }, 3)]), [
    {
      subject: { kind: "item", id: "slack:C0FW1WEATHR-1788444000.000100" },
      rule: "A question from the last 30 days with no reply",
      weight: 2,
      detail: "asked 3 days ago",
    },
  ]);
});

test("a question with a reply, an older one, one a workstream holds, or no question, is none", () => {
  const records = [
    message("1788444000.000100", { asks: true, replies: 1 }, 1),
    message("1788444001.000100", { asks: true }, 31),
    message("1788444002.000100", { asks: true }, 0),
    message("1788444003.000100", {}, 0),
  ];
  assert.deepEqual(candidates(records, ["slack:C0FW1WEATHR-1788444002.000100"]), []);
});

test("a message asks something when a sentence in it ends in a question mark", () => {
  assert.ok(asks("Can someone check the 18:00 from Inchmore?"));
  assert.ok(asks("Status of SYN-47? Thanks"));
  assert.ok(!asks("See https://example.com/search?q=ferry for the timetable."));
  assert.ok(!asks("No questions here."));
});
