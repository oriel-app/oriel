import assert from "node:assert/strict";
import { test } from "node:test";
import type { After, Fetch } from "../packages/sheets/src/index.ts";
import { liveWrites } from "./sheets-live-writes.ts";

// Made-up values; none is a real client or token.
const client = { id: "fake-client.apps.googleusercontent.com", secret: "fake-client-secret-0123" };
const tokens = { access: "fake-access-token", refresh: "fake-refresh-token" };
const file = "1AbC-sheet";

type Entered = Record<string, unknown>;

// Google, signed in, holding one spreadsheet whose new tab keeps what is
// written: `parse` says how it takes a RAW value, as Google would or not.
function google(parse: (value: unknown) => Entered) {
  const posted: { url: string; body: unknown }[] = [];
  const cells = new Map<string, Entered>();
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetch: Fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.href === "https://oauth2.googleapis.com/revoke") return json(200, {});
    if (url.href === "https://oauth2.googleapis.com/token")
      return json(200, {
        access_token: tokens.access,
        expires_in: 3599,
        refresh_token: tokens.refresh,
        scope: "https://www.googleapis.com/auth/drive.file",
      });
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push({ url: url.pathname, body });
      if (url.pathname.endsWith("/values:batchUpdate")) {
        for (const range of body.data as { range: string; values: unknown[][] }[]) {
          const cell = range.range.split("!")[1] ?? "";
          const value = range.values[0]?.[0];
          if (value === "") cells.delete(cell);
          else cells.set(cell, parse(value));
        }
        return json(200, {});
      }
      const requests = body.requests as Record<string, Record<string, unknown>>[];
      if (requests[0]?.addSheet)
        return json(200, { replies: [{ addSheet: { properties: { sheetId: 7 } } }] });
      for (const request of requests) {
        const update = request.updateCells as
          | { rows: { values: { userEnteredValue?: Entered }[] }[] }
          | undefined;
        update?.rows[0]?.values.forEach((value, c) => {
          if (value.userEnteredValue) cells.set(`${"ABC"[c]}2`, value.userEnteredValue);
        });
      }
      return json(200, { replies: [] });
    }
    if (url.pathname === `/v4/spreadsheets/${file}`) {
      const row = (n: number) => ({
        values: ["A", "B", "C"].map((c) => {
          const value = cells.get(`${c}${n}`);
          return value ? { userEnteredValue: value } : {};
        }),
      });
      return json(200, {
        sheets: [{ properties: { sheetId: 7 }, data: [{ rowData: [row(1), row(2)] }] }],
      });
    }
    return json(404, {});
  };
  return { fetch, posted };
}

async function run(parse: (value: unknown) => Entered) {
  const lines: string[] = [];
  const never: After = () => () => {};
  const open = async (address: string) => {
    const authorize = new URL(address);
    const back = new URL(authorize.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("code", "4/fake-code");
    back.searchParams.set("state", authorize.searchParams.get("state") ?? "");
    back.searchParams.set("picked_file_ids", file);
    await (await fetch(back)).text();
  };
  const fake = google(parse);
  const code = await liveWrites(client, {
    fetch: fake.fetch,
    open,
    now: () => 0,
    after: never,
    log: (line) => lines.push(line),
  });
  return { code, lines, posted: fake.posted };
}

test("it sends the writer's own writes to a tab of its own, prints what each cell holds, and deletes the tab", async () => {
  const { code, lines, posted } = await run((value) =>
    typeof value === "number" ? { numberValue: value } : { stringValue: value },
  );
  assert.equal(code, 0);
  assert.deepEqual(
    posted.flatMap((p) => {
      const body = p.body as { valueInputOption?: string };
      return body.valueInputOption ? [body.valueInputOption] : [];
    }),
    ["RAW", "RAW", "RAW"],
  );
  const printed = lines.join("\n");
  for (const value of [client.id, client.secret, tokens.access, tokens.refresh, "4/fake-code"])
    assert.ok(!printed.includes(value));
});
