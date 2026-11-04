import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveRows, contactsId, loadSheetsFixture, trackerId } from "./fixtures/sheets.ts";
import {
  changeRequests,
  entered,
  fillRequests,
  marker,
  seed,
  type SeedIo,
  stepKey,
} from "./seed-sheets.ts";

const fixture = loadSheetsFixture();
const spreadsheet = (id: string) => {
  const found = fixture.spreadsheets.find((s) => s.id === id);
  assert.ok(found);
  return found;
};

test("cells are written as typed values: text starting with = stays text", () => {
  assert.deepEqual(entered("= same scope as FW-101"), {
    userEnteredValue: { stringValue: "= same scope as FW-101" },
  });
  assert.deepEqual(entered({ formula: "=2+3", value: 5 }), {
    userEnteredValue: { formulaValue: "=2+3" },
  });
  assert.deepEqual(entered("00421"), { userEnteredValue: { stringValue: "00421" } });
  assert.deepEqual(entered({ value: 46268, formatted: "2026-09-03" }), {
    userEnteredValue: { numberValue: 46268 },
    userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } },
  });
  assert.deepEqual(entered({ value: "Story", note: "A note." }), {
    userEnteredValue: { stringValue: "Story" },
    note: "A note.",
  });
  assert.deepEqual(entered(null), {});
  assert.throws(() => entered({ value: 1200, formatted: "£1,200" }));
});

test("a spreadsheet is filled tab by tab, cells in chunks, then merges, hiding and filters", () => {
  const [tabs, ...rest] = fillRequests(spreadsheet(trackerId), [0]);
  assert.deepEqual(
    tabs?.map((r) => Object.keys(r)[0]),
    ["addSheet", "addSheet", "addSheet", "addSheet", "deleteSheet"],
  );
  assert.deepEqual(tabs?.[1], {
    addSheet: {
      properties: {
        sheetId: 2141,
        title: "Sprint 41",
        index: 1,
        gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 },
      },
    },
  });
  const shape = rest.at(-1) ?? [];
  assert.deepEqual(shape[0], {
    mergeCells: {
      range: {
        sheetId: 1100,
        startRowIndex: 1,
        endRowIndex: 5,
        startColumnIndex: 1,
        endColumnIndex: 2,
      },
      mergeType: "MERGE_ALL",
    },
  });
  assert.deepEqual(
    shape.slice(3).map((r) => JSON.stringify(r)),
    [
      JSON.stringify({
        updateDimensionProperties: {
          range: { sheetId: 1100, dimension: "ROWS", startIndex: 7, endIndex: 8 },
          properties: { hiddenByUser: true },
          fields: "hiddenByUser",
        },
      }),
      JSON.stringify({
        updateDimensionProperties: {
          range: { sheetId: 1100, dimension: "COLUMNS", startIndex: 8, endIndex: 9 },
          properties: { hiddenByUser: true },
          fields: "hiddenByUser",
        },
      }),
      JSON.stringify({
        setBasicFilter: {
          filter: {
            range: {
              sheetId: 1100,
              startRowIndex: 0,
              endRowIndex: 12,
              startColumnIndex: 0,
              endColumnIndex: 9,
            },
            filterSpecs: [{ columnIndex: 3, filterCriteria: { hiddenValues: ["Parked"] } }],
          },
        },
      }),
    ],
  );
  const archive = fixture.spreadsheets.find((s) => s.slug === "archive");
  assert.ok(archive);
  const cells = fillRequests(archive, [0]).slice(1);
  assert.equal(cells.length, Math.ceil((archiveRows + 1) / 1000));
  assert.ok(cells.every((batch) => JSON.stringify(batch).length < 2_000_000));
});

test("later versions are an edited cell, a sort and a rename", () => {
  const tracker = spreadsheet(trackerId);
  assert.deepEqual(
    tracker.later.map((v) => changeRequests(tracker, v.changes)),
    [
      [
        {
          updateCells: {
            start: { sheetId: 1100, rowIndex: 8, columnIndex: 0 },
            rows: [{ values: [{ userEnteredValue: { stringValue: "FW-118" } }] }],
            fields: "userEnteredValue,note,userEnteredFormat.numberFormat",
          },
        },
      ],
      [
        {
          sortRange: {
            range: {
              sheetId: 2142,
              startRowIndex: 1,
              endRowIndex: 6,
              startColumnIndex: 0,
              endColumnIndex: 5,
            },
            sortSpecs: [{ dimensionIndex: 2, sortOrder: "ASCENDING" }],
          },
        },
      ],
      [
        {
          updateSheetProperties: {
            properties: { sheetId: 2141, title: "Sprint 41 (closed)" },
            fields: "title",
          },
        },
      ],
    ],
  );
});

type File = { id: string; appProperties: Record<string, string>; trashed: boolean };

// Google's write side, as little as the seed needs: Drive's files, their
// appProperties and permissions, comments, and Sheets batchUpdate.
function google(options: { me?: string; limitedOnce?: boolean } = {}) {
  const files: File[] = [];
  const calls: { method: string; path: string; body: unknown }[] = [];
  let limited = options.limitedOnce ?? false;
  let n = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer seed-token");
    if (limited) {
      limited = false;
      return Response.json(
        { error: { code: 429, message: "Rate Limit Exceeded" } },
        { status: 429 },
      );
    }
    const json = (value: unknown) => Response.json(value);
    if (url.pathname === "/drive/v3/about")
      return json({ user: { emailAddress: options.me ?? "seeder@ferrowick.example" } });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const slug = /value='([a-z-]+)'/.exec(url.searchParams.get("q") ?? "")?.[1];
      return json({
        files: files
          .filter((f) => !f.trashed && f.appProperties[marker] === slug)
          .map(({ id, appProperties }) => ({ id, appProperties })),
      });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const { appProperties } = body as { appProperties: Record<string, string> };
      const file = {
        id: `1Seeded${String(++n).padStart(4, "0")}`.padEnd(44, "0"),
        appProperties: { ...appProperties },
        trashed: false,
      };
      files.push(file);
      return json({ id: file.id });
    }
    const patched = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (patched && method === "PATCH") {
      const file = files.find((f) => f.id === patched[1]);
      assert.ok(file);
      const change = body as { trashed?: boolean; appProperties?: Record<string, string> };
      if (change.trashed) file.trashed = true;
      Object.assign(file.appProperties, change.appProperties ?? {});
      return json({ id: file.id });
    }
    if (url.pathname.endsWith("/comments") || url.pathname.endsWith("/replies"))
      return json({ id: `c${++n}` });
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/permissions")) return json({ id: "p1" });
    if (url.hostname === "sheets.googleapis.com" && method === "GET")
      return json({ sheets: [{ properties: { title: "Sheet1" } }] });
    if (url.pathname.endsWith(":batchUpdate")) return json({ replies: [] });
    return Response.json({ error: { code: 404, message: "not here" } }, { status: 404 });
  };
  return { files, calls, fetch: fetch as typeof globalThis.fetch };
}

const run = async (
  g: ReturnType<typeof google>,
  options: { share?: string; next?: boolean } = {},
) => {
  const lines: string[] = [];
  const waits: number[] = [];
  const io: SeedIo = {
    fetch: g.fetch,
    log: (line) => lines.push(line),
    wait: async (ms) => {
      waits.push(ms);
    },
  };
  const code = await seed(
    fixture,
    "seed-token",
    { share: options.share ?? "reader@ferrowick.example", next: options.next ?? false },
    io,
  );
  return { code, lines, waits };
};

test("a second run finds what the first made; --next moves each on a version", async () => {
  const g = google({ limitedOnce: true });
  const first = await run(g);
  assert.equal(first.code, 0);
  assert.equal(first.waits.length, 1, "the 429 is retried after a wait");
  assert.equal(g.files.length, 4);
  assert.ok(g.files.every((f) => f.appProperties[stepKey] === "0"));
  assert.deepEqual(
    first.lines.map((line) => line.split("  ").slice(1)),
    g.files.map((f) => [f.id, "made"]),
  );
  assert.deepEqual(
    first.lines.map((line) => line.split("  ")[0]),
    fixture.spreadsheets.map((s) => s.title),
  );
  const shared = g.calls.filter((c) => c.path.endsWith("/permissions")).map((c) => c.body);
  assert.deepEqual(
    shared.map((b) => (b as { role: string }).role),
    fixture.spreadsheets.map((s) => (s.id === contactsId ? "reader" : "writer")),
  );
  // The deleted comment is made, then deleted.
  assert.equal(g.calls.filter((c) => c.method === "DELETE").length, 1);

  g.calls.length = 0;
  const second = await run(g);
  assert.equal(second.code, 0);
  assert.ok(second.lines.every((line) => line.endsWith("  found")));
  assert.ok(!g.calls.some((c) => c.method === "POST" && c.path === "/drive/v3/files"));

  const next = await run(g, { next: true });
  assert.deepEqual(
    next.lines.map((line) => line.split("  ").at(-1)),
    [
      "moved to version 2 of 4",
      "at its last version",
      "at its last version",
      "at its last version",
    ],
  );
  assert.equal(g.files[0]?.appProperties[stepKey], "1");
});

test("a half-made spreadsheet is trashed and made again; seeding yourself as the reader is refused", async () => {
  const g = google();
  g.files.push({
    id: "1HalfMade".padEnd(44, "0"),
    appProperties: { [marker]: "tracker" },
    trashed: false,
  });
  const { lines } = await run(g);
  assert.equal(g.files[0]?.trashed, true);
  assert.match(lines[0] ?? "", /  remade$/);
  const self = await run(google({ me: "Reader@Ferrowick.example" }));
  assert.equal(self.code, 1);
  assert.equal(self.lines.length, 1);
});
