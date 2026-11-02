import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexRecord, Instant } from "@oriel/core";
import { asks, type SlackAttrs } from "./attrs.ts";
import { slackOverview } from "./overview.ts";

const now = "2026-10-30T12:00:00.000Z" as Instant;
const daysAgo = (days: number) =>
  new Date(Date.parse(now) - days * 86_400_000).toISOString() as Instant;

// Posted `age` days ago, and edited `edited` days ago, if since.
const message = (
  n: number,
  attrs: Partial<SlackAttrs>,
  age: number,
  edited = age,
): IndexRecord => ({
  id: `slack:C0FW1WEATHR-${tsOf(daysAgo(age), n)}`,
  stableId: `C0FW1WEATHR-${tsOf(daysAgo(age), n)}`,
  title: "Robin: a message",
  location: "https://example.slack.com/archives/C0FW1WEATHR/p1",
  updatedAt: daysAgo(edited),
  facets: { kind: "message" },
  attrs: {
    channel: { id: "C0FW1WEATHR", name: "weather" },
    author: { id: "U1", name: "Robin" },
    replies: 0,
    ...attrs,
  },
});

const tsOf = (at: Instant, n: number) => `${Date.parse(at) / 1000}.00000${n}`;

const candidates = (records: IndexRecord[], held: string[] = []) =>
  slackOverview({ records, changes: [], held: (r) => held.includes(r.id), now });

test("a question posted in the last 30 days with no reply is a candidate", () => {
  const asked = message(1, { asks: true }, 1);
  assert.deepEqual(candidates([asked]), [
    {
      subject: { kind: "item", id: asked.id },
      rule: "A question from the last 30 days with no reply",
      weight: 2,
      detail: "asked 1 day ago",
    },
  ]);
});

test("a question with a reply, one posted earlier and edited since, one a workstream holds, or no question, is none", () => {
  const held = message(3, { asks: true }, 0);
  const records = [
    message(1, { asks: true, replies: 1 }, 1),
    message(2, { asks: true }, 31, 1),
    held,
    message(4, {}, 0),
  ];
  assert.deepEqual(candidates(records, [held.id]), []);
});

test("a message asks something when a word in it ends in a question mark", () => {
  for (const text of [
    "Can someone check the 18:00 from Inchmore?",
    "Status of SYN-47? Thanks",
    "*Can someone check?*",
    "Really?!",
    "(any update?)",
    '"why?"',
    "確認できますか？明日まで",
    "هل يمكنك؟",
  ])
    assert.ok(asks(text), text);
  for (const text of [
    "See https://example.com/search?q=ferry for the timetable.",
    "No questions here.",
    "const fare = late ? full : half;",
  ])
    assert.ok(!asks(text), text);
});
