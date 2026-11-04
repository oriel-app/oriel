// A comment on a Jira issue through a change set, end to end through the
// routes: the diff shows it as an added comment and leaves the description
// alone, the review link shows the same, approving posts it, the panel reads
// it, and a revert deletes it, or stops when a teammate edited it since.
// Jira is SYN in memory.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type {
  ChangeSetView,
  DiffView,
  ItemPanelView,
  ReviewView,
  ThreadView,
} from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const note = "The launch moved to 14 August: the operator's crew rota slipped a fortnight.";
const comment: Script = async () => ({
  value: null,
  writes: [["jira.addComment", ["jira:SYN-45", note]]],
});

type Acted = { changeSet: ChangeSetView; error?: string; revert?: string };

async function proposed(t: TestContext) {
  const app = await testApp(t, {
    live: true,
    plan: () => [{ run: "comment" }],
    scripts: { comment },
  });
  const { site } = app;
  assert.ok(site);
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Fares", items: ["jira:SYN-45"] }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Note the date move" }),
  );
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = (await view()).entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const diff = async (id = entry.changeSetId) =>
    json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
  const act = async (action: string, body: unknown = {}, id = entry.changeSetId) =>
    json<Acted>(await app.post(`/api/change-sets/${id}/${action}`, body));
  const approve = async (id = entry.changeSetId) => {
    app.advance(1000);
    return act("approve", { hash: (await diff(id)).hash }, id);
  };
  return { ...app, site, threadId, view, diff, act, approve, changeSetId: entry.changeSetId };
}

const title = "Rebooking: keep the original fare when moving to a dearer sailing";

test("an approved comment is posted on the issue, the description untouched, and a revert deletes it", async (t) => {
  const app = await proposed(t);
  const description = app.site.issue("SYN-45")?.description;
  const shown = await app.diff();
  assert.deepEqual(
    shown.lines.map((line) => [line.kind, line.sentence, line.fields]),
    [
      [
        "change",
        `Comment on “${title}” (SYN-45).`,
        [{ name: "comment:new", before: null, after: note }],
      ],
    ],
  );

  // The review link shows the same line.
  const minted = json<{ url: string }>(
    await app.post(`/api/change-sets/${app.changeSetId}/review-link`),
  );
  const token = new URL(minted.url).pathname.split("/").at(-1) ?? "";
  const review = json<ReviewView>(await app.post("/api/review/open", { token }));
  assert.deepEqual(review.diff.lines, shown.lines);
  // Nothing reached Jira before the approval.
  assert.equal(app.site.issue("SYN-45")?.comments.length, 0);

  assert.equal((await app.approve()).changeSet.status, "applied");
  const posted = app.site.issue("SYN-45")?.comments;
  assert.deepEqual(
    posted?.map((c) => [c.author, c.body]),
    [["amara", note]],
  );
  assert.equal(app.site.issue("SYN-45")?.description, description);
  const field = `comment:${posted?.[0]?.id}`;
  const applied = await app.diff();
  assert.deepEqual(applied.lines[0]?.fields, [{ name: field, before: null, after: note }]);
  assert.deepEqual(
    app.app
      .telemetry()
      .filter((e) => e.name === "changeset.applied")
      .map((e) => e.data.sources),
    [["jira"]],
  );
  // The item's panel reads it live, by its author.
  const panel = json<ItemPanelView>(
    await app.get(`/api/items/${encodeURIComponent("jira:SYN-45")}`),
  );
  const messages =
    panel.read.status === "ok" ? panel.read.blocks.find((b) => b.kind === "messages") : undefined;
  assert.deepEqual(
    messages?.kind === "messages" ? messages.messages.map((m) => [m.author, m.text]) : null,
    [["Amara Okafor", note]],
  );

  const { revert } = await app.act("revert");
  assert.ok(revert);
  const undo = await app.diff(revert);
  assert.deepEqual(
    undo.lines.map((line) => [line.kind, line.sentence, line.fields]),
    [
      [
        "change",
        `Delete the comment Oriel added to “${title}” (SYN-45). People may already have read it.`,
        [{ name: field, before: note, after: null }],
      ],
    ],
  );
  assert.equal((await app.approve(revert)).changeSet.status, "applied");
  assert.deepEqual(app.site.issue("SYN-45")?.comments, []);
  assert.equal(app.site.issue("SYN-45")?.description, description);
});

test("a revert stops, deleting nothing, when a teammate edited the comment since", async (t) => {
  const app = await proposed(t);
  await app.approve();
  const [posted] = app.site.issue("SYN-45")?.comments ?? [];
  assert.ok(posted);
  app.site.editComment("SYN-45", posted.id, "The launch moved to 21 August.");
  const stopped = await app.act("revert");
  assert.equal(stopped.revert, undefined);
  assert.equal(
    stopped.error,
    `Stopped, so nothing was overwritten: the comment Oriel added to “${title}” (SYN-45) was edited since.`,
  );
  assert.equal(app.site.issue("SYN-45")?.comments.length, 1);
});
