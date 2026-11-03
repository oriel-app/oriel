// The sidebar's sources (OA-146): every connected source syncs on demand,
// one at a time each or all at once, says why when it can't, and once it
// synced, what's on screen loads again. Folded, they are one line.
import assert from "node:assert/strict";
import { test } from "node:test";
import { workstreamReplied, initWorkstream } from "../src/workstream.ts";
import type { Replied } from "../src/http.ts";
import { loadJira } from "../src/jira.ts";
import { init as initRoot, update as updateRoot } from "../src/root.ts";
import {
  initSources,
  loadSources,
  sourcesLine,
  sourcesReplied,
  updateSources,
} from "../src/sources.ts";
import type { SourceView } from "../src/view.ts";

const source = (kind: string, name: string, syncedAt: string | null): SourceView => ({
  kind,
  name,
  about: `${name}'s details`,
  items: 3,
  syncedAt,
});
const jira = source("jira", "Jira", "2026-10-30T09:00:00.000Z");
const folder = source("folder", "Folder", "2026-10-30T08:00:00.000Z");
const slack = source("slack", "Slack", "2026-10-30T09:30:00.000Z");
const replied = (tag: Replied["tag"], ok: boolean, body: unknown): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});
const listed = (sources: SourceView[]) =>
  sourcesReplied(initSources(), replied({ kind: "sources" }, true, { sources })).model;
const sync = (kind: string) => ({
  type: "http",
  method: "POST",
  url: `/api/${kind}/sync`,
  body: {},
  tag: { kind: "sourceSynced", source: kind },
});

test("a source syncs on demand, once at a time, and says why when it can't", () => {
  // Nothing to sync before the list loads, or for a source not in it.
  assert.deepEqual(updateSources(initSources(), { type: "syncClicked", source: "jira" })[1], []);
  const shown = listed([jira, folder]);
  assert.deepEqual(updateSources(shown, { type: "syncClicked", source: "slack" })[1], []);
  const [syncing, effects] = updateSources(shown, { type: "syncClicked", source: "jira" });
  assert.deepEqual(effects, [sync("jira")]);
  assert.deepEqual(syncing.syncing, ["jira"]);
  assert.deepEqual(updateSources(syncing, { type: "syncClicked", source: "jira" })[1], []);

  const problem = "Oriel couldn't reach Jira just now, so the window may be behind it.";
  const failed = sourcesReplied(
    syncing,
    replied({ kind: "sourceSynced", source: "jira" }, false, { error: problem }),
  );
  assert.deepEqual(
    [failed.model.syncing, failed.model.problems, failed.model.view, failed.synced],
    [[], { jira: problem }, [jira, folder], false],
  );
  // Syncing it again clears the problem until it answers.
  const again = updateSources(failed.model, { type: "syncClicked", source: "jira" });
  assert.deepEqual([again[0].problems, again[1]], [{}, [sync("jira")]]);
  const done = sourcesReplied(
    again[0],
    replied({ kind: "sourceSynced", source: "jira" }, true, {}),
  );
  assert.deepEqual([done.model, done.synced], [shown, true]);
});

test("Sync all syncs every source not syncing already, and keeps others' problems", () => {
  const shown = listed([jira, folder, slack]);
  const [one] = updateSources(shown, { type: "syncClicked", source: "folder" });
  const withProblem = { ...one, problems: { slack: "Slack didn't answer." } };
  const [all, effects] = updateSources(withProblem, { type: "syncAllClicked" });
  assert.deepEqual(effects, [sync("jira"), sync("slack")]);
  assert.deepEqual(all.syncing, ["folder", "jira", "slack"]);
  assert.deepEqual(all.problems, {});
  assert.deepEqual(updateSources(all, { type: "syncAllClicked" })[1], []);
});

test("folded, the sources are one line: how many, the oldest sync, and any problem", () => {
  assert.deepEqual(sourcesLine(initSources()), {
    count: 0,
    syncedAt: null,
    syncing: false,
    problem: false,
  });
  const shown = listed([jira, folder, slack]);
  assert.deepEqual(sourcesLine(shown), {
    count: 3,
    syncedAt: folder.syncedAt,
    syncing: false,
    problem: false,
  });
  // A source never synced makes the line "not synced".
  assert.equal(sourcesLine(listed([jira, source("slack", "Slack", null)])).syncedAt, null);
  const [syncing] = updateSources(shown, { type: "syncClicked", source: "slack" });
  assert.equal(sourcesLine(syncing).syncing, true);
  assert.equal(
    sourcesLine({ ...shown, problems: { slack: "Slack didn't answer." } }).problem,
    true,
  );
  // A problem left by a source no longer listed isn't the line's.
  assert.equal(sourcesLine({ ...shown, problems: { other: "Gone." } }).problem, false);
});

test("once a source synced, the window, the workstream or thread on screen and the sources load again", () => {
  const [window, effects] = initRoot({ page: "window", grouping: "epic", addTo: null });
  assert.ok(effects.includes(loadSources));
  assert.ok(effects.includes(loadJira));
  const synced = replied({ kind: "sourceSynced", source: "jira" }, true, {});
  const urls = (loads: readonly { type: string; url?: string }[]) =>
    loads.map((e) => (e.type === "http" ? e.url : e.type));
  assert.deepEqual(urls(updateRoot(window, synced)[1]), [
    "loadWindow",
    "/api/jira",
    "/api/sources",
  ]);
  const [workstream] = initRoot({ page: "workstream", id: "01JB0000000000000000000000" });
  assert.deepEqual(urls(updateRoot(workstream, synced)[1]), [
    "/api/workstreams/01JB0000000000000000000000",
    "/api/jira",
    "/api/sources",
  ]);
  const [thread] = initRoot({ page: "thread", id: "01JB0000000000000000000001" });
  assert.deepEqual(urls(updateRoot(thread, synced)[1]), [
    "/api/threads/01JB0000000000000000000001",
    "/api/jira",
    "/api/sources",
  ]);
  // One that failed loads nothing.
  const failed = replied({ kind: "sourceSynced", source: "jira" }, false, { error: "No." });
  assert.deepEqual(updateRoot(window, failed)[1], []);
});

test("a workstream reloaded after a sync keeps an Ask that's still on its way", () => {
  const [loading] = initWorkstream("01JB0000000000000000000000");
  const asking = { ...loading, pending: true, draft: "What's left?" };
  const view = { workstream: { id: "01JB0000000000000000000000" }, members: [] };
  const [after] = workstreamReplied(
    asking,
    replied({ kind: "workstreamSynced", id: "01JB0000000000000000000000" }, true, view),
  );
  assert.deepEqual([after.pending, after.draft, after.view], [true, "What's left?", view]);
});
