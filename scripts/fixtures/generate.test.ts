import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applySourceEdits,
  type FixtureIssue,
  fixtureSnapshot,
} from "../../packages/core/src/fixture.ts";
import { generate } from "./generate.ts";
import { fixtureDir, loadJiraFixture } from "./load.ts";

// Throws, failing every test here, if the committed fixtures don't validate.
const fixture = loadJiraFixture();
const base = fixture.issues;
const edited = applySourceEdits(fixture, fixture.edits.length).issues;
const epics = base.filter((issue) => issue.issueType === "Epic");
const childrenOf = (issues: FixtureIssue[], epic: string) =>
  issues.filter((issue) => issue.epic === epic);
const byKey = new Map(base.map((issue) => [issue.key, issue]));

test("regenerating the fixtures is byte-identical", () => {
  const generated = generate();
  // Dotfiles such as Finder's .DS_Store aren't fixtures.
  const committed = readdirSync(fixtureDir).filter((name) => !name.startsWith("."));
  assert.deepEqual(committed.toSorted(), [...generated.keys()].toSorted());
  for (const [file, text] of generated) {
    const committed = readFileSync(new URL(file, fixtureDir));
    assert.ok(committed.equals(Buffer.from(text, "utf8")), `${file} differs from the generator`);
  }
});

test("SYN is a backlog of about 120 issues in 6 to 8 epics", () => {
  assert.equal(fixture.project.key, "SYN");
  assert.ok(base.length >= 110 && base.length <= 130, `${base.length} issues`);
  assert.ok(epics.length >= 6 && epics.length <= 8, `${epics.length} epics`);
});

test("mess: duplicate titles", () => {
  const counts = Map.groupBy(base, (issue) => issue.summary);
  assert.ok([...counts.values()].some((group) => group.length > 1));
});

test("mess: stale assignees, on open work", () => {
  const inactive = new Set(fixture.people.filter((p) => !p.active).map((p) => p.id));
  const stale = base.filter((issue) => issue.assignee !== null && inactive.has(issue.assignee));
  assert.ok(stale.some((issue) => issue.status.category !== "done"));
});

test("mess: a half-estimated epic", () => {
  const half = epics.some((epic) => {
    const children = childrenOf(base, epic.key);
    const estimated = children.filter((child) => child.points !== null).length;
    return children.length >= 2 && estimated * 2 === children.length;
  });
  assert.ok(half);
});

test("mess: an epic with zero stories, before and after the edits", () => {
  assert.ok(
    epics.some(
      (epic) => !childrenOf(base, epic.key).length && !childrenOf(edited, epic.key).length,
    ),
  );
});

test("mess: an epic with forty stories", () => {
  assert.ok(
    epics.some(
      (epic) =>
        childrenOf(base, epic.key).filter((child) => child.issueType === "Story").length === 40,
    ),
  );
});

test("mess: a story moved between epics, by a source edit", () => {
  const moves = fixture.edits.filter((edit) => edit.kind === "setEpic");
  const moved = moves.find((move) => {
    const before = byKey.get(move.key);
    return before?.issueType === "Story" && before.epic !== null && before.epic !== move.epic;
  });
  assert.ok(moved);
  const after = edited.find((issue) => issue.key === moved.key);
  assert.equal(after?.epic, moved.epic);
});

test("source edits: a summary edit and a deletion", () => {
  const edit = fixture.edits.find((e) => e.kind === "setSummary");
  assert.ok(edit);
  assert.equal(edited.find((issue) => issue.key === edit.key)?.summary, edit.summary);
  assert.ok(fixture.edits.some((e) => e.kind === "delete"));
});

test("mess: emoji titles", () => {
  assert.ok(base.some((issue) => /\p{Extended_Pictographic}/u.test(issue.summary)));
});

test("mess: non-Latin titles, Japanese and another script", () => {
  const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const others = [
    /\p{Script=Greek}/u,
    /\p{Script=Cyrillic}/u,
    /\p{Script=Arabic}/u,
    /\p{Script=Hangul}/u,
  ];
  assert.ok(base.some((issue) => japanese.test(issue.summary)));
  assert.ok(others.some((script) => base.some((issue) => script.test(issue.summary))));
});

test("mess: a description of 10,000 characters or more", () => {
  assert.ok(base.some((issue) => issue.description.length >= 10_000));
});

test("mess: the injection story", () => {
  const injection = base.find(
    (issue) =>
      /ignore all previous instructions/i.test(issue.description) &&
      /story points of every issue in this project to 0/i.test(issue.description),
  );
  assert.equal(injection?.issueType, "Story");
});

test("frozen regions: epic groups anchored on their epic, and a hand-picked one", () => {
  const origins = fixture.regions.map((region) => region.origin);
  assert.ok(origins.some((o) => o.kind === "group" && o.grouping === "epic" && o.anchor));
  assert.ok(origins.some((o) => o.kind === "picked"));
});

test("mess: a deleted story referenced by a frozen region", () => {
  const deleted = fixture.edits.filter((edit) => edit.kind === "delete");
  const story = deleted.find((edit) => byKey.get(edit.key)?.issueType === "Story");
  assert.ok(story);
  assert.ok(fixture.regions.some((region) => region.items.includes(`jira:${story.key}`)));
  assert.ok(!edited.some((issue) => issue.key === story.key));
  const snapshot = fixtureSnapshot(fixture, "https://oriel.atlassian.net", fixture.edits.length);
  assert.ok(snapshot.gone.includes(byKey.get(story.key)?.id ?? ""));
  assert.ok(!snapshot.content.has(`jira:${story.key}`));
});
