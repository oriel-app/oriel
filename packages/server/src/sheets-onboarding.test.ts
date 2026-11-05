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
import type { OptionsReviewView, ThreadView } from "@oriel/web/view";
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
        : [{ text: "Hi." }];
    },
    scripts: { draft: drafting },
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
      feeds: "Key and Title",
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
    { at: "A", header: "ID", feeds: "Key" },
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
