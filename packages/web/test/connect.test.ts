// A connector's steps, the same for every connector (decision 0049): its
// fields, then the list its source gives, then the connection; a folder from
// the system's picker or by its typed path; and, in Settings, a
// connection's options set with an Undo, its list asked for again, and
// Disconnect, which asks first. Nothing typed stays once it's connected.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankForm,
  type ConnectionsModel,
  connectionsReplied,
  connectState,
  formOf,
  initConnections,
  offered,
  openOf,
  settingOf,
  updateConnections,
} from "../src/connections.ts";
import type { Effect, Replied } from "../src/http.ts";
import type { ConnectStep } from "../src/view.ts";
import { connectionView, connectors } from "../testing.ts";

const steps = connectors.jira?.connect?.steps as readonly ConnectStep[];
const typed = { site: "oriel.atlassian.net", email: "pm@example.com", token: "pasted" };
const replied = (tag: Replied["tag"], ok: boolean, body: unknown): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});
const loaded = (connectable: string[] = ["jira", "folder"], picker = false): ConnectionsModel =>
  connectionsReplied(
    initConnections(),
    replied({ kind: "connections" }, true, { connections: [], connectable, refused: {}, picker }),
  ).model;
const post = (url: string, body: unknown, tag: Replied["tag"]): Effect => ({
  type: "http",
  method: "POST",
  url,
  body,
  tag,
});

function filled(model = loaded()): ConnectionsModel {
  for (const [field, value] of Object.entries(typed))
    [model] = updateConnections(model, { type: "fieldChanged", kind: "jira", field, value });
  return model;
}

test("a fields step lists the pick step's choices once every field is typed, and connects the one picked", () => {
  assert.deepEqual(
    updateConnections(loaded(), { type: "nextClicked", kind: "jira", steps })[1],
    [],
  );
  const [listing, effects] = updateConnections(filled(), {
    type: "nextClicked",
    kind: "jira",
    steps,
  });
  assert.deepEqual(effects, [
    post(
      "/api/connections/pick",
      { kind: "jira", given: typed, query: "" },
      { kind: "connectChoices", of: "jira" },
    ),
  ]);
  assert.deepEqual(updateConnections(listing, { type: "nextClicked", kind: "jira", steps })[1], []);
  // A refusal names its fields, and what was typed stays.
  const refused = connectionsReplied(
    listing,
    replied({ kind: "connectChoices", of: "jira" }, false, {
      error: "No.",
      fields: ["email", "token"],
    }),
  ).model;
  const form = formOf(refused, "jira");
  assert.deepEqual(
    [form.problem, form.fields, form.pending, form.typed, form.step],
    ["No.", ["email", "token"], null, typed, 0],
  );
  // The list picks the likeliest, which the source's list puts first, and
  // moves to the pick step.
  const choices = [
    { value: "OA", name: "Oriel", count: 42, updatedAt: "2026-11-01T09:00:00.000Z" },
    { value: "SYN", name: "Synthetic", count: 130, updatedAt: "2026-10-01T09:00:00.000Z" },
  ];
  const listed = connectionsReplied(
    listing,
    replied({ kind: "connectChoices", of: "jira" }, true, { choices, more: false }),
  ).model;
  assert.deepEqual([formOf(listed, "jira").step, formOf(listed, "jira").picked], [1, "OA"]);
  // Narrowing the list stays on the pick step.
  const [narrowing] = updateConnections(listed, {
    type: "queryChanged",
    kind: "jira",
    steps,
    query: "syn",
  });
  const narrowed = connectionsReplied(
    narrowing,
    replied({ kind: "connectChoices", of: "jira" }, true, { choices: [choices[1]], more: false }),
  ).model;
  assert.deepEqual([formOf(narrowed, "jira").step, formOf(narrowed, "jira").picked], [1, "SYN"]);
  const [picked] = updateConnections(listed, { type: "choicePicked", kind: "jira", value: "SYN" });
  const [connecting, connects] = updateConnections(picked, {
    type: "connectClicked",
    kind: "jira",
    steps,
  });
  assert.deepEqual(connects, [
    post(
      "/api/connections",
      { kind: "jira", given: { ...typed, project: "SYN" } },
      { kind: "connected", of: "jira" },
    ),
  ]);
  assert.equal(connectState(connecting, "jira"), "reading");
  const failed = connectionsReplied(
    connecting,
    replied({ kind: "connected", of: "jira" }, false, { error: "Not now." }),
  );
  assert.deepEqual(
    [formOf(failed.model, "jira").problem, connectState(failed.model, "jira"), failed.synced],
    ["Not now.", "failed", false],
  );
  // Back goes to the fields, as typed.
  const [back] = updateConnections(failed.model, { type: "backClicked", kind: "jira" });
  assert.deepEqual(
    [formOf(back, "jira").step, formOf(back, "jira").choices, formOf(back, "jira").typed],
    [0, null, typed],
  );
  // Once connected, nothing typed is kept, and the connection shows.
  const connection = connectionView({ options: { project: "SYN" }, items: 130 });
  const made = connectionsReplied(
    connecting,
    replied({ kind: "connected", of: "jira" }, true, { connection }),
  );
  assert.deepEqual(
    [formOf(made.model, "jira"), openOf(made.model, "jira"), made.synced],
    [blankForm, connection, true],
  );
  assert.equal(connectState(made.model, "jira"), "read");
});

test("a folder step asks the system's picker once, and a cancel there changes nothing", () => {
  const [pending, effects] = updateConnections(loaded(["folder"], true), {
    type: "chooseClicked",
    kind: "folder",
  });
  assert.deepEqual(effects, [
    post("/api/connections/picker", { kind: "folder" }, { kind: "connectPicked", of: "folder" }),
  ]);
  assert.equal(connectState(pending, "folder"), "reading");
  assert.deepEqual(updateConnections(pending, { type: "chooseClicked", kind: "folder" })[1], []);
  const cancelled = connectionsReplied(
    pending,
    replied({ kind: "connectPicked", of: "folder" }, true, { picked: false }),
  );
  assert.deepEqual(
    [
      formOf(cancelled.model, "folder").pending,
      openOf(cancelled.model, "folder"),
      cancelled.synced,
    ],
    [null, null, false],
  );
  const refused = connectionsReplied(
    pending,
    replied({ kind: "connectPicked", of: "folder" }, false, { error: "That's a file." }),
  ).model;
  assert.equal(connectState(refused, "folder"), "failed");
});

test("a folder step's typed path connects as what the step gave", () => {
  const folderSteps = connectors.folder?.connect?.steps as readonly ConnectStep[];
  const [typing] = updateConnections(loaded(), {
    type: "fieldChanged",
    kind: "folder",
    field: "path",
    value: "~/notes",
  });
  const [, effects] = updateConnections(typing, {
    type: "nextClicked",
    kind: "folder",
    steps: folderSteps,
  });
  assert.deepEqual(effects, [
    post(
      "/api/connections",
      { kind: "folder", given: { path: "~/notes" } },
      { kind: "connected", of: "folder" },
    ),
  ]);
});

test("the first run offers the connectors that declare it, in their order", () => {
  assert.deepEqual(
    offered(connectors).map((connector) => connector.kind),
    ["jira", "folder"],
  );
});

test("in Settings, an option applies at once with an Undo, and Disconnect asks first", () => {
  const id = "01JBZ0000000000000000000K1";
  const model = connectionsReplied(
    initConnections(),
    replied({ kind: "connections" }, true, {
      connections: [connectionView({ id })],
      connectable: [],
      refused: {},
      picker: false,
    }),
  ).model;
  const [setting, effects] = updateConnections(model, {
    type: "configured",
    connection: id,
    options: { every: 15 },
    what: "how often it syncs",
    field: "every",
  });
  assert.deepEqual(effects, [
    post(
      `/api/connections/${id}/options`,
      { options: { every: 15 } },
      { kind: "configured", connection: id },
    ),
  ]);
  // One at a time.
  assert.deepEqual(
    updateConnections(setting, {
      type: "configured",
      connection: id,
      options: { name: "Ours" },
      what: "its name",
      field: "name",
    })[1],
    [],
  );
  const undo = { action: "source.configure", input: { connection: id, options: { every: null } } };
  const set = connectionsReplied(
    setting,
    replied({ kind: "configured", connection: id }, true, { connection: {}, undo }),
  );
  assert.deepEqual(
    [settingOf(set.model, id).said, set.synced],
    [{ what: "how often it syncs", field: "every", undo }, true],
  );
  const [, undoing] = updateConnections(set.model, { type: "undoClicked", connection: id });
  assert.deepEqual(undoing, [
    post("/api/actions/source.configure", undo.input, { kind: "configureUndone", connection: id }),
  ]);
  // A refusal says why, and nothing is said set.
  const refused = connectionsReplied(
    setting,
    replied({ kind: "configured", connection: id }, false, { error: "No such project." }),
  ).model;
  assert.deepEqual(
    [settingOf(refused, id).problem, settingOf(refused, id).said],
    ["No such project.", null],
  );
  // Disconnect asks first; only Yes sends it.
  assert.deepEqual(
    updateConnections(model, { type: "disconnectAnswered", connection: id, yes: true })[1],
    [],
  );
  const [asked] = updateConnections(model, { type: "disconnectClicked", connection: id });
  const [cancelled] = updateConnections(asked, {
    type: "disconnectAnswered",
    connection: id,
    yes: false,
  });
  assert.equal(settingOf(cancelled, id).disconnect, null);
  const [, disconnects] = updateConnections(asked, {
    type: "disconnectAnswered",
    connection: id,
    yes: true,
  });
  assert.deepEqual(disconnects, [
    post(`/api/connections/${id}/disconnect`, {}, { kind: "disconnected", connection: id }),
  ]);
  // Settings asks the connection's own list again, by its ID only.
  assert.deepEqual(
    updateConnections(model, { type: "choicesAsked", connection: id, query: "" })[1],
    [
      post(
        `/api/connections/${id}/pick`,
        { query: "" },
        { kind: "connectionChoices", connection: id },
      ),
    ],
  );
});

test("in Settings, options that don't fit their source say why beside the option, with the Undo that puts the old ones back", () => {
  const id = "01JBZ0000000000000000000K3";
  const model = connectionsReplied(
    initConnections(),
    replied({ kind: "connections" }, true, {
      connections: [connectionView({ id, kind: "slack", options: { channels: ["launch"] } })],
      connectable: [],
      refused: {},
      picker: false,
    }),
  ).model;
  const [setting] = updateConnections(model, {
    type: "configured",
    connection: id,
    options: { channels: ["lanuch"] },
    what: "its channels",
    field: "channels",
  });
  const undo = {
    action: "source.configure",
    input: { connection: id, options: { channels: ["launch"] } },
  };
  const unfit = connectionsReplied(
    setting,
    replied({ kind: "configured", connection: id }, true, {
      connection: connectionView({ id, kind: "slack", state: "waiting" }),
      undo,
      problem: "Slack has no channel #lanuch.",
    }),
  ).model;
  assert.deepEqual(
    [settingOf(unfit, id).said, settingOf(unfit, id).problem],
    [{ what: "its channels", field: "channels", undo }, "Slack has no channel #lanuch."],
  );
  // One click puts the old channels back.
  const [undoing, effects] = updateConnections(unfit, { type: "undoClicked", connection: id });
  assert.deepEqual(effects, [
    post("/api/actions/source.configure", undo.input, { kind: "configureUndone", connection: id }),
  ]);
  const undone = connectionsReplied(
    undoing,
    replied({ kind: "configureUndone", connection: id }, true, { undo: null }),
  ).model;
  assert.deepEqual([settingOf(undone, id).said, settingOf(undone, id).problem], [null, null]);
});
