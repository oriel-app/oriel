// Connecting Google Sheets in the window (decisions 0050 and 0051), against
// the Sheets fixture's stand-in for Google: the sign-in begun by the server,
// on Google's page through a loopback redirect, never with the page's
// state in a command line; the connection named by the account's email,
// waiting for its options; Oriel's guess and the agent's draft, each drawn
// from the sheet; the draft applied, with its letters turned into headers;
// and the connection waiting again once a mapped column is renamed.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { fixtureGoogle, loadSheetsFixture, scope, standInToken } from "@oriel/sheets";
import type { OptionsReviewView, ReviewRedrawn, ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

// Made-up values; none is a real client or token.
const client = {
  GOOGLE_CLIENT_ID: "fake-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "fake-secret",
};
const fixture = loadSheetsFixture();
const idOf = (slug: string) => fixture.spreadsheets.find((s) => s.slug === slug)?.id ?? "";
const tracker = idOf("tracker");
const raid = idOf("raid");

// Google: the stand-in for Drive and Sheets, and a token endpoint that
// grants the stand-in's token, for an hour or as `token` says, or refuses
// a refresh once `token.refuses`.
function google() {
  const standIn = fixtureGoogle(fixture);
  const token = { seconds: 3599, refuses: false };
  const send: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://oauth2.googleapis.com/token") {
      const refreshing =
        new URLSearchParams(String(init?.body)).get("grant_type") === "refresh_token";
      if (refreshing && token.refuses)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({
        access_token: standInToken,
        expires_in: token.seconds,
        refresh_token: "fake-refresh-token",
        scope,
      });
    }
    return standIn.fetch(input, init);
  };
  return { standIn, send, token };
}

// Drafts the tracker's first tab by letter, from the preview it read.
const drafting: Script = async (bindings) => {
  const waiting = (await bindings.read("source.preview", [])).value as {
    connection: string;
    tables: { at?: string }[];
  }[];
  const connection = waiting[0]?.connection;
  return {
    value: waiting[0]?.tables.map((table) => table.at),
    drafts: [
      [
        "source.configure",
        [
          {
            connection,
            options: {
              tabs: [
                {
                  at: `${tracker}/1100`,
                  header: 1,
                  end: "blank",
                  hidden: false,
                  key: "A",
                  title: "C",
                  status: "D",
                  states: {
                    todo: ["To do"],
                    "in-progress": ["In progress", "Blocked"],
                    done: ["Done"],
                  },
                  assignee: "E",
                },
              ],
            },
          },
        ],
      ],
    ],
  };
};

// Asked to change a tab of a connection that reads (OA-232): its options,
// as preview() gives them, by letter, with the tracker's tab changed as
// `fix` says, by default its key moved to its ID column, and every other
// tab kept.
let fix = (tab: { key: string }): object => ({ ...tab, key: "A" });
const fixing: Script = async (bindings) => {
  const [reads] = (await bindings.read("source.preview", [])).value as {
    connection: string;
    why: string;
    options: { tabs: { at: string; key: string }[] };
    tables: { at?: string }[];
  }[];
  const tabs = reads?.options.tabs.map((tab) => (tab.at === `${tracker}/1100` ? fix(tab) : tab));
  return {
    value: { why: reads?.why, first: reads?.tables[0]?.at, tabs: reads?.options.tabs.length },
    drafts: [["source.configure", [{ connection: reads?.connection, options: { tabs } }]]],
  };
};

async function sheetsApp(t: TestContext, options: { clients?: false } = {}) {
  const { standIn, send, token } = google();
  const turns: string[] = [];
  const it = await testApp(t, {
    sources: { sheets: { mode: "window", fetch: send } },
    ...(options.clients === false ? {} : { clients: { sheets: client } }),
    plan: (input) => {
      turns.push(input.text);
      return input.text.startsWith("Draft how")
        ? [{ run: "draft" }, { text: "Drafted." }]
        : input.text.startsWith("Draft a change")
          ? [{ run: "fix" }, { text: "Drafted." }]
          : [{ text: "Hi." }];
    },
    scripts: { draft: drafting, fix: fixing },
  });
  return { ...it, standIn, token, turns };
}

// The person's browser, following Google's page back to the redirect.
async function finish(url: string, picked: string[]) {
  const authorize = new URL(url);
  const back = new URL(authorize.searchParams.get("redirect_uri") ?? "");
  back.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  back.searchParams.set("code", "4/fake-code");
  back.searchParams.set("scope", scope);
  back.searchParams.set("picked_file_ids", picked.join(","));
  await (await fetch(back)).text();
}

async function connected(it: Awaited<ReturnType<typeof sheetsApp>>) {
  const begun = json<{ url: string; attempt: string }>(
    await it.post("/api/connections/browser", { kind: "sheets" }),
  );
  assert.equal(new URL(begun.url).origin, "https://accounts.google.com");
  assert.equal(JSON.stringify(begun).includes("verifier"), false);
  const [reply] = await Promise.all([
    it.connect("sheets", { attempt: begun.attempt }),
    finish(begun.url, [tracker, raid]),
  ]);
  assert.equal(reply.status, 200, String(reply.body));
  const sheets = await it.connection("sheets");
  assert.ok(sheets);
  return sheets;
}

test("Google Sheets connects through Google's page and waits, named by the account, for its mapping", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  assert.equal(sheets.state, "waiting");
  assert.equal(sheets.name, fixture.user.emailAddress);
  assert.equal(sheets.identity, fixture.user.permissionId);
  // Its spreadsheets are items already; none of their rows is.
  assert.equal(sheets.items, 2);
  // Nothing the sign-in gave reaches the page.
  const listed = JSON.stringify(json(await it.get("/api/connections")));
  assert.equal(listed.includes(standInToken), false);
  assert.equal(listed.includes("fake-refresh-token"), false);
  // A sign-in's ID finishes it once.
  assert.equal((await it.connect("sheets", { attempt: "0".repeat(32) })).status, 400);
});

test("its review shows Oriel's guess, then the agent's draft, each drawn from the sheet, and applying it reads the rows", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  const review = async () =>
    json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  const before = await review();
  assert.equal(before.waits, true);
  assert.equal(before.draft, null);
  const guessed = before.guess?.tables.find((table) => table.name.endsWith("› Tracker"));
  assert.deepEqual(
    guessed?.columns.find((column) => column.feeds !== null),
    {
      at: "C",
      header: "Story",
      feeds: "Row ID and Title",
    },
  );

  // The onboarding turn: one, from the connector's own words.
  const started = json<{ thread: string }>(await it.post(`/api/connections/${sheets.id}/draft`));
  await it.app.settled();
  assert.deepEqual(it.turns, ["Draft how Oriel should read the spreadsheets just picked."]);
  assert.deepEqual(json(await it.post(`/api/connections/${sheets.id}/draft`)), { thread: null });
  const drafted = await review();
  assert.equal(drafted.draft?.thread, started.thread);
  assert.equal(drafted.drafting, null);
  const sheet = drafted.draft?.tables.find((table) => table.name.endsWith("› Tracker"));
  assert.deepEqual(sheet?.columns.slice(0, 5), [
    { at: "A", header: "ID", feeds: "Row ID" },
    { at: "B", header: "Epic", feeds: null },
    { at: "C", header: "Story", feeds: "Title" },
    { at: "D", header: "Status", feeds: "Status" },
    { at: "E", header: "Owner", feeds: "Assignee" },
  ]);
  // The thread's draft card is drawn the same way.
  const view = json<ThreadView>(await it.get(`/api/threads/${started.thread}`));
  const card = view.entries.find((entry) => entry.kind === "draft");
  assert.ok(card?.kind === "draft");
  assert.deepEqual(card.tables, drafted.draft?.tables);

  // Applied, the letters are the headers above them, and its rows read.
  const applied = await it.post(
    `/api/threads/${started.thread}/held/${drafted.draft?.seq ?? 0}/apply`,
    {},
  );
  assert.equal(applied.status, 200, String(applied.body));
  const read = await it.connection("sheets");
  assert.equal(read?.state, "open");
  assert.ok((read?.items ?? 0) > 2);
  const spreadsheets = read?.options["spreadsheets"] as { id: string; tabs: unknown[] }[];
  assert.deepEqual(spreadsheets.find((s) => s.id === tracker)?.tabs, [
    {
      sheetId: 1100,
      header: 1,
      end: "blank",
      hidden: false,
      states: { todo: ["To do"], "in-progress": ["In progress", "Blocked"], done: ["Done"] },
      key: "ID",
      title: "Story",
      status: "Status",
      assignee: "Owner",
    },
  ]);
  assert.equal((await review()).waits, false);

  // A mapped column renamed: its sync stops, names it, and the connection
  // waits for a mapping that fits.
  it.standIn.change(tracker, { kind: "set", sheetId: 1100, cell: "D1", value: "Stage" });
  assert.equal((await it.sync("sheets")).status, 200);
  const waits = await it.connection("sheets");
  assert.equal(waits?.state, "waiting");
  assert.match(waits?.problem ?? "", /the status column, "Status", isn't in the header row/);
  // Settings still sums up what it read, to fix by asking or by hand, not
  // the onboarding's guess (OA-232).
  const broken = await review();
  assert.equal(broken.guess, null);
  assert.ok(broken.outline?.some((entry) => entry.reads?.includes("Status: “Status”")));
});

test("Oriel's guess applies as the person's own options, with no draft", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  const before = json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  assert.ok(before.guess);
  const set = await it.post(`/api/connections/${sheets.id}/options`, {
    options: before.guess.options,
  });
  assert.equal(set.status, 200, String(set.body));
  assert.equal((await it.connection("sheets"))?.state, "open");
});

test("without Oriel's Google client, the window says why it can't connect Google Sheets", async (t) => {
  const it = await sheetsApp(t, { clients: false });
  const listed = json<{ connectable: string[]; refused: Record<string, string> }>(
    await it.get("/api/connections"),
  );
  assert.equal(listed.connectable.includes("sheets"), false);
  assert.match(listed.refused["sheets"] ?? "", /Google sign-in.*Set GOOGLE_CLIENT_ID in \.env\./);
  assert.equal((await it.post("/api/connections/browser", { kind: "sheets" })).status, 400);
});

test("the first mapping's Undo puts back the spreadsheets just picked, and the connection waits again", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  const { guess } = json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  const set = json<{ undo: { input: unknown } }>(
    await it.post(`/api/connections/${sheets.id}/options`, { options: guess?.options }),
  );
  assert.equal((await it.connection("sheets"))?.state, "open");
  const undone = await it.post("/api/actions/source.configure", set.undo.input);
  assert.equal(undone.status, 200, String(undone.body));
  assert.equal((await it.connection("sheets"))?.state, "waiting");
});

test("a sheet fixed and asked again is read afresh, not from the preview the review read before", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  const header = async (fresh: boolean) => {
    const review = json<OptionsReviewView>(
      await it.get(`/api/connections/${sheets.id}/review${fresh ? "?fresh=1" : ""}`),
    );
    return review.guess?.tables.find((table) => table.name.endsWith("› Tracker"))?.columns[2]
      ?.header;
  };
  assert.equal(await header(false), "Story");
  it.standIn.change(tracker, { kind: "set", sheetId: 1100, cell: "C1", value: "User story" });
  assert.equal(await header(false), "Story");
  assert.equal(await header(true), "User story");
});

test("a connection Google signs out reads as signed out, and signing in again keeps its mapping and items", async (t) => {
  const it = await sheetsApp(t);
  // Tokens that last a minute are refreshed at every read.
  it.token.seconds = 60;
  const sheets = await connected(it);
  const { guess } = json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  await it.post(`/api/connections/${sheets.id}/options`, { options: guess?.options });
  const mapped = await it.connection("sheets");
  assert.equal(mapped?.state, "open");

  it.token.refuses = true;
  assert.notEqual((await it.sync("sheets")).status, 200);
  assert.equal((await it.connection("sheets"))?.state, "signed-out");

  it.token.refuses = false;
  const again = await connected(it);
  assert.deepEqual(
    [again.id, again.state, again.options, again.items, again.problem],
    [mapped?.id, "open", mapped?.options, mapped?.items, null],
  );
});

test("Settings sums up a connection's tables, edits one by hand as it reads now, and a new key, said before it applies, makes every row a new item, with an Undo", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  const review = async (tab?: string) =>
    json<OptionsReviewView>(
      await it.get(
        `/api/connections/${sheets.id}/review${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`,
      ),
    );
  const { guess } = await review();
  await it.post(`/api/connections/${sheets.id}/options`, { options: guess?.options });
  assert.equal((await it.connection("sheets"))?.state, "open");

  // Read, each of its tables is a line, by its headers, from their names
  // alone; nothing is drawn until a table is edited by hand.
  const at = `${tracker}/1100`;
  const summed = await review();
  assert.deepEqual(
    [summed.waits, summed.guess, summed.draft, summed.current],
    [false, null, null, null],
  );
  assert.deepEqual(
    summed.outline?.find((entry) => entry.at === at),
    { at, name: "Ferrowick delivery tracker › Tracker", reads: "Row ID and title: “Story”" },
  );
  // Every tab of both spreadsheets, read or not.
  const tabs = fixture.spreadsheets
    .filter((s) => s.id === tracker || s.id === raid)
    .flatMap((s) => s.tabs.map((tab) => `${s.id}/${tab.sheetId}`));
  assert.deepEqual(summed.outline?.map((entry) => entry.at).toSorted(), tabs.toSorted());
  // A table that isn't this connection's is refused.
  assert.equal((await it.get(`/api/connections/${sheets.id}/review?tab=a%20b`)).status, 400);

  // Edited by hand, its review step draws that table as it reads, by letter.
  const shown = await review(at);
  assert.deepEqual(
    shown.current?.tables.map((table) => table.at),
    [at],
  );
  const tab = shown.current?.tables.find((table) => table.at === at);
  assert.deepEqual(tab?.reads, {
    header: 1,
    end: "blank",
    hidden: false,
    fields: { key: "C", title: "C" },
  });
  assert.deepEqual(
    shown.fields.filter((field) => field.required).map((field) => field.name),
    ["key", "title"],
  );

  // A workstream holds one of its rows.
  const story = "Keep the fare on a later sailing the same day";
  const rowOf = () =>
    it.app
      .window("epic")
      .clusters.flatMap((cluster) => cluster.list)
      .find((row) => row.title === story);
  const held = rowOf();
  assert.ok(held);
  const made = json<{ id: string }>(
    await it.post("/api/workstreams", { kind: "picked", name: "Rebooking", items: [held.id] }),
  );

  // Edited a change at a time, each drawn again from the sheet: the
  // status and owner columns, then a new key, which says what it does.
  const redraw = async (given: unknown, edit: Record<string, unknown>) => {
    const reply = await it.post(`/api/connections/${sheets.id}/review`, {
      given,
      edit: { table: at, ...edit },
    });
    assert.equal(reply.status, 200, String(reply.body));
    return json<ReviewRedrawn>(reply);
  };
  const status = await redraw(shown.current?.given, { field: "status", column: "D" });
  assert.equal(status.problem, null);
  assert.deepEqual(status.said, []);
  const rekeyed = await redraw(status.given, { field: "key", column: "A" });
  assert.equal(rekeyed.problem, null);
  assert.equal(rekeyed.said.length, 1);
  assert.match(
    rekeyed.said[0] ?? "",
    /^Changing the row ID column of .+ › Tracker makes every row a new item\./,
  );
  // An edit Oriel can't make is refused, and nothing is kept.
  const refused = await it.post(`/api/connections/${sheets.id}/review`, {
    given: status.given,
    edit: { table: at, field: "title", column: null },
  });
  assert.equal(refused.status, 400);
  assert.deepEqual((await review(at)).current, shown.current);

  // Applied as the person's own options: the row held is a new item, and
  // the workstream keeps the old one as an item Oriel no longer has.
  const set = await it.post(`/api/connections/${sheets.id}/options`, {
    options: rekeyed.options,
  });
  assert.equal(set.status, 200, String(set.body));
  const now = rowOf();
  assert.ok(now);
  assert.notEqual(now.id, held.id);
  const workstream = json<{ members: { ref: { id: string }; row: unknown }[] }>(
    await it.get(`/api/workstreams/${made.id}`),
  );
  assert.deepEqual(
    workstream.members.map((member) => [member.ref.id, member.row]),
    [[held.id, null]],
  );
  assert.deepEqual(
    (await review(at)).current?.tables.find((table) => table.at === at)?.reads?.fields,
    { key: "A", title: "C", status: "D" },
  );
  assert.equal(
    (await review()).outline?.find((entry) => entry.at === at)?.reads,
    "Row ID: “ID” · Title: “Story” · Status: “Status”",
  );

  // Its Undo puts the old mapping back, and the old item with it.
  const { undo } = json<{ undo: { input: unknown } }>(set);
  assert.equal((await it.post("/api/actions/source.configure", undo.input)).status, 200);
  assert.equal(rowOf()?.id, held.id);
});

test("the agent's draft, edited in the review step, applies as the person edited it", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  await it.post(`/api/connections/${sheets.id}/draft`);
  await it.app.settled();
  const { draft } = json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  assert.ok(draft);
  const edited = json<ReviewRedrawn>(
    await it.post(`/api/connections/${sheets.id}/review`, {
      given: draft.given,
      edit: { table: `${tracker}/1100`, field: "assignee", column: null },
    }),
  );
  assert.equal(edited.problem, null);
  // Nothing synced yet goes.
  assert.deepEqual(edited.said, []);
  const applied = await it.post(`/api/threads/${draft.thread}/held/${draft.seq}/apply`, {
    edit: { options: edited.given },
  });
  assert.equal(applied.status, 200, String(applied.body));
  const spreadsheets = (await it.connection("sheets"))?.options["spreadsheets"] as {
    id: string;
    tabs: Record<string, unknown>[];
  }[];
  const tab = spreadsheets.find((s) => s.id === tracker)?.tabs[0];
  assert.deepEqual(
    [tab?.["title"], tab?.["status"], tab?.["assignee"]],
    ["Story", "Status", undefined],
  );
  assert.ok(
    it.app.telemetry().some((event) => event.name === "draft.applied" && event.data["edited"]),
  );
});

test("Ask Oriel about a tab drafts a change in the window chat, from fixed words naming it by ID, and the card says what it does before it applies", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  const { guess } = json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  await it.post(`/api/connections/${sheets.id}/options`, { options: guess?.options });
  const guessed = (guess?.given["tabs"] ?? []) as unknown[];
  const at = `${tracker}/1100`;
  // Only one of its own tables, by its place.
  assert.equal((await it.post(`/api/connections/${sheets.id}/draft`, { tab: "x/1" })).status, 400);
  assert.equal(
    (await it.post(`/api/connections/${sheets.id}/draft`, { tab: "Tracker" })).status,
    400,
  );
  const asked = json<{ thread: string }>(
    await it.post(`/api/connections/${sheets.id}/draft`, { tab: at }),
  );
  await it.app.settled();
  // The person's words are Oriel's, naming the tab by ID, nothing synced.
  assert.deepEqual(it.turns.at(-1), `Draft a change to how Oriel reads the tab at ${at}.`);
  const view = json<ThreadView>(await it.get(`/api/threads/${asked.thread}`));
  const run = view.entries.find((entry) => entry.kind === "run.finished");
  assert.ok(run?.kind === "run.finished");
  // preview() says it reads, gives its options by letter, and reads the
  // asked tab first.
  assert.deepEqual(JSON.parse(run.run.returned ?? "null"), {
    why: "It reads with these options. Draft a change only when the user asks.",
    first: at,
    tabs: guessed.length,
  });
  // The card draws only the tab it changes, and says what applying does.
  const card = view.entries.find((entry) => entry.kind === "draft");
  assert.ok(card?.kind === "draft");
  assert.deepEqual(
    card.tables?.map((table) => table.at),
    [at],
  );
  assert.equal(card.said.length, 1);
  assert.match(
    card.said[0] ?? "",
    /^Changing the row ID column of .+ › Tracker makes every row a new item\./,
  );
  const applied = await it.post(`/api/threads/${asked.thread}/held/${card.seq}/apply`, {});
  assert.equal(applied.status, 200, String(applied.body));
  const spreadsheets = (await it.connection("sheets"))?.options["spreadsheets"] as {
    id: string;
    tabs: Record<string, unknown>[];
  }[];
  // That tab's key is its ID column now, and every other tab still reads.
  const read = spreadsheets.flatMap((s) => s.tabs);
  assert.equal(read.length, guessed.length);
  assert.equal(
    spreadsheets.find((s) => s.id === tracker)?.tabs.find((tab) => tab["sheetId"] === 1100)?.[
      "key"
    ],
    "ID",
  );
});

test("a draft that changes only which status values mean which state still draws its table", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  await it.post(`/api/connections/${sheets.id}/draft`);
  await it.app.settled();
  const { draft } = json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  assert.ok(draft);
  await it.post(`/api/threads/${draft.thread}/held/${draft.seq}/apply`, {});
  fix = (tab) => ({
    ...tab,
    states: { todo: ["To do", "Blocked"], "in-progress": ["In progress"], done: ["Done"] },
  });
  t.after(() => {
    fix = (tab) => ({ ...tab, key: "A" });
  });
  const asked = json<{ thread: string }>(
    await it.post(`/api/connections/${sheets.id}/draft`, { tab: `${tracker}/1100` }),
  );
  await it.app.settled();
  const view = json<ThreadView>(await it.get(`/api/threads/${asked.thread}`));
  const card = view.entries.findLast((entry) => entry.kind === "draft");
  assert.ok(card?.kind === "draft");
  assert.deepEqual(
    card.tables?.map((table) => table.at),
    [`${tracker}/1100`],
  );
  assert.ok(card.tables?.[0]?.lines.some((line) => /To do, Blocked are to do/.test(line)));
  assert.deepEqual(card.said, []);
});

test("a waiting connection of a kind turned off offers no preview, so nothing reads its source", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  assert.equal(sheets.state, "waiting");
  assert.equal((await it.post("/api/actions/source.off", { kind: "sheets" })).status, 200);
  const reply = await it.post("/api/window-chat/messages", {
    text: "Draft how Oriel should read the spreadsheets.",
  });
  await it.app.settled();
  const view = json<ThreadView>(await it.get(`/api/threads/${json<{ id: string }>(reply).id}`));
  assert.ok(!view.entries.some((e) => e.kind === "draft" || e.kind === "block"));
  // Nor does its review step, even asked for fresh.
  const asked = it.standIn.calls.length;
  assert.equal((await it.get(`/api/connections/${sheets.id}/review?fresh=1`)).status, 409);
  assert.equal(it.standIn.calls.length, asked);
});
