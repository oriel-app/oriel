import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { CapturedMutation } from "@oriel/core";
import { approve, count, setup } from "./testing.ts";

const week = 7 * 24 * 60 * 60 * 1000;

const estimate = (target: `jira:${string}`, points: number): CapturedMutation => ({
  op: "setEstimate",
  target,
  ref: null,
  args: { points },
});

const tokenOf = (url: URL): string => url.pathname.split("/").at(-1) ?? "";

async function linked() {
  const context = setup();
  const set = await context.changeSets.capture(context.run, [estimate("jira:SYN-21", 5)]);
  const url = await context.changeSets.reviewLink(set.id);
  const byLink = (by: string, hash = set.hash) =>
    context.changeSets.decide(
      set.id,
      "approved",
      { via: "review-link", token: tokenOf(url), by },
      hash,
    );
  return { ...context, set, url, token: tokenOf(url), byLink };
}

test("a review link opens the diff and records the approver's typed name with its link", async () => {
  const { changeSets, set, url, token, db } = await linked();
  assert.equal(url.href, `http://localhost:4000/review/${token}`);
  const opened = await changeSets.openReview(token);
  assert.equal(opened?.changeSet.id, set.id);
  assert.equal(
    opened?.diff.lines[0]?.sentence,
    "Change the estimate of “Update the payment declined error message” (SYN-21) from 2 points to 5 points.",
  );
  const decided = await changeSets.decide(
    set.id,
    "approved",
    { via: "review-link", token, by: "  Sam Ortiz " },
    opened?.diff.hash ?? "",
  );
  assert.deepEqual([decided.decision?.via, decided.decision?.by], ["review-link", "Sam Ortiz"]);
  const row = db.prepare("select review_link from decisions").get();
  assert.equal(row?.review_link, createHash("sha256").update(token).digest("hex"));
});

test("a token minted for another change set is refused", async () => {
  const { changeSets, run, token, db } = await linked();
  const other = await changeSets.capture(run, [estimate("jira:SYN-117", 2)]);
  const diff = await changeSets.diff(other.id);
  await assert.rejects(
    changeSets.decide(
      other.id,
      "approved",
      { via: "review-link", token, by: "Sam Ortiz" },
      diff.hash,
    ),
    { code: "refused" },
  );
  assert.equal(count(db, "decisions"), 0);
});

test("a review-link decision needs a typed name", async () => {
  const { byLink, db } = await linked();
  await assert.rejects(byLink("   "), { code: "refused" });
  assert.equal(count(db, "decisions"), 0);
});

test("a review link dies 7 days after it was made", async () => {
  const { changeSets, token, advance, byLink } = await linked();
  advance(week - 1);
  assert.notEqual(await changeSets.openReview(token), null);
  advance(1);
  assert.equal(await changeSets.openReview(token), null);
  await assert.rejects(byLink("Sam Ortiz"), { code: "refused" });
});

test("a revoked review link is dead", async () => {
  const { changeSets, set, token, byLink } = await linked();
  await changeSets.revokeReviewLink(set.id);
  assert.equal(await changeSets.openReview(token), null);
  await assert.rejects(byLink("Sam Ortiz"), { code: "refused" });
});

test("a review link dies once its change set is decided", async () => {
  const { changeSets, set, token, byLink } = await linked();
  await approve(changeSets, set.id);
  assert.equal(await changeSets.openReview(token), null);
  await assert.rejects(byLink("Sam Ortiz"), { code: "refused" });
  await assert.rejects(changeSets.reviewLink(set.id), { code: "refused" });
});

test("a new link revokes the earlier one, and only token hashes are stored", async () => {
  const { changeSets, set, token, db } = await linked();
  const next = tokenOf(await changeSets.reviewLink(set.id));
  assert.notEqual(next, token);
  assert.equal(await changeSets.openReview(token), null);
  assert.notEqual(await changeSets.openReview(next), null);
  const stored = db
    .prepare("select token_hash from review_links order by created_at, token_hash")
    .all()
    .map((row) => String(row.token_hash))
    .sort();
  const hash = (t: string) => createHash("sha256").update(t).digest("hex");
  assert.deepEqual(stored, [hash(token), hash(next)].sort());
});

test("an unknown or malformed token opens nothing", async () => {
  const { changeSets, token } = await linked();
  const flipped = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  for (const guess of [flipped, "", "../../etc", `${token}x`]) {
    assert.equal(await changeSets.openReview(guess), null, guess);
  }
});
