// The Sheets writer against the stand-in for Google's APIs, over the
// fixture's spreadsheets (decision 0050): an edit and a new row, values
// only, found by key, checked against what the diff showed, never over a
// formula, and read back.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type FieldValues,
  type ItemId,
  itemId,
  SourceRefused,
  type SourceWriter,
  ulid,
  type WriteRequest,
  WriteStalled,
} from "@oriel/core";
import { rowKey } from "./attrs.ts";
import { fixturePicks } from "./declared-fixture.ts";
import { type FixtureCell, loadSheetsFixture } from "./fixture.ts";
import { googleReads } from "./google.ts";
import { maxRows } from "./grid.ts";
import type { SheetsPicks } from "./mapping.ts";
import { fakeId, fakePicks, fakeRows, fakeServer } from "./sheets-mcp-fake.ts";
import { sheetsSource } from "./source.ts";
import { fixtureGoogle, type StandInCall } from "./stand-in.ts";
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
      picks,
      prefix: "sheets",
      memory: standIn.fetch,
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

// Refused before anything was sent (`sent` false), or by Google after (true).
const refused = (sent: boolean) => (error: unknown) =>
  error instanceof SourceRefused && error.sent === sent;
// Failed after the request went out: it may have landed.
const unsure = (error: unknown) => error instanceof Error && !(error instanceof SourceRefused);

const fw102 = row(tracker, 1100, "FW-102");

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
    refused(false),
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
    refused(false),
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
    unsure,
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
    refused(false),
  );
  // FW-104 is on two rows, so neither is an item.
  await assert.rejects(
    writer.apply(
      request("setField", row(tracker, 1100, "FW-104"), { field: "status", value: "Done" }),
    ),
    refused(false),
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
    refused(false),
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
  assert.equal(writes().length, 1);
  const tab = rows(tracker, 1100);
  assert.deepEqual(tab[12], ["FW-110", null, "=1+1 night-sailing alert sound", "To do", null, 2]);
  assert.deepEqual(tab[13] ?? [], []);
  assert.deepEqual(tab[14], ["Notes"]);
  const added = row(tracker, 1100, "FW-110");
  assert.deepEqual(result.item, added);
  assert.deepEqual(result.before, {});
  assert.equal(result.after.key, "FW-110");
  assert.equal(result.after.estimate, 2);
  // A sync reads it as an item, and the notes block still isn't one.
  const records = await synced();
  assert.equal(records.find((r) => r.id === added.id)?.title, "=1+1 night-sailing alert sound");
});

test("a new row whose key the tab has already, or that maps a field the tab doesn't, is refused", async () => {
  const { writer, writes } = setup();
  for (const key of ["FW-101", " FW-104 "])
    await assert.rejects(
      writer.apply(request("addRow", null, { ...night, values: { ...night.values, key } })),
      refused(false),
    );
  await assert.rejects(
    writer.apply(
      request("addRow", null, { ...night, sheetId: 2141, values: { ...night.values, link: "x" } }),
    ),
    refused(false),
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
    unsure,
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
    refused(true),
  );
});

// A writer whose requests are counted, so a test can stop the write at one
// before it goes out, by its time running out.
// Google can turn the first post away too, as a 429 does, unprocessed.
function stoppable(options: { busy?: boolean } = {}) {
  const standIn = fixtureGoogle(fixture);
  let made = 0;
  type How = "time";
  let stop: { at: number; how: How } | null = null;
  // Whether the write stops here, once.
  const stops = (how: How) => {
    if (stop?.how !== how || made !== stop.at) return false;
    stop = null;
    return true;
  };
  let busy = options.busy ?? false;
  const writer = sheetsWriter(
    {
      picks: fixturePicks(fixture),
      prefix: "sheets",
      memory: async (input, init) => {
        made += 1;
        if (busy && init?.method === "POST") {
          busy = false;
          return new Response("", { status: 429 });
        }
        return standIn.fetch(input, init);
      },
      wait: async () => {},
    },
    () => {},
  );
  const limit = { left: () => (stops("time") ? 0 : 60_000) };
  const writes = () => standIn.calls.filter((c) => c.method === "POST");
  const keyed = (key: string) =>
    (standIn.spreadsheet(tracker).tabs.find((t) => t.sheetId === 1100)?.rows ?? []).filter(
      (r) => r[0] === key,
    );
  return {
    writer,
    limit,
    writes,
    keyed,
    stopAt: (at: number, how: How) => (stop = { at, how }),
  };
}

// Which request of a write is its post, counted from 0, as a run of it shows.
async function postOf(op: string, target: Parameters<typeof request>[1], args: unknown) {
  const { standIn, writer } = setup();
  await writer.apply(request(op, target, args));
  return standIn.calls.findIndex((c) => c.method === "POST");
}

test("a write whose time runs out before it goes out sent nothing, and sent again it goes once", async () => {
  const post = await postOf("addRow", null, night);
  {
    const { writer, limit, writes, keyed, stopAt } = stoppable();
    stopAt(post, "time");
    await assert.rejects(writer.apply(request("addRow", null, night), limit), refused(false));
    assert.deepEqual(writes(), []);
    await writer.apply(request("addRow", null, night), limit);
    assert.equal(writes().length, 1);
    assert.equal(keyed("FW-110").length, 1);
  }
  // An edit and a deleted row, likewise.
  for (const [op, target, args] of [
    ["setField", fw102, { field: "status", value: "Done" }],
    ["deleteRow", fw102, {}],
  ] as const) {
    const at = await postOf(op, target, args);
    const { writer, limit, writes, stopAt } = stoppable();
    stopAt(at, "time");
    await assert.rejects(writer.apply(request(op, target, args), limit), refused(false));
    assert.deepEqual(writes(), []);
  }
});

test("a post Google turned away, whose retry runs out of time, changed nothing", async () => {
  const post = await postOf("addRow", null, night);
  const { writer, limit, writes, keyed, stopAt } = stoppable({ busy: true });
  stopAt(post + 1, "time");
  await assert.rejects(writer.apply(request("addRow", null, night), limit), refused(true));
  assert.deepEqual(writes(), []);
  assert.deepEqual(keyed("FW-110"), []);
});

test("a write that went out and then ran out of time may have landed, and sent again adds no second row", async () => {
  const post = await postOf("addRow", null, night);
  const { writer, limit, writes, keyed, stopAt } = stoppable();
  // The read back after the post.
  stopAt(post + 1, "time");
  await assert.rejects(writer.apply(request("addRow", null, night), limit), unsure);
  assert.equal(writes().length, 1);
  await assert.rejects(writer.apply(request("addRow", null, night), limit), refused(false));
  assert.equal(writes().length, 1);
  assert.equal(keyed("FW-110").length, 1);
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
    refused(false),
  );
  await assert.rejects(
    writer.apply(
      request("addRow", null, {
        spreadsheet: tracker,
        sheetId: 2141,
        values: { key: "00415", title: "x" },
      }),
    ),
    refused(false),
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
      refused(false),
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
    refused(false),
  );
  await assert.rejects(
    writer.apply(request("addRow", null, { ...night, values: { ...night.values, assignee: "x" } })),
    refused(false),
  );
  assert.deepEqual(writes(), []);
});

// Through sheets-mcp (OA-279): the same checks, through its read tools, and
// each mutation as its one write call.
function throughServer(rows = fakeRows()) {
  const server = fakeServer(rows);
  const writer = sheetsWriter(
    { picks: fakePicks, prefix: "sheets", server: { read: server.read, write: server.write } },
    () => {},
  );
  const written = () =>
    server.calls.filter((call) => ["update_range", "append_rows"].includes(call.tool));
  return { server, writer, written };
}

test("through sheets-mcp, a new row is one append_rows after the table, found where it landed", async () => {
  const { server, writer, written } = throughServer();
  const result = await writer.apply(
    request("addRow", null, {
      spreadsheet: fakeId,
      sheetId: 0,
      values: { key: "BL-4", title: '=HYPERLINK("x")', status: "To do" },
    }),
  );
  assert.deepEqual(written(), [
    {
      tool: "append_rows",
      args: {
        spreadsheetId: fakeId,
        range: "'Backlog'!A1:C4",
        values: [["BL-4", '=HYPERLINK("x")', "To do"]],
        valueInputOption: "RAW",
      },
    },
  ]);
  assert.deepEqual(server.rows[4], ["BL-4", '=HYPERLINK("x")', "To do"]);
  assert.equal(result.item.id, row(fakeId, 0, "BL-4").id);
});

test("through sheets-mcp, a new row goes under the table, never under a notes block below it", async () => {
  const { server, writer, written } = throughServer([
    ...fakeRows(),
    ["", "", "", "", ""],
    ["Notes", "BL-2 waits on the gateway team.", "", "", ""],
  ]);
  await writer.apply(
    request("addRow", null, {
      spreadsheet: fakeId,
      sheetId: 0,
      values: { key: "BL-4", title: "Bulk edit", status: "To do" },
    }),
  );
  assert.equal(written()[0]?.args.range, "'Backlog'!A1:C4");
  assert.deepEqual(server.rows[4], ["BL-4", "Bulk edit", "To do"]);
  assert.equal(server.rows[6]?.[0], "Notes");
  // One the server put anywhere else isn't reported as added.
  const astray = sheetsWriter(
    {
      picks: fakePicks,
      prefix: "sheets",
      server: {
        read: server.read,
        write: async () => ({
          content: [],
          structuredContent: { updatedRange: "'Backlog'!A9:C9", updatedRows: 1 },
        }),
      },
    },
    () => {},
  );
  await assert.rejects(
    astray.apply(
      request("addRow", null, {
        spreadsheet: fakeId,
        sheetId: 0,
        values: { key: "BL-9", title: "Elsewhere" },
      }),
    ),
    unsure,
  );
});

test("through sheets-mcp, a number is read as entered, so an edit's Undo writes the number back", async () => {
  const { server, writer, written } = throughServer();
  server.formulas.set("2,3", 3);
  const result = await writer.apply(
    request("setField", row(fakeId, 0, "BL-2"), { field: "estimate", value: 5 }, { estimate: 3 }),
  );
  assert.equal(result.before.estimate, 3);
  assert.deepEqual(written()[0]?.args.values, [[5]]);
  // Text "3" where the diff saw the number 3 has changed.
  server.formulas.set("2,3", "3");
  await assert.rejects(
    writer.apply(
      request("setField", row(fakeId, 0, "BL-2"), { field: "estimate", value: 8 }, { estimate: 3 }),
    ),
    refused(false),
  );
});

test("through sheets-mcp, a row can't be deleted, and the writer says so before anything is offered", async () => {
  const { writer, written } = throughServer();
  assert.ok(writer.unsendable?.deleteRow);
  await assert.rejects(
    writer.apply(request("deleteRow", row(fakeId, 0, "BL-2"), {})),
    refused(false),
  );
  assert.deepEqual(written(), []);
  // Through Google's own API, it can.
  assert.equal(setup().writer.unsendable, undefined);
});

test("through sheets-mcp, a cell holding a formula, or one a formula fills, isn't written over", async () => {
  const { server, writer, written } = throughServer();
  // Column E: BL-1's total, entered as a formula, and BL-2's, filled by an
  // array formula elsewhere, as FORMULA renders them.
  server.formulas.set("1,4", "=D2");
  server.formulas.set("2,4", "");
  const tab = { ...fakePicks.spreadsheets[0]!.tabs[0]!, estimate: "Total" };
  const mapped = { spreadsheets: [{ id: fakeId, tabs: [tab] }] };
  const totals = sheetsWriter(
    { picks: mapped, prefix: "sheets", server: { read: server.read, write: server.write } },
    () => {},
  );
  await assert.rejects(
    totals.apply(request("setField", row(fakeId, 0, "BL-1"), { field: "estimate", value: 4 })),
    refused(false),
  );
  await assert.rejects(
    totals.apply(request("setField", row(fakeId, 0, "BL-2"), { field: "estimate", value: 4 })),
    refused(false),
  );
  // Text that starts with `=` reads as a formula through the server, so
  // it's never written over either.
  await assert.rejects(
    writer.apply(request("setField", row(fakeId, 0, "BL-3"), { field: "title", value: "Plain" })),
    refused(false),
  );
  assert.deepEqual(written(), []);
});

test("through sheets-mcp, a cell that moved since approval is a conflict, and nothing is written", async () => {
  const { writer, written } = throughServer();
  await assert.rejects(
    writer.apply(
      request(
        "setField",
        row(fakeId, 0, "BL-2"),
        { field: "status", value: "Done" },
        { status: "In progress" },
      ),
    ),
    refused(false),
  );
  assert.deepEqual(written(), []);
});

test("through sheets-mcp, a write it turns away was refused; one Google didn't answer may have landed", async () => {
  const { server } = throughServer();
  const answering = (text: string) =>
    sheetsWriter(
      {
        picks: fakePicks,
        prefix: "sheets",
        server: {
          read: server.read,
          write: async () => ({ content: [{ type: "text", text }], isError: true }),
        },
      },
      () => {},
    );
  const edit = () =>
    request("setField", row(fakeId, 0, "BL-2"), { field: "status", value: "Done" });
  await assert.rejects(
    answering("Google refused: this account can't open or change that spreadsheet.").apply(edit()),
    refused(true),
  );
  const unsure = await answering("Couldn't reach Google. Check the connection, then try again.")
    .apply(edit())
    .catch((error: unknown) => error);
  assert.ok(unsure instanceof Error && !(unsure instanceof SourceRefused));
  // A process that never sent it: nothing landed.
  const stalled = sheetsWriter(
    {
      picks: fakePicks,
      prefix: "sheets",
      server: {
        read: server.read,
        write: async () => {
          throw new WriteStalled("Oriel stopped Claude Code: it asked for another call.");
        },
      },
    },
    () => {},
  );
  await assert.rejects(stalled.apply(edit()), refused(false));
});
