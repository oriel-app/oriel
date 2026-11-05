import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, type PreviewTable, ulid } from "@oriel/core";
import { sheetsDeclaredFixture } from "./declared-fixture.ts";
import { loadSheetsFixture } from "./fixture.ts";
import { sheetsOptions } from "./mapping.ts";
import { sheetsReview } from "./preview.ts";

const fixture = loadSheetsFixture();
const idOf = (slug: string) => fixture.spreadsheets.find((s) => s.slug === slug)?.id ?? "";
const tracker = idOf("tracker");
const raid = idOf("raid");
const now = instant(new Date(Date.UTC(2026, 10, 3, 9)));
const via = { kept: true, log: () => {}, now: () => now };

// A connection just picked: the tracker and the RAID log, no tab mapped.
const picked = { spreadsheets: [tracker, raid].map((id) => ({ id, tabs: [] })) };
const connection = {
  id: ulid(1, new Uint8Array(10)),
  number: 1,
  prefix: "sheets",
  identity: fixture.user.permissionId,
  options: picked,
  secret: null,
};
const preview = () => sheetsDeclaredFixture.preview?.(connection, via) ?? Promise.resolve([]);
const tableOf = (tables: PreviewTable[], at: string) => {
  const found = tables.find((table) => table.at === at);
  assert.ok(found, at);
  return found;
};

test("a waiting connection's preview is each picked tab's first rows, under their letters, by ID", async () => {
  const tables = await preview();
  assert.deepEqual(
    tables.map((table) => table.at),
    [
      ...fixture.spreadsheets
        .find((s) => s.slug === "tracker")!
        .tabs.map((t) => `${tracker}/${t.sheetId}`),
      ...fixture.spreadsheets
        .find((s) => s.slug === "raid")!
        .tabs.map((t) => `${raid}/${t.sheetId}`),
    ],
  );
  const sheet = tableOf(tables, `${tracker}/1100`);
  assert.deepEqual(sheet.columns.slice(0, 4), ["A", "B", "C", "D"]);
  assert.deepEqual(sheet.rows[0]?.slice(0, 4), ["ID", "Epic", "Story", "Status"]);
  assert.equal(sheet.rows[1]?.[0], "FW-101");
  assert.ok(sheet.rows.length <= 30);
  // A picked spreadsheet with no mapping checks out, and waits.
  assert.equal(sheetsOptions(picked).ok, true);
  assert.equal(sheetsReview.waits(picked), true);
});

// The mapping a person would approve for the tracker's first tab, by
// letter.
const trackerDraft = {
  at: `${tracker}/1100`,
  header: 1,
  end: "blank" as const,
  hidden: false,
  key: "A",
  title: "C",
  status: "D",
  states: { todo: ["To do"], "in-progress": ["In progress", "Blocked"], done: ["Done"] },
  assignee: "E",
  estimate: "F",
  link: "G",
};

test("a draft by letter settles into options naming the headers above them", async () => {
  const tables = await preview();
  const settled = sheetsReview.settle({ tabs: [trackerDraft] }, tables, {
    ...picked,
    readOnly: true,
  });
  assert.ok(!("problem" in settled));
  assert.deepEqual(settled, {
    readOnly: true,
    spreadsheets: [
      {
        id: tracker,
        tabs: [
          {
            sheetId: 1100,
            header: 1,
            end: "blank",
            hidden: false,
            states: trackerDraft.states,
            key: "ID",
            title: "Story",
            status: "Status",
            assignee: "Owner",
            estimate: "Estimate",
            link: "Link",
          },
        ],
      },
      { id: raid, tabs: [] },
    ],
  });
  assert.ok(sheetsOptions(settled).ok);
});

test("a draft maps only the tabs it names, as its card draws them", async () => {
  const tables = await preview();
  const had = sheetsReview.settle({ tabs: [trackerDraft] }, tables, picked);
  assert.ok(!("problem" in had));
  const raidTab = {
    at: `${raid}/4100`,
    header: 1,
    end: "blank",
    hidden: false,
    key: "B",
    title: "C",
  };
  const settled = sheetsReview.settle({ tabs: [raidTab] }, tables, had);
  assert.ok(!("problem" in settled));
  const spreadsheets = settled["spreadsheets"] as { id: string; tabs: unknown[] }[];
  assert.deepEqual(spreadsheets.find((s) => s.id === tracker)?.tabs, []);
  assert.equal(spreadsheets.find((s) => s.id === raid)?.tabs.length, 1);
  assert.equal(sheetsReview.waits(settled), false);
  assert.equal(sheetsReview.waits(picked), true);
});

test("a draft that names what the sheet doesn't show settles into nothing, and says why", async () => {
  const tables = await preview();
  for (const [draft, says] of [
    [{ ...trackerDraft, link: "Z" }, /column Z has no header/],
    [{ ...trackerDraft, header: 31 }, /row 31 isn't in what Oriel read/],
    [{ ...trackerDraft, at: "1NotPickedAtAll000/1100" }, /isn't in the picked spreadsheets/],
  ] as const) {
    const settled = sheetsReview.settle({ tabs: [draft] }, tables, picked);
    assert.ok("problem" in settled);
    assert.match(String(settled.problem), says);
  }
  assert.equal(sheetsReview.draft({ tabs: [{ ...trackerDraft, key: "Story" }] }).ok, false);
});

test("Oriel's guess takes the first row as the header and the first column all present and unique as the key", async () => {
  const tables = await preview();
  const guessed = sheetsReview.guess(tables) as { tabs: Record<string, unknown>[] } | null;
  assert.ok(guessed && sheetsReview.draft(guessed).ok);
  const sheet = guessed.tabs.find((tab) => tab.at === `${tracker}/1100`);
  // The tracker's IDs repeat once and one row has none, so its stories key it.
  assert.deepEqual(sheet, {
    at: `${tracker}/1100`,
    header: 1,
    end: "blank",
    hidden: false,
    key: "C",
    title: "C",
  });
  assert.ok(!("problem" in sheetsReview.settle(guessed, tables, picked)));
});

test("Oriel draws a draft from the sheet: each column's letter, its header and the field it feeds", async () => {
  const tables = await preview();
  const drawn = sheetsReview.draw({ tabs: [trackerDraft] }, tables);
  assert.equal(drawn.length, tables.length);
  const sheet = drawn.find((table) => table.name.endsWith("› Tracker"));
  assert.ok(sheet);
  assert.deepEqual(sheet.columns.slice(0, 4), [
    { at: "A", header: "ID", feeds: "Key" },
    { at: "B", header: "Epic", feeds: null },
    { at: "C", header: "Story", feeds: "Title" },
    { at: "D", header: "Status", feeds: "Status" },
  ]);
  assert.equal(sheet.rows[0]?.[0], "FW-101");
  assert.ok(sheet.lines.some((line) => /first blank row/.test(line)));
  assert.ok(sheet.lines.some((line) => /In progress, Blocked are in progress/.test(line)));
  // The tabs it doesn't map aren't read.
  assert.ok(
    drawn.filter((table) => table !== sheet).every((table) => table.lines[0] === "Not read."),
  );
});

test("a mapped column gone from its header row makes the connection wait for options that fit", async () => {
  const mapped = sheetsReview.settle({ tabs: [trackerDraft] }, await preview(), picked);
  assert.ok(!("problem" in mapped));
  const spreadsheets = (mapped as typeof picked).spreadsheets.map((s) => ({
    ...s,
    tabs: s.tabs.map((tab) => ({ ...(tab as object), status: "Stage" })),
  }));
  const stale = { ...connection, options: { spreadsheets } };
  const opened = await sheetsDeclaredFixture.open(stale, via);
  let cursor: string | null = null;
  for await (const page of opened.source.sync(null)) cursor = page.cursor ?? cursor;
  assert.match(opened.unfit?.() ?? "", /the status column, "Stage", isn't in the header row/);
  // Opened again, as at the next start, its cursor reads that spreadsheet
  // again, so it still waits.
  const reopened = await sheetsDeclaredFixture.open(stale, via);
  for await (const page of reopened.source.sync(cursor)) assert.ok(page);
  assert.match(reopened.unfit?.() ?? "", /"Stage"/);
  const fits = await sheetsDeclaredFixture.open({ ...connection, options: mapped }, via);
  for await (const page of fits.source.sync(null)) assert.ok(page);
  assert.equal(fits.unfit?.(), null);
});

// The tracker's first tab mapped as `trackerDraft` says, settled.
const mappedNow = async (tables: PreviewTable[]) => {
  const mapped = sheetsReview.settle({ tabs: [trackerDraft] }, tables, picked);
  assert.ok(!("problem" in mapped));
  return mapped;
};

test("a mapping as it reads now is drawn back by letter, the same as the draft it settled from", async () => {
  const tables = await preview();
  const current = sheetsReview.current(await mappedNow(tables), tables);
  assert.deepEqual(current, { tabs: [trackerDraft] });
  const sheet = sheetsReview.draw(current, tables).find((table) => table.at === trackerDraft.at);
  assert.deepEqual(sheet?.reads, {
    header: 1,
    end: "blank",
    hidden: false,
    fields: { key: "A", title: "C", status: "D", assignee: "E", estimate: "F", link: "G" },
  });
  // A tab whose title's header is gone isn't drawn as read; a link's is
  // only dropped.
  const renamed = tables.map((table) =>
    table.at === trackerDraft.at
      ? {
          ...table,
          rows: [
            table.rows[0]!.map((cell) => (cell === "Link" ? "URL" : cell)),
            ...table.rows.slice(1),
          ],
        }
      : table,
  );
  const tabs = (sheetsReview.current(await mappedNow(tables), renamed) as { tabs: object[] }).tabs;
  assert.equal(Object.hasOwn(tabs[0] ?? {}, "link"), false);
  const untitled = tables.map((table) =>
    table.at === trackerDraft.at
      ? {
          ...table,
          rows: [
            table.rows[0]!.map((cell) => (cell === "Story" ? "Name" : cell)),
            ...table.rows.slice(1),
          ],
        }
      : table,
  );
  assert.deepEqual(sheetsReview.current(await mappedNow(tables), untitled), { tabs: [] });
});

test("the person edits a draft a change at a time: a field's column, a tab read or not, its rows", async () => {
  const tables = await preview();
  const draft = { tabs: [trackerDraft] };
  const edited = (
    given: Record<string, unknown>,
    edit: Parameters<typeof sheetsReview.edit>[1],
  ) => {
    const next = sheetsReview.edit(given, edit, tables);
    assert.ok(!("problem" in next), JSON.stringify(next));
    assert.ok(sheetsReview.draft(next).ok);
    return next as { tabs: Record<string, unknown>[] };
  };
  const problem = (edit: Parameters<typeof sheetsReview.edit>[1]) => {
    const next = sheetsReview.edit(draft, edit, tables);
    assert.ok("problem" in next, JSON.stringify(edit));
    return String(next.problem);
  };
  const at = trackerDraft.at;
  // A column taken from an optional field leaves that field unmapped.
  const moved = edited(draft, { table: at, field: "assignee", column: "G" });
  assert.equal(moved.tabs[0]?.["assignee"], "G");
  assert.equal(Object.hasOwn(moved.tabs[0] ?? {}, "link"), false);
  // The status moved drops the states, which were its old column's values.
  const status = edited(draft, { table: at, field: "status", column: "B" });
  assert.equal(Object.hasOwn(status.tabs[0] ?? {}, "states"), false);
  assert.equal(
    Object.hasOwn(
      edited(draft, { table: at, field: "status", column: null }).tabs[0] ?? {},
      "status",
    ),
    false,
  );
  // A unique name may be key and title both.
  assert.equal(edited(draft, { table: at, field: "key", column: "C" }).tabs[0]?.["key"], "C");
  assert.match(problem({ table: at, field: "title", column: null }), /needs its title/);
  assert.match(problem({ table: at, field: "assignee", column: "A" }), /gives each row its key/);
  assert.match(problem({ table: at, field: "assignee", column: "ZZ" }), /no column ZZ/);
  assert.match(problem({ table: at, field: "owner", column: "B" }), /isn't a field/);
  assert.match(problem({ table: at, header: 31 }), /first \d+ rows/);
  assert.match(
    problem({ table: "1NotPickedAtAll000/1100", read: true }),
    /isn't in what Oriel read/,
  );
  const rows = edited(edited(edited(draft, { table: at, header: 2 }), { table: at, end: "grid" }), {
    table: at,
    hidden: true,
  });
  assert.deepEqual(
    [rows.tabs[0]?.["header"], rows.tabs[0]?.["end"], rows.tabs[0]?.["hidden"]],
    [2, "grid", true],
  );
  // A tab whose table sits under a title row is read from the header row
  // its guess finds.
  const titled = {
    name: "Plan › Q4",
    at: `${tracker}/9`,
    columns: ["A", "B"],
    rows: [
      ["Q4 plan", null],
      [null, null],
      ["ID", "Feature"],
      ["P-1", "Search"],
      ["P-2", "Export"],
    ],
  };
  const read = sheetsReview.edit({ tabs: [] }, { table: titled.at, read: true }, [titled]);
  assert.deepEqual(read, {
    tabs: [{ at: titled.at, header: 3, end: "blank", hidden: false, key: "A", title: "A" }],
  });
  // A tab not read, read, is Oriel's guess at it; left out, it isn't read.
  const raidAt = `${raid}/4100`;
  const both = edited(draft, { table: raidAt, read: true });
  assert.deepEqual(
    both.tabs.map((tab) => tab.at),
    [at, raidAt],
  );
  assert.deepEqual(
    edited(both, { table: at, read: false }).tabs.map((tab) => tab.at),
    [raidAt],
  );
});

test("before it applies, a new mapping says which rows it takes from the window", async () => {
  const tables = await preview();
  const before = await mappedNow(tables);
  const said = (tab: Record<string, unknown> | null) => {
    const after = sheetsReview.settle({ tabs: tab ? [tab] : [] }, tables, before);
    assert.ok(!("problem" in after));
    return sheetsReview.said(before, after, tables);
  };
  // Another title, status or owner: every item stays.
  assert.deepEqual(said({ ...trackerDraft, title: "B", assignee: undefined }), []);
  assert.deepEqual(said(trackerDraft), []);
  const [rekeyed] = said({ ...trackerDraft, key: "C" });
  assert.match(rekeyed ?? "", /^A new key makes every row of .+ › Tracker a new item;/);
  const [dropped] = said(null);
  assert.match(dropped ?? "", /› Tracker won't be read, so its rows leave the window/);
  assert.match(
    said({ ...trackerDraft, end: "grid" }).join(),
    /^Rows of .+ › Tracker that its table no longer covers leave the window\.$/,
  );
  // Nothing mapped before, nothing goes.
  assert.deepEqual(sheetsReview.said(picked, before, tables), []);
});
