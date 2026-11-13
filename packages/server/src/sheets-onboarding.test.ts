import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { loadSheetsFixture } from "@oriel/sheets";
import type { ConnectionView, OptionsReviewView, ReviewRedrawn } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const fixture = loadSheetsFixture();
const idOf = (slug: string) => fixture.spreadsheets.find((s) => s.slug === slug)?.id ?? "";
const tracker = idOf("tracker");
const raid = idOf("raid");

const fix = (tab: { key: string }): object => ({ ...tab, key: "A" });
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

async function sheetsApp(t: TestContext) {
  const turns: string[] = [];
  const it = await testApp(t, {
    jira: false,
    sheetsMcp: true,
    plan: (input) => {
      turns.push(input.text);
      return input.text.startsWith("Draft a change")
        ? [{ run: "fix" }, { text: "Drafted." }]
        : [{ text: "Hi." }];
    },
    scripts: { fix: fixing },
  });
  await it.app.settled();
  return { ...it, turns };
}

async function connected(it: Awaited<ReturnType<typeof sheetsApp>>): Promise<ConnectionView> {
  assert.equal((await it.turnOn("sheets")).status, 200);
  const kept = await it.connection("sheets");
  assert.ok(kept);
  const picked = await it.post(`/api/connections/${kept.id}/options`, {
    options: { spreadsheets: [tracker, raid] },
  });
  assert.equal(picked.status, 200, String(picked.body));
  await it.app.settled();
  const sheets = await it.connection("sheets");
  assert.ok(sheets);
  return sheets;
}

test("Ask Oriel about a tab names it by its ID alone: no words of the sheet reach the agent's turn", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  const { guess } = json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  await it.post(`/api/connections/${sheets.id}/options`, { options: guess?.options });
  const at = `${tracker}/1100`;
  assert.equal((await it.post(`/api/connections/${sheets.id}/draft`, { tab: "x/1" })).status, 400);
  assert.equal(
    (await it.post(`/api/connections/${sheets.id}/draft`, { tab: "Tracker" })).status,
    400,
  );
  assert.equal((await it.post(`/api/connections/${sheets.id}/draft`, { tab: at })).status, 201);
  await it.app.settled();
  const turn = it.turns.at(-1) ?? "";
  assert.ok(turn.includes(at));
  const words = fixture.spreadsheets.flatMap((s) => [s.title, ...s.tabs.map((tab) => tab.title)]);
  // The ID itself may hold a word; nothing else in the turn does.
  const rest = turn.replace(at, "");
  for (const word of words) assert.ok(!rest.includes(word), word);
});

test("a new row ID column's Undo brings back each row's item, and the workstream holding it", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  const at = `${tracker}/1100`;
  const { guess } = json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  await it.post(`/api/connections/${sheets.id}/options`, { options: guess?.options });
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
  const shown = json<OptionsReviewView>(
    await it.get(`/api/connections/${sheets.id}/review?tab=${encodeURIComponent(at)}`),
  );
  const rekeyed = json<ReviewRedrawn>(
    await it.post(`/api/connections/${sheets.id}/review`, {
      given: shown.current?.given,
      edit: { table: at, field: "key", column: "A" },
    }),
  );
  const set = await it.post(`/api/connections/${sheets.id}/options`, { options: rekeyed.options });
  assert.equal(set.status, 200);
  assert.notEqual(rowOf()?.id, held.id);

  const { undo } = json<{ undo: { input: unknown } }>(set);
  assert.equal((await it.post("/api/actions/source.configure", undo.input)).status, 200);
  assert.equal(rowOf()?.id, held.id);
  const workstream = json<{ members: { ref: { id: string }; row: unknown }[] }>(
    await it.get(`/api/workstreams/${made.id}`),
  );
  assert.deepEqual(
    workstream.members.map((member) => [member.ref.id, member.row !== null]),
    [[held.id, true]],
  );
});
