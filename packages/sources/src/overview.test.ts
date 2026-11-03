import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type IndexRecord,
  type Instant,
  type SourceDeclaration,
  type SourceKind,
  ulid,
} from "@oriel/core";
import { folderSource } from "@oriel/folder";
import { fixtureSnapshot } from "@oriel/jira";
import { fixtureApi, slackSource } from "@oriel/slack";
import { buildFolder, loadFolderFixture } from "../../../scripts/fixtures/folder.ts";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { loadSlackFixture } from "../../../scripts/fixtures/slack.ts";
import { candidatesFor } from "./index.ts";

// The fixture window's instant: SYN's last edit, as the server builds it.
const now = "2026-10-02T11:00:00.000Z" as Instant;

async function synced(source: {
  sync(cursor: null): AsyncIterable<{ records: IndexRecord[] }>;
}): Promise<IndexRecord[]> {
  const records: IndexRecord[] = [];
  for await (const page of source.sync(null)) records.push(...page.records);
  return records;
}

test("the fixture window yields candidates from every source, each with its rule", async (t) => {
  const jira = loadJiraFixture();
  const slack = loadSlackFixture();
  const dir = mkdtempSync(join(tmpdir(), "oriel-sources-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const folder = buildFolder(loadFolderFixture(), dir);
  const records = [
    ...fixtureSnapshot(jira, "https://oriel.atlassian.net", jira.edits.length).records,
    ...(await synced(
      slackSource({
        api: fixtureApi(slack, { now: () => now }).api,
        workspaceUrl: slack.team.url,
        channels: slack.picked,
        log: () => {},
      }),
    )),
    ...(await synced(
      folderSource({ folderId: ulid(0), path: folder.root as never, log: () => {} }),
    )),
  ];
  const found = candidatesFor({ records, changes: [], held: () => false, now });
  const rules = new Map<SourceKind, Set<string>>();
  for (const candidate of found) {
    assert.ok(candidate.rule.length > 0);
    assert.ok(candidate.weight > 0);
    rules.set(candidate.source, (rules.get(candidate.source) ?? new Set()).add(candidate.rule));
  }
  assert.deepEqual(Object.fromEntries([...rules].map(([kind, set]) => [kind, [...set].sort()])), {
    jira: ["An epic no workstream holds", "In progress, no update in 14 days"],
    folder: ["Edited in the last 7 days"],
    slack: ["A question from the last 30 days with no reply"],
  });
  // What a workstream holds is no candidate.
  const held = new Set(found.flatMap((c) => (c.subject.kind === "item" ? [c.subject.id] : [])));
  const left = candidatesFor({ records, changes: [], held: (r) => held.has(r.id), now });
  assert.ok(left.every((candidate) => candidate.subject.kind === "cluster"));
});

test("a source declared without its overview is a type error", () => {
  const declaration = {
    name: "Notes",
    details: () => null,
    itemDoc: "A note.",
    panel: () => null,
    facets: {},
    recognizer: () => () => [],
  };
  // @ts-expect-error Every source offers the overview its candidates, if only none.
  const checked: SourceDeclaration = declaration;
  assert.ok(checked);
});
