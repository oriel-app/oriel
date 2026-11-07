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
  noAiToAsk,
  offered,
  openOf,
  settingOf,
  standingIn,
  updateConnections,
} from "../src/connections.ts";
import type { Effect, Replied } from "../src/http.ts";
import type { ConnectStep } from "../src/view.ts";
import { connectionView, connectors, serversView } from "../testing.ts";

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
    offered(connectors, initConnections()).map((connector) => connector.kind),
    ["jira", "folder"],
  );
});

test("the first run offers none a stand-in on stands in for, and the stand-in in their place", () => {
  const tracker = {
    ...connectors.jira!,
    kind: "tracker",
    connect: null,
    standIn: { for: ["jira"], offer: connectors.jira!.connect!.offer },
  };
  const model: ConnectionsModel = {
    ...initConnections(),
    view: {
      connections: [],
      connectable: [],
      refused: {},
      picker: false,
      standingIn: ["tracker"],
      servers: serversView(),
    },
  };
  const all = { ...connectors, tracker };
  assert.deepEqual(
    offered(all, model).map((connector) => connector.kind),
    ["folder"],
  );
  assert.deepEqual(
    standingIn(all, model).map((connector) => connector.kind),
    ["tracker"],
  );
  // Off, it stands in for nothing.
  assert.deepEqual(
    offered(all, initConnections()).map((connector) => connector.kind),
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

// A connector that signs in on its source's page, then reviews the options
// Oriel or the agent drafts (decisions 0050 and 0051), as Google Sheets does.
const signingIn: readonly ConnectStep[] = [
  {
    kind: "browser",
    label: "Sign in",
    title: "Connect it",
    lede: "Sign in.",
    consent: "Oriel reads only what you pick.",
    go: "Continue",
    waiting: "Finish there.",
  },
  {
    kind: "review",
    label: "Review",
    title: "How Oriel reads it",
    lede: "Apply it.",
    reading: "Reading the headers",
    ask: "Draft how Oriel should read it.",
    fix: "Draft a change to how Oriel reads the tab at {at}.",
  },
];
const id = "01JBZ0000000000000000000S1";
const get = (url: string, tag: Replied["tag"]): Effect => ({
  type: "http",
  method: "GET",
  url,
  tag,
});

test("a browser step begins its sign-in as it shows, and connects once the person finishes on the source's page", () => {
  const model = loaded(["sheets"]);
  const [starting, begin] = updateConnections(model, { type: "browserShown", kind: "sheets" });
  assert.deepEqual(begin, [
    post("/api/connections/browser", { kind: "sheets" }, { kind: "browserBegun", of: "sheets" }),
  ]);
  // Showing again while it begins asks nothing more.
  assert.deepEqual(updateConnections(starting, { type: "browserShown", kind: "sheets" })[1], []);
  const signIn = { url: "https://accounts.google.com/o/oauth2/v2/auth?state=s", attempt: "a1" };
  const begun = connectionsReplied(
    starting,
    replied({ kind: "browserBegun", of: "sheets" }, true, signIn),
  ).model;
  assert.deepEqual(formOf(begun, "sheets").signIn, signIn);
  // Following the link connects with the sign-in's ID, never what it gives.
  const [waiting, connect] = updateConnections(begun, {
    type: "browserOpened",
    kind: "sheets",
    steps: signingIn,
  });
  assert.deepEqual(connect, [
    post(
      "/api/connections",
      { kind: "sheets", given: { attempt: "a1" } },
      { kind: "connected", of: "sheets", review: 1 },
    ),
  ]);
  assert.equal(connectState(waiting, "sheets"), "reading");
  // One Google refused begins again on Try again.
  const refused = connectionsReplied(
    waiting,
    replied({ kind: "connected", of: "sheets", review: 1 }, false, { error: "Try again." }),
  ).model;
  assert.deepEqual(
    [formOf(refused, "sheets").signIn, formOf(refused, "sheets").problem],
    [null, "Try again."],
  );

  // Connected and waiting for its options: its review step, and its
  // onboarding turn.
  const made = { ...connectionView(), id, kind: "sheets", state: "waiting" as const };
  const { model: reviewing, effects } = connectionsReplied(
    // A Sync asked for before failed: signing in again puts that behind it.
    { ...waiting, problems: { [id]: "Google Sheets needs signing in again." } },
    replied({ kind: "connected", of: "sheets", review: 1 }, true, { connection: made }),
  );
  assert.deepEqual([formOf(reviewing, "sheets").step, formOf(reviewing, "sheets").made], [1, id]);
  assert.equal(connectState(reviewing, "sheets"), "review");
  assert.deepEqual(reviewing.problems, {});
  assert.deepEqual(effects, [
    post(`/api/connections/${id}/draft`, {}, { kind: "onboarded", of: "sheets", connection: id }),
  ]);
  const onboarded = connectionsReplied(
    reviewing,
    replied({ kind: "onboarded", of: "sheets", connection: id }, true, { thread: "t" }),
  );
  assert.deepEqual(onboarded.effects, [
    get(`/api/connections/${id}/review`, { kind: "reviewed", of: "sheets", connection: id }),
  ]);
});

test("a review step asks again while the agent drafts, and applies its draft, or Oriel's guess, once", () => {
  const steps = updateConnections(loaded(["sheets"]), { type: "opened", kind: "sheets" })[0];
  const reviewing: ConnectionsModel = {
    ...steps,
    forms: { sheets: { ...blankForm, open: true, step: 1, made: id } },
  };
  const guess = { tables: [], options: { spreadsheets: [] } };
  const tag = { kind: "reviewed" as const, of: "sheets", connection: id };
  const drafting = connectionsReplied(
    reviewing,
    replied(tag, true, { waits: true, guess, draft: null, drafting: { thread: "t" } }),
  );
  assert.deepEqual(drafting.effects, [
    {
      type: "after",
      ms: 1500,
      msg: { type: "connections", msg: { type: "reviewAsked", kind: "sheets", connection: id } },
    },
  ]);
  const applied = { kind: "reviewApplied" as const, of: "sheets", connection: id };
  // Oriel's guess applies as the person's own options.
  assert.deepEqual(
    updateConnections(drafting.model, { type: "reviewApplied", kind: "sheets", connection: id })[1],
    [post(`/api/connections/${id}/options`, { options: guess.options }, applied)],
  );
  // The agent's draft applies as the held draft it is.
  const drafted = connectionsReplied(
    drafting.model,
    replied(tag, true, {
      waits: true,
      guess,
      draft: { thread: "t", seq: 4, tables: [] },
      drafting: null,
    }),
  );
  assert.deepEqual(drafted.effects, []);
  const [applying, apply] = updateConnections(drafted.model, {
    type: "reviewApplied",
    kind: "sheets",
    connection: id,
  });
  assert.deepEqual(apply, [post("/api/threads/t/held/4/apply", {}, applied)]);
  assert.deepEqual(
    updateConnections(applying, { type: "reviewApplied", kind: "sheets", connection: id })[1],
    [],
  );
  const done = connectionsReplied(
    applying,
    replied(applied, true, { connection: { ...connectionView(), id, kind: "sheets" } }),
  );
  assert.equal(done.synced, true);
  assert.deepEqual(formOf(done.model, "sheets"), blankForm);
});

// A review step's draft edited (OA-232): begun from what it shows, each
// change drawn again by the server, and applied as the person's own: the
// agent's draft as edited, or the options the edits settle into.
const table = (at: string) => ({
  name: "Tracker",
  at,
  columns: [{ at: "A", header: "ID", feeds: "Row ID and Title" }],
  rows: [],
  lines: [],
  reads: { header: 1, end: "blank" as const, hidden: false, fields: { key: "A", title: "A" } },
});
const fields = [{ name: "key", label: "Key", required: true }];
const redrawn = (given: Record<string, unknown>, said: string[] = []) => ({
  given,
  tables: [table("s/1")],
  options: { spreadsheets: [{ id: "s", tabs: [given] }] },
  said,
  problem: null,
});

test("Settings edits one table by hand, as it reads now, and a change applies only once edited, beside its option, with an Undo", () => {
  const settings = {
    ...loaded(["sheets"]),
    view: {
      ...loaded(["sheets"]).view!,
      connections: [{ ...connectionView(), id, kind: "sheets" }],
    },
  };
  const tag = { kind: "reviewed" as const, of: "sheets", connection: id };
  const outline = [{ at: "s/1", name: "Tracker", reads: "Row ID and title: “ID”" }];
  const summed = {
    waits: false,
    guess: null,
    draft: null,
    drafting: null,
    current: null,
    fields,
    outline,
  };
  const listed = connectionsReplied(settings, replied(tag, true, summed)).model;
  // Summed up, nothing is edited, and nothing applies.
  assert.equal(listed.edits[id], undefined);
  assert.deepEqual(
    updateConnections(listed, {
      type: "reviewApplied",
      kind: "sheets",
      connection: id,
      beside: "spreadsheets",
    })[1],
    [],
  );
  // Edit by hand asks for that table as it reads, and its editor opens on it.
  const [opening, ask] = updateConnections(listed, {
    type: "handEditClicked",
    kind: "sheets",
    connection: id,
    tab: "s/1",
  });
  const byHand = { ...tag, tab: "s/1" };
  assert.deepEqual(ask, [get(`/api/connections/${id}/review?tab=s%2F1`, byHand)]);
  const current = { given: { tabs: [] }, tables: [table("s/1")] };
  const shown = connectionsReplied(opening, replied(byHand, true, { ...summed, current }));
  assert.deepEqual(
    [shown.model.edits[id]?.only, shown.model.edits[id]?.redrawn.given],
    ["s/1", current.given],
  );
  const edit = { table: "s/1", field: "key", column: "A" };
  const editing = shown.model;
  assert.deepEqual(
    updateConnections(editing, {
      type: "reviewApplied",
      kind: "sheets",
      connection: id,
      beside: "spreadsheets",
    })[1],
    [],
  );
  const [asking, asked] = updateConnections(editing, {
    type: "reviewEdited",
    connection: id,
    edit,
  });
  const redraw = { kind: "reviewRedrawn" as const, connection: id };
  assert.deepEqual(asked, [
    post(`/api/connections/${id}/review`, { given: current.given, edit }, redraw),
  ]);
  // One change at a time.
  assert.deepEqual(
    updateConnections(asking, { type: "reviewEdited", connection: id, edit })[1],
    [],
  );
  // A change refused keeps the draft as it was, and says why.
  const refused = connectionsReplied(
    asking,
    replied(redraw, false, { error: "Choose a title column." }),
  ).model;
  assert.deepEqual(
    [refused.edits[id]?.redrawn.given, refused.edits[id]?.redrawn.problem],
    [current.given, "Choose a title column."],
  );
  const said = ["Changing the row ID column of Tracker makes every row a new item. …"];
  const drawn = redrawn({ at: "s/1", key: "A" }, said);
  const ready = connectionsReplied(asking, replied(redraw, true, drawn)).model;
  assert.deepEqual(ready.edits[id]?.redrawn.said, said);
  const applied = {
    kind: "reviewApplied" as const,
    of: "sheets",
    connection: id,
    beside: "spreadsheets",
  };
  const [applying, apply] = updateConnections(ready, {
    type: "reviewApplied",
    kind: "sheets",
    connection: id,
    beside: "spreadsheets",
  });
  // Only the mapping: a switch set meanwhile stays as it was set.
  assert.deepEqual(apply, [
    post(
      `/api/connections/${id}/options`,
      { options: { spreadsheets: drawn.options.spreadsheets } },
      applied,
    ),
  ]);
  // In Settings, never the connect steps' form.
  assert.deepEqual(formOf(applying, "sheets"), formOf(ready, "sheets"));
  assert.deepEqual(settingOf(applying, id).said, {
    what: "its mapping",
    field: "spreadsheets",
    undo: null,
  });
  const undo = { action: "source.configure", input: { connection: id, options: {} } };
  const done = connectionsReplied(
    applying,
    replied(applied, true, { connection: { ...connectionView(), id, kind: "sheets" }, undo }),
  );
  assert.equal(done.synced, true);
  assert.equal(done.model.edits[id], undefined);
  assert.deepEqual(settingOf(done.model, id).said, {
    what: "its mapping",
    field: "spreadsheets",
    undo,
  });
  // Cancel leaves it as it was.
  assert.equal(
    updateConnections(ready, { type: "reviewEditCancelled", connection: id })[0].edits[id],
    undefined,
  );
});

test("the agent's draft, edited, applies as the held draft it is, with the person's edit", () => {
  const steps = updateConnections(loaded(["sheets"]), { type: "opened", kind: "sheets" })[0];
  const reviewing: ConnectionsModel = {
    ...steps,
    forms: { sheets: { ...blankForm, open: true, step: 1, made: id } },
  };
  const tag = { kind: "reviewed" as const, of: "sheets", connection: id };
  const given = { tabs: [{ at: "s/1", key: "A", title: "A" }] };
  const draft = { thread: "t", seq: 4, given, tables: [table("s/1")], said: [] };
  const drafted = connectionsReplied(
    reviewing,
    replied(tag, true, { waits: true, guess: null, draft, drafting: null, current: null, fields }),
  ).model;
  const [editing] = updateConnections(drafted, { type: "reviewEditClicked", connection: id });
  assert.deepEqual(editing.edits[id]?.held, { thread: "t", seq: 4 });
  const edited = { tabs: [{ at: "s/1", key: "A", title: "A", hidden: true }] };
  const ready = connectionsReplied(
    { ...editing, edits: { [id]: { ...editing.edits[id]!, pending: true } } },
    replied({ kind: "reviewRedrawn", connection: id }, true, redrawn(edited)),
  ).model;
  const applied = { kind: "reviewApplied" as const, of: "sheets", connection: id };
  const [applying, apply] = updateConnections(ready, {
    type: "reviewApplied",
    kind: "sheets",
    connection: id,
  });
  assert.deepEqual(apply, [
    post("/api/threads/t/held/4/apply", { edit: { options: edited } }, applied),
  ]);
  assert.equal(formOf(applying, "sheets").pending, "applying");
  const done = connectionsReplied(
    applying,
    replied(applied, true, { connection: { ...connectionView(), id, kind: "sheets" } }),
  );
  assert.deepEqual([formOf(done.model, "sheets"), done.model.edits[id]], [blankForm, undefined]);
});

test("Ask Oriel about a table starts the window chat's turn, which the overview opens on; with no AI, it says to edit by hand", () => {
  const model = loaded(["sheets"]);
  const [, effects] = updateConnections(model, {
    type: "askOrielClicked",
    connection: id,
    tab: "s/1",
  });
  const tag = { kind: "orielAsked" as const, connection: id };
  assert.deepEqual(effects, [post(`/api/connections/${id}/draft`, { tab: "s/1" }, tag)]);
  assert.deepEqual(connectionsReplied(model, replied(tag, true, { thread: "t" })).effects, [
    { type: "navigate", route: { page: "overview" } },
    { type: "after", ms: 0, msg: { type: "chat", msg: { type: "openClicked" } } },
  ]);
  const none = connectionsReplied(model, replied(tag, true, { thread: null }));
  assert.equal(settingOf(none.model, id).problem, noAiToAsk);
});
