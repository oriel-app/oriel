import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contactsId,
  loadSheetsFixture,
  raidId,
  sprint41,
  sprint42,
  trackerId,
  trackerTab,
} from "../../../scripts/fixtures/sheets.ts";
import { quoteTab } from "./a1.ts";
import { fixtureGoogle, standInToken } from "./stand-in.ts";

const fixture = loadSheetsFixture();
const drive = "https://www.googleapis.com/drive/v3";
const sheets = "https://sheets.googleapis.com/v4/spreadsheets";

function google() {
  const standIn = fixtureGoogle(fixture);
  const get = async (url: string, token = standInToken) => {
    const response = await standIn.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json()) as unknown };
  };
  return { standIn, get };
}

// What lies at a path such as `sheets.0.data`, if anything.
const at = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (v, key) =>
        typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined,
      value,
    );
const list = (value: unknown, path: string): unknown[] => {
  const found = at(value, path);
  assert.ok(Array.isArray(found), path);
  return found;
};

const query = (params: Record<string, string | string[]>) => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params))
    for (const one of [value].flat()) search.append(name, one);
  return `?${search}`;
};

test("Drive's files.get: the default fields, or those asked for, and 404 for an unknown file", async () => {
  const { get } = google();
  assert.deepEqual((await get(`${drive}/files/${trackerId}`)).body, {
    kind: "drive#file",
    id: trackerId,
    name: "Ferrowick delivery tracker",
    mimeType: "application/vnd.google-apps.spreadsheet",
  });
  const viewOnly = await get(
    `${drive}/files/${contactsId}${query({ fields: "version,capabilities/canEdit" })}`,
  );
  assert.deepEqual(viewOnly.body, { version: "9", capabilities: { canEdit: false } });
  const missing = await get(`${drive}/files/1NobodyPickedThis000000000000000000000000000`);
  assert.equal(missing.status, 404);
  assert.equal(at(missing.body, "error.errors.0.reason"), "notFound");
  const bad = await get(`${drive}/files/${trackerId}?fields=version,capabilities(canFly)`);
  assert.equal(bad.status, 400);
  assert.equal(at(bad.body, "error.message"), "Invalid field selection capabilities.canFly");
});

test("every request needs the access token, and the stand-in writes nothing", async () => {
  const { standIn, get } = google();
  const refused = await get(`${drive}/files/${trackerId}?fields=version`, "someone-else");
  assert.equal(refused.status, 401);
  assert.equal(at(refused.body, "error.errors.0.reason"), "authError");
  const unsigned = await get(`${sheets}/${trackerId}`, "");
  assert.equal(at(unsigned.body, "error.status"), "UNAUTHENTICATED");
  const posted = await standIn.fetch(`${sheets}/${trackerId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${standInToken}` },
    body: "{}",
  });
  assert.equal(posted.status, 405);
  assert.deepEqual(
    standIn.calls.map((c) => c.method),
    ["GET", "GET", "POST"],
  );
});

test("Drive's about.get needs fields, and names the account", async () => {
  const { get } = google();
  assert.equal((await get(`${drive}/about`)).status, 400);
  assert.deepEqual((await get(`${drive}/about?fields=user(permissionId,emailAddress)`)).body, {
    user: { permissionId: fixture.user.permissionId, emailAddress: fixture.user.emailAddress },
  });
});

test("comments.list needs fields, pages, leaves deleted ones out unless asked, and knows resolved", async () => {
  const { get } = google();
  const comments = `${drive}/files/${raidId}/comments`;
  assert.equal((await get(comments)).status, 400);
  const fields =
    "comments(id,content,deleted,resolved,author,replies(content,action)),nextPageToken";
  const first = await get(`${comments}${query({ fields, pageSize: "2" })}`);
  assert.deepEqual(
    list(first.body, "comments").map((c) => at(c, "id")),
    ["AAAAraid001", "AAAAraid002"],
  );
  assert.deepEqual(at(first.body, "comments.0.author"), {
    kind: "drive#user",
    displayName: "Farid Haddad",
    me: false,
  });
  const pageToken = String(at(first.body, "nextPageToken"));
  const rest = await get(`${comments}${query({ fields, pageSize: "2", pageToken })}`);
  assert.equal(at(rest.body, "nextPageToken"), undefined);
  assert.deepEqual(
    list(rest.body, "comments").map((c) => [at(c, "id"), at(c, "resolved")]),
    [["AAAAraid003", true]],
  );
  assert.deepEqual(at(rest.body, "comments.0.replies.0"), {
    content: "Me, for now.",
    action: "resolve",
  });
  const all = await get(`${comments}${query({ fields, includeDeleted: "true" })}`);
  const deleted = list(all.body, "comments").at(-1);
  assert.equal(at(deleted, "deleted"), true);
  assert.equal(at(deleted, "content"), undefined);
});

test("spreadsheets.get: tabs without grid data, leaving out zeros as Google does", async () => {
  const { get } = google();
  const { body } = await get(`${sheets}/${trackerId}`);
  assert.equal(at(body, "properties.title"), "Ferrowick delivery tracker");
  assert.deepEqual(at(body, "sheets.0.properties"), {
    sheetId: trackerTab,
    title: "Tracker",
    sheetType: "GRID",
    gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 },
  });
  assert.equal(at(body, "sheets.1.properties.index"), 1);
  assert.equal(at(body, "sheets.0.data"), undefined);
  assert.deepEqual(at(body, "sheets.0.merges.0"), {
    sheetId: trackerTab,
    startRowIndex: 1,
    endRowIndex: 5,
    startColumnIndex: 1,
    endColumnIndex: 2,
  });
  assert.deepEqual(at(body, "sheets.0.basicFilter.filterSpecs"), [
    { columnIndex: 3, filterCriteria: { hiddenValues: ["Parked"] } },
  ]);
});

test("spreadsheets.get with ranges and a field mask: only those tabs, their cells and hidden rows", async () => {
  const { get } = google();
  const fields =
    "sheets(properties.title,data(startRow,rowData.values(userEnteredValue,formattedValue,note),rowMetadata,columnMetadata.hiddenByUser),merges)";
  const { body } = await get(
    `${sheets}/${trackerId}${query({ ranges: "Tracker!A1:I16", fields })}`,
  );
  assert.equal(list(body, "sheets").length, 1);
  assert.deepEqual(at(body, "sheets.0.properties"), { title: "Tracker" });
  const data = at(body, "sheets.0.data.0");
  assert.equal(at(data, "startRow"), undefined);
  assert.equal(list(data, "rowData").length, 16);
  assert.deepEqual(at(data, "rowData.12"), {});
  // B3, under the epic merged from B2.
  assert.deepEqual(at(data, "rowData.2.values.1"), {});
  assert.equal(
    at(data, "rowData.2.values.2.note"),
    "Ops set the flag from the admin tool (SYN-26).",
  );
  assert.deepEqual(at(data, "rowData.3.values.5"), {
    userEnteredValue: { formulaValue: "=2+3" },
    formattedValue: "5",
  });
  assert.deepEqual(at(data, "rowData.3.values.7.userEnteredValue"), {
    stringValue: "= same scope as FW-101; ask Farid",
  });
  // A row ends at its last cell that holds anything.
  assert.equal(list(data, "rowData.11.values").length, 8);
  assert.deepEqual(at(data, "rowMetadata.4"), { pixelSize: 21, hiddenByFilter: true });
  assert.deepEqual(at(data, "rowMetadata.7"), { pixelSize: 21, hiddenByUser: true });
  assert.deepEqual(at(data, "columnMetadata.8"), { hiddenByUser: true });
  assert.deepEqual(at(data, "columnMetadata.7"), {});
  assert.equal(list(body, "sheets.0.merges").length, 3);
});

test("a range names its tab quoted, from any row; a range that names no tab is refused", async () => {
  const { get } = google();
  const raid = fixture.spreadsheets.find((s) => s.id === raidId);
  const injected = raid?.tabs[1]?.title ?? "";
  const range = `${quoteTab(injected)}!A2:C`;
  const { body } = await get(
    `${sheets}/${raidId}${query({ ranges: range, includeGridData: "true" })}`,
  );
  assert.equal(at(body, "sheets.0.properties.title"), injected);
  const data = at(body, "sheets.0.data.0");
  assert.equal(at(data, "startRow"), 1);
  assert.equal(at(data, "rowData.0.values.0.formattedValue"), "DEC-1");
  assert.equal(at(data, "rowData.0.values.2.formattedValue"), "2026-09-03");
  assert.equal(at(data, "rowData.0.values.2.effectiveValue.numberValue"), 46268);
  const emoji = await get(
    `${sheets}/${trackerId}${query({ ranges: `${quoteTab("Localisation 🌐")}!A1:A2`, includeGridData: "true" })}`,
  );
  assert.equal(at(emoji.body, "sheets.0.data.0.rowData.0.values.0.formattedValue"), "キー");
  const missing = await get(`${sheets}/${trackerId}${query({ ranges: "'No such tab'!A1:B2" })}`);
  assert.equal(missing.status, 400);
  assert.equal(at(missing.body, "error.status"), "INVALID_ARGUMENT");
});

test("each later version moves the Drive version: a key edited, a tab sorted, a tab renamed", async () => {
  const { standIn, get } = google();
  const version = async () =>
    at((await get(`${drive}/files/${trackerId}?fields=version`)).body, "version");
  const cell = async (range: string) => {
    const fields = "sheets.data.rowData.values.formattedValue";
    const { body } = await get(`${sheets}/${trackerId}${query({ ranges: range, fields })}`);
    return at(body, "sheets.0.data.0.rowData.0.values.0.formattedValue");
  };
  assert.equal(await version(), "48");
  assert.equal(standIn.advance(trackerId), "51");
  assert.equal(await cell("Tracker!A9"), "FW-118");
  assert.equal(await cell("'Sprint 42'!C2"), "Farid Haddad");
  assert.equal(standIn.advance(trackerId), "55");
  assert.equal(await cell("'Sprint 42'!C2"), "Amara Okafor");
  assert.equal(standIn.advance(trackerId), "58");
  const { body } = await get(`${sheets}/${trackerId}?fields=sheets.properties(sheetId,title)`);
  assert.deepEqual(at(body, "sheets.1.properties"), {
    sheetId: sprint41,
    title: "Sprint 41 (closed)",
  });
  assert.equal(standIn.advance(trackerId), null);
  assert.equal(await version(), "58");
  const edit = { kind: "set" as const, sheetId: sprint42, cell: "D2", value: "Done" };
  assert.equal(standIn.change(trackerId, edit), "59");
  assert.equal(await cell("'Sprint 42'!D2"), "Done");
  assert.throws(() =>
    standIn.change(trackerId, { kind: "set", sheetId: trackerTab, cell: "B3", value: "x" }),
  );
  // The fixture itself is never changed.
  assert.equal(fixture.spreadsheets[0]?.version, "48");
});
