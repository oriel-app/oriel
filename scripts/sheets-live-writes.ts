// Proves live, once, what decision 0050 marks Unsure about writes: that a
// value starting with `=` stays text. Only the maintainer runs it: it signs
// in to Google as Oriel's desktop client, in the default browser, and the
// person picks one spreadsheet they can edit, such as a blank one. In it the
// script adds a tab of its own, sends that tab exactly the writes Oriel's
// Sheets writer sends (packages/sheets/src/requests.ts), reads them back
// with `ranges`, deletes the tab, and revokes the grant. It prints what each
// cell holds as entered: text, a number, a formula or nothing. Only the
// script's own values reach the tab, and nothing of the spreadsheet is
// printed but its ID.
// Usage: pnpm sheets:live-writes [--env <path>]
// --env names the .env holding GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, as
// for `pnpm sheets:live`.
import { parseArgs } from "node:util";
import {
  addRowBody,
  editBody,
  type GoogleClient,
  quoteTab,
  signIn,
  type SignInIo,
} from "../packages/sheets/src/index.ts";
import { liveEnv, openBrowser } from "./sheets-live.ts";

const sheets = "https://sheets.googleapis.com/v4/spreadsheets";
const revokeEndpoint = "https://oauth2.googleapis.com/revoke";

// What each cell must hold once written, by A1: each `=` value as text.
export const expected: Record<string, "text" | "number" | "nothing"> = {
  A1: "text",
  B1: "nothing",
  A2: "text",
  B2: "text",
  C2: "number",
};

type Entered = {
  stringValue?: string;
  numberValue?: number;
  boolValue?: boolean;
  formulaValue?: string;
};

const kindOf = (value: Entered | undefined) =>
  value?.formulaValue !== undefined
    ? "formula"
    : value?.stringValue !== undefined
      ? "text"
      : value?.numberValue !== undefined
        ? "number"
        : value?.boolValue !== undefined
          ? "boolean"
          : "nothing";

export async function liveWrites(
  client: GoogleClient,
  io: SignInIo & { log: (line: string) => void },
): Promise<number> {
  const signedIn = await signIn(client, io);
  if (signedIn.status === "failed") {
    io.log(`sign-in failed: ${signedIn.problem}`);
    return 1;
  }
  const { tokens, picked } = signedIn;
  const [file] = picked;
  let code = 1;
  if (file === undefined) io.log("picked: none (the redirect had no picked_file_ids)");
  else {
    const at = `${sheets}/${encodeURIComponent(file)}`;
    const headers = {
      Authorization: `Bearer ${tokens.access}`,
      "Content-Type": "application/json",
    };
    const post = async (url: string, body: unknown) => {
      const response = await io.fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      return {
        status: response.status,
        body: (await response.json().catch(() => null)) as unknown,
      };
    };
    const title = `Oriel write test ${io.now()}`;
    const added = await post(`${at}:batchUpdate`, {
      requests: [{ addSheet: { properties: { title } } }],
    });
    const sheetId = (
      added.body as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] } | null
    )?.replies?.[0]?.addSheet?.properties?.sheetId;
    io.log(`${file} add tab: ${added.status}`);
    if (sheetId !== undefined) {
      try {
        code = await check(io, { at, title, sheetId, post, token: tokens.access });
      } finally {
        const deleted = await post(`${at}:batchUpdate`, {
          requests: [{ deleteSheet: { sheetId } }],
        });
        io.log(`delete tab: ${deleted.status}`);
        if (deleted.status !== 200) code = 1;
      }
    }
  }
  try {
    const response = await io.fetch(revokeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refresh }).toString(),
    });
    io.log(`revoke: ${response.status}`);
  } catch {
    io.log("revoke: no answer");
  }
  return code;
}

// The writer's three writes, then each cell read back as entered.
async function check(
  io: SignInIo & { log: (line: string) => void },
  tab: {
    at: string;
    title: string;
    sheetId: number;
    token: string;
    post: (url: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  },
): Promise<number> {
  const { at, title, sheetId, post } = tab;
  const writes = [
    ["edit A1 (RAW)", `${at}/values:batchUpdate`, editBody(title, 0, 0, "=1+1")],
    ["edit B1 (RAW)", `${at}/values:batchUpdate`, editBody(title, 0, 1, "=B1")],
    ["empty B1 (RAW)", `${at}/values:batchUpdate`, editBody(title, 0, 1, null)],
    [
      "new row 2 (typed)",
      `${at}:batchUpdate`,
      addRowBody(sheetId, 1, ["=2+2", "=SUM(A1:A1)", 3], false),
    ],
  ] as const;
  let code = 0;
  for (const [what, url, body] of writes) {
    const { status } = await post(url, body);
    io.log(`${what}: ${status}`);
    if (status !== 200) code = 1;
  }
  const url = new URL(at);
  url.searchParams.set("ranges", `${quoteTab(title)}!A1:C2`);
  url.searchParams.set(
    "fields",
    "sheets(properties(sheetId),data(rowData(values(userEnteredValue))))",
  );
  const response = await io.fetch(url, { headers: { Authorization: `Bearer ${tab.token}` } });
  const read = (await response.json().catch(() => null)) as {
    sheets?: {
      properties?: { sheetId?: number };
      data?: { rowData?: { values?: { userEnteredValue?: Entered }[] }[] }[];
    }[];
  } | null;
  io.log(`read back: ${response.status}, ${read?.sheets?.length ?? 0} tab(s)`);
  const rows = read?.sheets?.find((s) => (s.properties?.sheetId ?? 0) === sheetId)?.data?.[0]
    ?.rowData;
  for (const [cell, want] of Object.entries(expected)) {
    const column = cell.charCodeAt(0) - 65;
    const row = Number(cell.slice(1)) - 1;
    const found = kindOf(rows?.[row]?.values?.[column]?.userEnteredValue);
    io.log(`${cell}: ${found}`);
    if (found !== want) code = 1;
  }
  return code;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { env: { type: "string" } } });
  const env = await liveEnv(values.env, new URL("../.env", import.meta.url));
  if ("error" in env) {
    console.error(env.error);
    process.exit(1);
  }
  console.log(
    "Sign in and pick one spreadsheet you can edit, such as a blank one, in the browser tab this opens (5 minutes). The script adds a tab to it, writes there, and deletes the tab.",
  );
  process.exitCode = await liveWrites(env, {
    fetch,
    open: openBrowser,
    now: Date.now,
    log: console.log,
  });
}
