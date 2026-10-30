// Replays the cassettes `pnpm record:jira` recorded from the live SYN, which
// `pnpm seed:jira` built from the fixtures, and checks the source reads back
// what the fixtures say. The live copy differs only where Jira sets values
// itself (stable IDs, update times, comment authors and times, link IDs) and
// in assignees, which the seed leaves empty. Skipped until recorded.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import type { SyncPage } from "@oriel/core";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { recordedReads, recordedSource, testData } from "../../../scripts/record-jira.ts";
import type { JiraAttrs } from "./attrs.ts";
import { fixtureSnapshot } from "./fixture.ts";
import { cassette, replay } from "./cassette.ts";
import { jiraSource } from "./source.ts";

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const expected = fixtureSnapshot(fixture, site, fixture.edits.length);

function load(name: string) {
  const file = new URL(name, testData);
  if (!existsSync(file)) return null;
  const parsed = cassette(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.ok) throw new Error(`${name} isn't a cassette: ${JSON.stringify(parsed.issues[0])}`);
  return replay(parsed.value);
}

const sync = load("sync.json");
const read = load("read.json");
const unrecorded = "no cassette yet: run pnpm record:jira";

test("the live listing matches the fixtures", { skip: sync ? false : unrecorded }, async () => {
  assert.ok(sync);
  const pages: SyncPage<"jira", JiraAttrs>[] = [];
  for await (const page of jiraSource(recordedSource(sync)).sync(null)) pages.push(page);
  const live = new Map(pages.flatMap((page) => page.records).map((r) => [r.id, r]));
  assert.deepEqual([...live.keys()].toSorted(), expected.records.map((r) => r.id).toSorted());
  for (const want of expected.records) {
    const got = live.get(want.id);
    assert.ok(got, want.id);
    assert.equal(got.title, want.title, want.id);
    assert.equal(got.url, want.url, want.id);
    assert.deepEqual(
      { ...got.attrs, labels: got.attrs.labels.toSorted() },
      { ...want.attrs, assignee: null, labels: want.attrs.labels.toSorted() },
      want.id,
    );
  }
});

test(
  "live reads of the frozen regions match the fixtures",
  { skip: read ? false : unrecorded },
  async () => {
    assert.ok(read);
    const ids = recordedReads(fixture);
    const results = await jiraSource(recordedSource(read)).read(ids);
    for (const [i, id] of ids.entries()) {
      const want = expected.content.get(id);
      const got = results[i];
      if (!want) {
        assert.deepEqual(got, { id, status: "gone", reason: "deleted" });
        continue;
      }
      assert.ok(got?.status === "ok", id);
      assert.equal(got.content.summary, want.summary, id);
      assert.equal(got.content.description, want.description, id);
      assert.deepEqual(
        got.content.comments.map((c) => c.body),
        want.comments.map((c) => c.body),
        id,
      );
      assert.deepEqual(
        got.content.links.map(({ url, title }) => ({ url, title })),
        want.links.map(({ url, title }) => ({ url, title })),
        id,
      );
    }
  },
);
