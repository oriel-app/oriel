import assert from "node:assert/strict";
import { test } from "node:test";
import type { Replied } from "../src/http.ts";
import {
  emptyJira,
  initJira,
  jiraReplied,
  loadJira,
  updateJira,
  type JiraModel,
} from "../src/jira.ts";
import { init as initRoot, update as updateRoot } from "../src/root.ts";
import type { JiraView } from "../src/view.ts";
import { connectionView } from "../testing.ts";

const typed = {
  site: "oriel.atlassian.net",
  email: "pm@example.com",
  token: "pasted",
};
const connectable: JiraView = { connected: null, connectable: true };
const connected: JiraView = {
  connected: { site: "https://oriel.atlassian.net", project: "OA", items: 42, syncedAt: null },
  connectable: false,
};
// Jira's connection as the server sends it, and the list it is in.
const connection = connectionView({ options: { project: "OA" }, items: 42 });
const listedWith = (connections: unknown[], connectable: string[]) => ({
  connections,
  connectable,
  picker: false,
});
const replied = (
  kind: "jira" | "jiraConnected" | "jiraProjects",
  ok: boolean,
  body: unknown,
): Replied => ({
  type: "replied",
  tag: { kind },
  ok,
  body,
});

function filled(): JiraModel {
  let model = initJira();
  for (const [field, value] of Object.entries(typed))
    [model] = updateJira(model, {
      type: "fieldChanged",
      field: field as keyof typeof typed,
      value,
    });
  return model;
}

test("Jira lists its projects once every detail is filled, and connects the one picked", () => {
  assert.deepEqual(updateJira(initJira(), { type: "listClicked" })[1], []);
  const [listing, effects] = updateJira(filled(), { type: "listClicked" });
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: "/api/connections/pick",
      body: { kind: "jira", given: typed, query: "" },
      tag: { kind: "jiraProjects" },
    },
  ]);
  assert.deepEqual(updateJira(listing, { type: "listClicked" })[1], []);
  // A refusal names its fields, and the details stay as typed.
  const refused = jiraReplied(
    listing,
    replied("jiraProjects", false, { error: "No.", fields: ["email", "token"] }),
  );
  assert.deepEqual(
    [refused.model.problem, refused.model.fields, refused.model.pending, refused.model.typed],
    ["No.", ["email", "token"], null, typed],
  );
  // The list picks the likeliest, which Jira's list puts first.
  const projects = [
    { key: "OA", name: "Oriel", issues: 42, updatedAt: "2026-11-01T09:00:00.000Z" },
    { key: "SYN", name: "Synthetic", issues: 130, updatedAt: "2026-10-01T09:00:00.000Z" },
  ];
  const choices = projects.map((p) => ({
    value: p.key,
    name: p.name,
    count: p.issues,
    updatedAt: p.updatedAt,
  }));
  const listed = jiraReplied(listing, replied("jiraProjects", true, { choices, more: false }));
  assert.deepEqual(listed.model.projects, projects);
  assert.equal(listed.model.picked, "OA");
  const [picked] = updateJira(listed.model, { type: "projectPicked", key: "SYN" });
  const [connecting, connects] = updateJira(picked, { type: "connectClicked" });
  assert.deepEqual(connects, [
    {
      type: "http",
      method: "POST",
      url: "/api/connections",
      body: { kind: "jira", given: { ...typed, project: "SYN" } },
      tag: { kind: "jiraConnected" },
    },
  ]);
  assert.equal(connecting.pending, "connecting");
  const failed = jiraReplied(connecting, replied("jiraConnected", false, { error: "Not now." }));
  assert.deepEqual(
    [failed.model.problem, failed.model.pending, failed.model.connecting, failed.synced],
    ["Not now.", null, "SYN", false],
  );
  // Change goes back to the details, as typed.
  const [changed] = updateJira(failed.model, { type: "changeClicked" });
  assert.deepEqual([changed.projects, changed.typed], [null, typed]);
});

test("once connected, nothing typed is kept and the window and the sources load again", () => {
  const [model, effects] = initRoot({ page: "window", grouping: "epic", addTo: null });
  assert.ok(effects.includes(loadJira));
  const [shown] = updateRoot(model, replied("jira", true, listedWith([], ["jira"])));
  assert.equal(shown.jira.view?.connectable, true);
  const [typing] = updateRoot(shown, {
    type: "jira",
    msg: { type: "fieldChanged", field: "token", value: "pasted" },
  });
  const [after, loads] = updateRoot(typing, replied("jiraConnected", true, { connection }));
  assert.deepEqual(after.jira.view, connected);
  assert.equal(after.jira.typed.token, "");
  assert.deepEqual(
    loads.map((e) => (e.type === "http" ? e.url : e.type)),
    ["loadWindow", "/api/connections"],
  );
});

test("Jira connected to a project with no issues is said to be, until it has some", () => {
  const empty = {
    site: "https://oriel.atlassian.net",
    project: "OA",
    items: 0,
    syncedAt: "2026-10-01T09:00:00.000Z",
  };
  const [model] = initRoot({ page: "window", grouping: "epic", addTo: null });
  const [shown] = updateRoot(
    model,
    replied(
      "jira",
      true,
      listedWith(
        [
          connectionView({ options: { project: "OA" }, items: 0, syncedAt: empty.syncedAt }),
          // One signed out isn't the one connected.
          connectionView({ id: "01JBZ0000000000000000000K2", state: "signed-out" }),
        ],
        [],
      ),
    ),
  );
  assert.deepEqual(emptyJira(shown.jira.view), empty);
  // Not before Jira loads, while it can be connected, or once it has items.
  for (const view of [null, connectable, connected]) assert.equal(emptyJira(view), null);
  // Nor before a sync has read the project, as when Jira was unreachable.
  const unread = { connected: { ...empty, syncedAt: null }, connectable: false };
  assert.equal(emptyJira(unread), null);
});
