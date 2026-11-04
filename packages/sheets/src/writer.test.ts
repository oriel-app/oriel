// The Sheets writer against the stand-in for Google's APIs, over the
// fixture's spreadsheets (decision 0050): an edit and a new row, values
// only, found by key, checked against what the diff showed, never over a
// formula, and read back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  type FieldValues,
  type ItemId,
  itemId,
  SourceRefused,
  type SourceWriter,
  ulid,
  type WriteRequest,
} from "@oriel/core";
import { rowKey } from "./attrs.ts";
import { fixturePicks } from "./declared-fixture.ts";
import { type FixtureCell, loadSheetsFixture } from "./fixture.ts";
import { googleReads } from "./google.ts";
import { maxRows } from "./grid.ts";
import type { SheetsPicks } from "./mapping.ts";
import { sheetsSource } from "./source.ts";
import { fixtureGoogle, type StandInCall, standInToken } from "./stand-in.ts";
import { sheetsWriter } from "./writer.ts";

// Stands in for packages/changeset, the only place that mints approvals in
// production. These tests cover the Sheets API mapping, not the approval
// gate. scripts/check-repo.ts allows this cast only in an adapter's writer
// test.
const approve = (request: WriteRequest<"sheets">) =>
  request as Parameters<SourceWriter<"sheets">["apply"]>[0];

const fixture = loadSheetsFixture();
const idOf = (slug: string) => {
  const found = fixture.spreadsheets.find((s) => s.slug === slug);
  assert.ok(found, slug);
  return found.id;
};
const tracker = idOf("tracker");
const contacts = idOf("contacts");
const credential = { headers: async () => ({ Authorization: `Bearer ${standInToken}` }) };

// A row by its spreadsheet, tab and key cell.
const row = (spreadsheet: string, sheetId: number, key: string) => {
  const hash = rowKey(spreadsheet, sheetId, key);
  return {
    id: itemId("sheets", hash) as ItemId<"sheets">,
    stableId: `${spreadsheet}/${sheetId}/${hash}`,
  };
};

let seq = 0;
const request = (
  op: string,
  target: { id: ItemId<"sheets">; stableId: string } | null,
  args: unknown,
  seen?: FieldValues,
) =>
  approve({
    mutationId: ulid(0, new Uint8Array(10).fill(seq++ % 256)),
    op,
    target: target?.id ?? null,
    expectedStableId: target?.stableId ?? null,
    args,
    ...(seen ? { seen } : {}),
  });

function setup(picks: SheetsPicks = fixturePicks(fixture), spreadsheets = fixture) {
  const standIn = fixtureGoogle(spreadsheets);
  const writer = sheetsWriter(
    {
      credential,
      picks,
      prefix: "sheets",
      fetch: standIn.fetch,
      wait: async () => {},
    },
    () => {},
  );
  const writes = () => standIn.calls.filter((c): c is Required<StandInCall> => c.method === "POST");
  // A tab's rows as the stand-in holds them now.
  const rows = (spreadsheet: string, sheetId: number): FixtureCell[][] =>
    standIn.spreadsheet(spreadsheet).tabs.find((t) => t.sheetId === sheetId)?.rows ?? [];
  // The tab's rows as a sync reads them, by key.
  const synced = async () => {
    const source = sheetsSource({
      google: googleReads({
        fetch: standIn.fetch,
        credential,
        wait: async () => {},
        random: () => 0,
      }),
      picks: fixturePicks(fixture),
      log: () => {},
    });
    const records = [];
    for await (const page of source.sync(null)) records.push(...page.records);
    return records;
  };
  return { standIn, writer, writes, rows, synced };
}

const refused = (sent: boolean, message: RegExp) => (error: unknown) =>
  error instanceof SourceRefused && error.sent === sent && message.test(error.message);

const fw102 = row(tracker, 1100, "FW-102");

test("an edit finds its row by key, writes the one cell RAW, and reads it back", async () => {
  const { writer, writes, rows } = setup();
  const result = await writer.apply(
    request("setField", fw102, { field: "status", value: "In progress" }, { status: "To do" }),
  );
  assert.deepEqual(
    writes().map((c) => [c.url, c.body]),
    [
      [
        `https://sheets.googleapis.com/v4/spreadsheets/${tracker}/values:batchUpdate`,
        {
          valueInputOption: "RAW",
          data: [{ range: "'Tracker'!D3", majorDimension: "ROWS", values: [["In progress"]] }],
        },
      ],
    ],
  );
  assert.equal(rows(tracker, 1100)[2]?.[3], "In progress");
  assert.deepEqual(result.item, fw102);
  assert.equal(result.before.status, "To do");
  assert.equal(result.after.status, "In progress");
  assert.notEqual(result.before.cells, result.after.cells);
  assert.deepEqual(await writer.current(fw102.id, ["status", "estimate", "title"]), {
    status: "In progress",
    estimate: 3,
    title: "Show an at-risk banner on affected bookings",
  });
  assert.deepEqual(await writer.read(fw102.id, ["status"]), {
    stableId: fw102.stableId,
    values: { status: "In progress" },
  });
});

test("a value starting with = is written and kept as text, never a formula", async () => {
  const { writer, writes, rows } = setup();
  await writer.apply(request("setField", fw102, { field: "status", value: "=SUM(F2:F12)" }));
  assert.equal(
    (writes()[0]?.body as { valueInputOption?: string } | undefined)?.valueInputOption,
    "RAW",
  );
  // Text in the stand-in: a formula would be `{ formula }`.
  assert.equal(rows(tracker, 1100)[2]?.[3], "=SUM(F2:F12)");
  assert.deepEqual(await writer.current(fw102.id, ["status"]), { status: "=SUM(F2:F12)" });
  // And it can be written again: it isn't a formula Oriel must refuse.
  await writer.apply(request("setField", fw102, { field: "status", value: "To do" }));
});

test("a cell holding a formula is refused, and nothing is sent", async () => {
  const { writer, writes } = setup();
  // FW-103's estimate is =2+3.
  await assert.rejects(
    writer.apply(
      request("setField", row(tracker, 1100, "FW-103"), { field: "estimate", value: 8 }),
    ),
    refused(false, /holds a formula, and Oriel never writes over one/),
  );
  assert.deepEqual(writes(), []);
});

test("a cell changed since the diff is a conflict, never an overwrite", async () => {
  const { standIn, writer, writes, rows } = setup();
  standIn.change(tracker, { kind: "set", sheetId: 1100, cell: "D3", value: "Blocked" });
  await assert.rejects(
    writer.apply(
      request("setField", fw102, { field: "status", value: "In progress" }, { status: "To do" }),
    ),
    refused(false, /holds “Blocked” now, not “To do” as when you approved this/),
  );
  assert.deepEqual(writes(), []);
  assert.equal(rows(tracker, 1100)[2]?.[3], "Blocked");
});

test("a row found again after a sort above it is written where it went", async () => {
  const { standIn, writer, rows } = setup();
  // Sprint 42 sorted by owner: 00422 stays on row 3 by chance, so sort by
  // story's points instead, where it moves to row 4.
  standIn.change(tracker, { kind: "sort", sheetId: 2142, range: "A2:E6", column: "E" });
  const result = await writer.apply(
    request("setField", row(tracker, 2142, "00422"), { field: "status", value: "Done" }),
  );
  assert.deepEqual(rows(tracker, 2142)[3], ["00422", "At-risk banner", "Bastian Holm", "Done", 3]);
  assert.equal(result.after.status, "Done");
});

test("a row sorted away between finding it and writing fails loudly, naming the row", async () => {
  const { standIn, writer, rows } = setup();
  standIn.beforeNextWrite(() =>
    standIn.change(tracker, { kind: "sort", sheetId: 2142, range: "A2:E6", column: "E" }),
  );
  await assert.rejects(
    writer.apply(
      request("setField", row(tracker, 2142, "00422"), { field: "status", value: "Done" }),
    ),
    (error: unknown) =>
      !(error instanceof SourceRefused) &&
      error instanceof Error &&
      /a sort moved row 3 before the write landed/.test(error.message),
  );
  // The value landed on the row that slid under it, which the person fixes.
  assert.deepEqual(rows(tracker, 2142)[2], [
    "00425",
    "SMS alerts under 160 characters",
    "Chen Yuting",
    "Done",
    2,
  ]);
});

test("a spreadsheet the person can only view is refused before anything is sent", async () => {
  const { writer, writes } = setup();
  await assert.rejects(
    writer.apply(
      request("setField", row(contacts, 5100, "+44 1632 960101"), { field: "title", value: "x" }),
    ),
    refused(false, /can only view that spreadsheet/),
  );
  assert.deepEqual(writes(), []);
});

test("a field the row's tab doesn't map, a row that isn't an item and a stale handle are refused", async () => {
  const { writer, writes } = setup();
  // Sprint 41 maps no link.
  await assert.rejects(
    writer.apply(
      request("setField", row(tracker, 2141, "00411"), {
        field: "link",
        value: "https://x.example",
      }),
    ),
    refused(false, /maps no link column/),
  );
  // FW-104 is on two rows, so neither is an item.
  await assert.rejects(
    writer.apply(
      request("setField", row(tracker, 1100, "FW-104"), { field: "status", value: "Done" }),
    ),
    refused(false, /isn't in its tab any more, or its key cell changed/),
  );
  await assert.rejects(
    writer.apply(
      request(
        "setField",
        { id: fw102.id, stableId: row(tracker, 1100, "FW-101").stableId },
        {
          field: "status",
          value: "Done",
        },
      ),
    ),
    refused(false, /names another row/),
  );
  assert.deepEqual(writes(), []);
});

const night = {
  spreadsheet: tracker,
  sheetId: 1100,
  values: { key: "FW-110", title: "=1+1 night-sailing alert sound", status: "To do", estimate: 2 },
};

test("a new row goes after the table's last row, above its notes, with typed values", async () => {
  const { writer, writes, rows, synced } = setup();
  const result = await writer.apply(request("addRow", null, night));
  assert.deepEqual(
    writes().map((c) => [c.url, c.body]),
    [
      [
        `https://sheets.googleapis.com/v4/spreadsheets/${tracker}:batchUpdate`,
        {
          requests: [
            {
              insertDimension: {
                range: { sheetId: 1100, dimension: "ROWS", startIndex: 12, endIndex: 13 },
                inheritFromBefore: true,
              },
            },
            {
              updateCells: {
                start: { sheetId: 1100, rowIndex: 12, columnIndex: 0 },
                rows: [
                  {
                    values: [
                      { userEnteredValue: { stringValue: "FW-110" } },
                      {},
                      { userEnteredValue: { stringValue: "=1+1 night-sailing alert sound" } },
                      { userEnteredValue: { stringValue: "To do" } },
                      {},
                      { userEnteredValue: { numberValue: 2 } },
                    ],
                  },
                ],
                fields: "userEnteredValue",
              },
            },
          ],
        },
      ],
    ],
  );
  const tab = rows(tracker, 1100);
  assert.deepEqual(tab[12], ["FW-110", null, "=1+1 night-sailing alert sound", "To do", null, 2]);
  assert.deepEqual(tab[13] ?? [], []);
  assert.deepEqual(tab[14], ["Notes"]);
  const added = row(tracker, 1100, "FW-110");
  assert.deepEqual(result.item, added);
  assert.deepEqual(result.before, {});
  assert.equal(result.after.key, "FW-110");
  assert.equal(result.after.estimate, 2);
  assert.match(String(result.after.cells), /^[0-9a-f]{16}$/);
  // A sync reads it as an item, and the notes block still isn't one.
  const records = await synced();
  assert.equal(records.find((r) => r.id === added.id)?.title, "=1+1 night-sailing alert sound");
});

test("a new row whose key the tab has already, or that maps a field the tab doesn't, is refused", async () => {
  const { writer, writes } = setup();
  for (const key of ["FW-101", " FW-104 "])
    await assert.rejects(
      writer.apply(request("addRow", null, { ...night, values: { ...night.values, key } })),
      refused(false, /has that key already/),
    );
  await assert.rejects(
    writer.apply(
      request("addRow", null, { ...night, sheetId: 2141, values: { ...night.values, link: "x" } }),
    ),
    refused(false, /maps no link column/),
  );
  assert.deepEqual(writes(), []);
});

test("a row Oriel added is deleted by its key, and a sort that slides another under it fails loudly", async () => {
  const { standIn, writer, rows } = setup();
  const added = (await writer.apply(request("addRow", null, night))).item;
  const target = { id: added.id as ItemId<"sheets">, stableId: added.stableId };
  const result = await writer.apply(request("deleteRow", target, {}));
  assert.equal(result.before.title, "=1+1 night-sailing alert sound");
  assert.deepEqual(result.after, {});
  assert.deepEqual(rows(tracker, 1100)[13], ["Notes"]);
  assert.equal(await writer.current(target.id, ["title"]), "gone");

  const again = (await writer.apply(request("addRow", null, night))).item;
  // Someone adds a story at the top as Oriel deletes.
  standIn.beforeNextWrite(() => {
    standIn.change(tracker, { kind: "insert", sheetId: 1100, row: 2 });
    standIn.change(tracker, { kind: "set", sheetId: 1100, cell: "A2", value: "FW-120" });
  });
  await assert.rejects(
    writer.apply(
      request("deleteRow", { id: again.id as ItemId<"sheets">, stableId: again.stableId }, {}),
    ),
    (error: unknown) =>
      !(error instanceof SourceRefused) &&
      error instanceof Error &&
      /Oriel deleted row 13, but the row it meant to is still in the tab/.test(error.message),
  );
});

test("Google refusing the write changed nothing, and says so", async () => {
  const { standIn, writer } = setup();
  // The tab is renamed between the read and the write, so its range no
  // longer parses.
  standIn.beforeNextWrite(() =>
    standIn.change(tracker, { kind: "rename", sheetId: 1100, title: "Delivery" }),
  );
  await assert.rejects(
    writer.apply(request("setField", fw102, { field: "status", value: "Done" })),
    refused(true, /Google Sheets refused the write \(400\)/),
  );
});

// The golden diffs, as a thread would capture them, apply against the
// fixture, each checked against the cells a diff would show.
for (const name of ["sheets-edit-status", "sheets-add-row"])
  test(`the golden diff ${name} applies against the fixture`, async () => {
    const { writer, writes } = setup();
    const golden = JSON.parse(
      readFileSync(new URL(`../../../tests/golden/${name}.json`, import.meta.url), "utf8"),
    ) as { mutations: { op: string; target: string | null; args: unknown }[] };
    const records = await setup().synced();
    for (const m of golden.mutations) {
      const target =
        m.target === null
          ? null
          : {
              id: m.target as ItemId<"sheets">,
              stableId: records.find((r) => r.id === m.target)?.stableId ?? "",
            };
      const shown = target ? await writer.current(target.id, ["status", "title"]) : {};
      assert.notEqual(shown, "gone");
      const result = await writer.apply(
        request(m.op, target, m.args, shown === "gone" ? {} : shown),
      );
      assert.ok(result.item.id.startsWith("sheets:"));
    }
    assert.equal(writes().length, golden.mutations.length);
  });

test("a key column that is the title too is never edited, and a new row's key and title must agree", async () => {
  // Sprint 41's tickets as both key and title.
  const picks: SheetsPicks = {
    spreadsheets: [
      {
        id: tracker,
        tabs: [
          { sheetId: 2141, header: 1, end: "blank", hidden: false, key: "Ticket", title: "Ticket" },
        ],
      },
    ],
  };
  const { writer, writes } = setup(picks);
  await assert.rejects(
    writer.apply(
      request("setField", row(tracker, 2141, "00411"), { field: "title", value: "00419" }),
    ),
    refused(false, /is the row's key too, and Oriel never changes a key/),
  );
  await assert.rejects(
    writer.apply(
      request("addRow", null, {
        spreadsheet: tracker,
        sheetId: 2141,
        values: { key: "00415", title: "x" },
      }),
    ),
    refused(false, /column is another field's too, and they differ/),
  );
  assert.deepEqual(writes(), []);
  await writer.apply(
    request("addRow", null, {
      spreadsheet: tracker,
      sheetId: 2141,
      values: { key: "00415", title: "00415" },
    }),
  );
});

test("a tab past the rows Oriel reads, or full to them, takes no new row", async () => {
  // The archive's tab, past the cap, and cut to exactly the cap.
  const full = structuredClone(fixture);
  const tab = full.spreadsheets.find((s) => s.slug === "archive")?.tabs[0];
  assert.ok(tab && tab.rows.length > maxRows + 1);
  for (const spreadsheets of [fixture, (tab.rows.splice(maxRows + 1), full)]) {
    const { writer, writes } = setup(fixturePicks(fixture), spreadsheets);
    await assert.rejects(
      writer.apply(
        request("addRow", null, {
          spreadsheet: idOf("archive"),
          sheetId: 6100,
          values: { key: "FW-B0001", title: "x" },
        }),
      ),
      refused(false, /past the rows Oriel reads/),
    );
    assert.deepEqual(writes(), []);
  }
});

test("a cell an array formula fills is never written, nor a new row under one", async () => {
  const { standIn, writer, writes } = setup();
  // An ARRAYFORMULA in the header fills Owner down the tab.
  for (const at of ["E3", "E12"])
    standIn.change(tracker, {
      kind: "set",
      sheetId: 1100,
      cell: at,
      value: { value: "Rowan Pike", spilled: true },
    });
  await assert.rejects(
    writer.apply(request("setField", fw102, { field: "assignee", value: "Amara Okafor" })),
    refused(false, /a formula elsewhere put there/),
  );
  await assert.rejects(
    writer.apply(request("addRow", null, { ...night, values: { ...night.values, assignee: "x" } })),
    refused(false, /a formula fills the assignee column/),
  );
  assert.deepEqual(writes(), []);
});
