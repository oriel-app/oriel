import assert from "node:assert/strict";
import { test } from "node:test";
import { mentionedUsers, plainText } from "./mrkdwn.ts";

const names = new Map([["U0AMARA001", "Amara Okafor"]]);
const read = (text: string) => plainText(text, (id) => names.get(id) ?? null);

test("escaped &, < and > read as themselves, once", () => {
  assert.equal(read("fares &lt; £20 &amp; &gt; 2 legs"), "fares < £20 & > 2 legs");
  // Escaped once by Slack: what the person typed as "&lt;" arrives as "&amp;lt;".
  assert.equal(read("type &amp;lt; for <"), "type &lt; for <");
});

test("a mention reads as the person's name, else its label, else its ID", () => {
  assert.equal(read("ask <@U0AMARA001>"), "ask @Amara Okafor");
  assert.equal(read("ask <@U0AMARA001|amara>"), "ask @Amara Okafor");
  assert.equal(read("ask <@U0GONE0001|old name>"), "ask @old name");
  assert.equal(read("ask <@U0GONE0001>"), "ask @U0GONE0001");
  assert.deepEqual(mentionedUsers("<@U0AMARA001> and <@W0B|b> and <@U0AMARA001>"), [
    "U0AMARA001",
    "W0B",
  ]);
});

test("channels, broadcasts, groups and dates read as Slack shows them", () => {
  assert.equal(read("see <#C0FW2RANDOM|random>"), "see #random");
  assert.equal(read("see <#C0FW2RANDOM>"), "see #C0FW2RANDOM");
  assert.equal(read("<!here> and <!channel> and <!everyone>"), "@here and @channel and @everyone");
  assert.equal(read("<!subteam^S0OPS|@ops-leads> please"), "@ops-leads please");
  assert.equal(read("by <!date^1793404800^{date_short}|Oct 31>"), "by Oct 31");
});

test("a link reads as its label and address, or its address alone", () => {
  assert.equal(
    read("<https://docs.example.com/a?b=1&amp;c=2|the plan>"),
    "the plan (https://docs.example.com/a?b=1&c=2)",
  );
  assert.equal(read("<https://docs.example.com/plan>"), "https://docs.example.com/plan");
  assert.equal(
    read("<https://docs.example.com/plan|https://docs.example.com/plan>"),
    "https://docs.example.com/plan",
  );
  assert.equal(read("<mailto:ops@example.com|ops@example.com>"), "ops@example.com");
});

test("text that only looks like markup stays text", () => {
  // Slack escapes what a person types, so this is never a link.
  assert.equal(read("a &lt;b&gt; c"), "a <b> c");
  assert.equal(read("*bold* _it_ ~gone~ `code`"), "*bold* _it_ ~gone~ `code`");
});
