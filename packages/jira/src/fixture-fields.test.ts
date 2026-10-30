import assert from "node:assert/strict";
import { test } from "node:test";
import { itemId } from "@oriel/core";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { applySourceEdits } from "./fixture.ts";
import { fixtureFields } from "./fixture-source.ts";

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const edited = fixture.edits.length;
const { issues } = applySourceEdits(fixture, edited);

test("fields read as Jira's writer names them, after every source edit", async () => {
  const fields = fixtureFields(fixture, { site, edited });
  const issue = issues.find((i) => i.assignee !== null && i.epic !== null);
  assert.ok(issue, "the fixture has an assigned story in an epic");
  const values = await fields.current(itemId("jira", issue.key), [
    "summary",
    "description",
    "points",
    "assignee",
    "epic",
    "updated",
    "link:999999",
    "nonsense",
  ]);
  assert.deepEqual(values, {
    summary: issue.summary,
    description: issue.description,
    points: issue.points,
    assignee: issue.assignee,
    epic: `jira:${issue.epic}`,
    updated: issue.updatedAt,
    "link:999999": null,
    nonsense: null,
  });
  const linked = issues.find((i) => i.links.length > 0);
  const link = linked?.links[0];
  assert.ok(linked && link, "the fixture has an item with a link");
  assert.deepEqual(await fields.current(itemId("jira", linked.key), [`link:${link.linkId}`]), {
    [`link:${link.linkId}`]: { url: link.url, title: link.title },
  });
});

test("a deleted item is gone, and people are named as the fixture names them", async () => {
  const fields = fixtureFields(fixture, { site, edited });
  const deleted = fixture.edits.find((edit) => edit.kind === "delete");
  assert.ok(deleted);
  assert.equal(await fields.current(itemId("jira", deleted.key), ["summary"]), "gone");
  const [person] = fixture.people;
  assert.ok(person);
  assert.equal(await fields.person(person.id), person.displayName);
  assert.equal(await fields.person("nobody"), null);
});
