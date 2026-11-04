import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItemId } from "./ids.ts";
import {
  checkNotice,
  dismissed,
  kindWeights,
  parseNoticeLine,
  quoteFound,
  type Signal,
  teachAfter,
  whyProblem,
} from "./noticed.ts";

const signal: Signal = {
  id: "contradicted:jira:SYN-61",
  kind: "contradicted",
  subject: { kind: "item", id: "jira:SYN-61" as ItemId },
  headline: "1 chat message named SYN-61 after it was marked done",
  rule: "A chat message that names an item after it was marked done",
  weight: 2,
  fingerprint: "slack:C1-1",
  items: ["jira:SYN-61" as ItemId, "slack:C1-1" as ItemId],
  block: { read: "signals.after-done", args: ["jira:SYN-61"], from: undefined, form: "rows" },
};
const offered = new Map([[signal.id, signal]]);
const texts = new Map([
  ["jira:SYN-61", "SMS updates\nSend disruption updates by SMS. Uses the 3-D Secure flow."],
  [
    "slack:C1-1",
    "Passengers got no SMS when the 18:00 sailing was cancelled. Support took forty calls.",
  ],
]);
const allowed = new Set(signal.items);

test("a line may name the signal's items as chips, and carries no figure, link or markup of its own", () => {
  assert.equal(whyProblem("[[jira:SYN-61]] is done, but chat says it isn't.", allowed), null);
  assert.match(whyProblem("[[jira:SYN-99]] is done.", allowed) ?? "", /isn't behind/);
  assert.match(whyProblem("Forty calls, 40 of them angry.", allowed) ?? "", /figure/);
  assert.match(whyProblem("See https://example.com/x for more.", allowed) ?? "", /link/);
  assert.match(whyProblem("This is **urgent**.", allowed) ?? "", /markup/);
  assert.match(whyProblem("One line\nand another.", allowed) ?? "", /one line/);
  assert.match(whyProblem("x".repeat(201), allowed) ?? "", /longer/);
  // A number its items' text holds is theirs, not the model's.
  assert.equal(whyProblem("The 3-D Secure flow needs work.", allowed, new Set(["3"])), null);
});

test("a quote shows only when it is in its item word for word, and short", () => {
  assert.ok(quoteFound("support took  forty calls", texts.get("slack:C1-1") ?? ""));
  assert.ok(!quoteFound("support took fifty calls", texts.get("slack:C1-1") ?? ""));
  assert.ok(!quoteFound(Array.from({ length: 30 }, () => "word").join(" "), "word ".repeat(40)));
});

test("a line's pick stays when its sentence fails a check, and a stray signal is refused", () => {
  const parsed = parseNoticeLine(
    JSON.stringify({
      signal: signal.id,
      why: "It failed 40 times.",
      quote: { item: "slack:C1-1", text: "Support took forty calls." },
    }),
  );
  assert.ok(parsed?.ok);
  const checked = checkNotice(parsed.line, offered, texts);
  assert.ok(checked.ok);
  assert.equal(checked.notice.why, null);
  assert.match(checked.lineProblem ?? "", /figure/);
  assert.equal(checked.notice.quote?.text, "Support took forty calls.");

  const known = checkNotice(
    { signal: signal.id, why: "The 3-D Secure flow is involved.", quote: null },
    offered,
    texts,
  );
  assert.ok(known.ok && known.notice.why !== null);

  const stray = checkNotice({ signal: "stalled:x", why: "Look.", quote: null }, offered, texts);
  assert.equal(stray.ok, false);
  // A quote from an item not behind the signal is dropped.
  const elsewhere = checkNotice(
    { signal: signal.id, why: "Look.", quote: { item: "jira:SYN-1", text: "SMS updates" } },
    offered,
    texts,
  );
  assert.ok(elsewhere.ok && elsewhere.notice.quote === null && elsewhere.quoteDropped);
});

test("prose that isn't a JSON line is skipped; a broken one is refused", () => {
  assert.equal(parseNoticeLine("Here are my picks:"), null);
  assert.deepEqual(parseNoticeLine("{nope"), { ok: false, why: "a line isn't JSON" });
});

test("a dismissal holds while the fingerprint does, and three of a kind never kept halve its weight", () => {
  assert.ok(dismissed(signal, [{ signal: signal.id, fingerprint: signal.fingerprint }]));
  assert.ok(!dismissed(signal, [{ signal: signal.id, fingerprint: "slack:C1-1,slack:C1-2" }]));
  const three = Array.from({ length: teachAfter }, (_, i) => ({
    kind: "stalled" as const,
    signal: `stalled:w${i}`,
  }));
  const again = Array.from({ length: teachAfter }, () => ({
    kind: "stalled" as const,
    signal: "stalled:w0",
  }));
  assert.equal(kindWeights(again, [])["stalled"], 1);
  assert.equal(kindWeights(three, [])["stalled"], 0.5);
  assert.equal(kindWeights(three, ["stalled"])["stalled"], 1);
  assert.equal(kindWeights(three.slice(1), [])["stalled"], 1);
});
