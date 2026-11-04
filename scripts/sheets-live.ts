// Signs in to Google once, live, as Oriel's desktop client, and reads the
// picked spreadsheets' versions (decision 0050). Only the maintainer runs it:
// it opens Google's page in the default browser. Each spreadsheet's ID and
// Drive version are printed, then what Google answered to the reads 0050
// marks Unsure, by HTTP status alone. Last, it revokes the grant and refreshes
// once more, which Google must refuse, so nothing is left signed in.
// Usage: pnpm sheets:live [--env <path>]
// --env names the .env holding GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
// (default: the repo root's). It is opened checked, only those two are read,
// and nothing in it is printed.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { type GoogleClient, refresh, signIn, type SignInIo } from "../packages/sheets/src/index.ts";
import { readEnv } from "./env.ts";

// Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and nothing else. Messages
// never include a value.
export function googleEnv(envFile: string | null): GoogleClient | { error: string } {
  const env = envFile ? parseEnv(envFile) : {};
  const id = env.GOOGLE_CLIENT_ID;
  const secret = env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret)
    return { error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set in .env" };
  return { id, secret };
}

// The client, from the .env `--env` names, or else the repo root's.
export async function liveEnv(env: string | undefined, rootEnv: URL) {
  const read = await readEnv(env ?? fileURLToPath(rootEnv));
  if ("problem" in read) return { error: read.problem };
  if (env !== undefined && read.text === null) return { error: `no file at ${env}` };
  return googleEnv(read.text);
}

const drive = "https://www.googleapis.com/drive/v3";
const sheets = "https://sheets.googleapis.com/v4";
const revokeEndpoint = "https://oauth2.googleapis.com/revoke";

export async function live(
  client: GoogleClient,
  io: SignInIo & { log: (line: string) => void },
): Promise<number> {
  const signedIn = await signIn(client, io);
  if (signedIn.status === "failed") {
    io.log(`sign-in failed: ${signedIn.problem}`);
    return 1;
  }
  const { tokens, picked } = signedIn;
  const get = (url: string) =>
    io.fetch(url, { headers: { Authorization: `Bearer ${tokens.access}` } });
  const answered = async (url: string) => {
    try {
      return String((await get(url)).status);
    } catch {
      return "no answer";
    }
  };
  let code = 0;
  if (picked.length === 0) {
    io.log("picked: none (the redirect had no picked_file_ids)");
    code = 1;
  }
  for (const id of picked) {
    const file = encodeURIComponent(id);
    try {
      const response = await get(`${drive}/files/${file}?fields=version`);
      const body: unknown = await response.json();
      const version =
        typeof body === "object" && body !== null && "version" in body ? body.version : null;
      if (response.ok && typeof version === "string") io.log(`${id} version ${version}`);
      else {
        io.log(`${id} drive ${response.status}`);
        code = 1;
      }
    } catch {
      io.log(`${id} drive no answer`);
      code = 1;
    }
  }
  const [first] = picked;
  if (first !== undefined) {
    const file = encodeURIComponent(first);
    io.log(`sheets api: ${await answered(`${sheets}/spreadsheets/${file}?fields=spreadsheetId`)}`);
    io.log(
      `comments: ${await answered(`${drive}/files/${file}/comments?fields=comments(id)&pageSize=1`)}`,
    );
  }
  io.log(`about: ${await answered(`${drive}/about?fields=user(permissionId)`)}`);
  io.log(`refresh: ${(await refresh(client, tokens.refresh, io)).status}`);
  let revoked: string;
  try {
    const response = await io.fetch(revokeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refresh }).toString(),
    });
    revoked = String(response.status);
  } catch {
    revoked = "no answer";
  }
  io.log(`revoke: ${revoked}`);
  io.log(`refresh after revoke: ${(await refresh(client, tokens.refresh, io)).status}`);
  return code;
}

// The default browser, by the system's own opener.
const openBrowser = (url: string) =>
  new Promise<void>((resolve, reject) =>
    execFile(process.platform === "darwin" ? "open" : "xdg-open", [url], (error) =>
      error ? reject(error) : resolve(),
    ),
  );

if (import.meta.main) {
  const { values } = parseArgs({ options: { env: { type: "string" } } });
  const env = await liveEnv(values.env, new URL("../.env", import.meta.url));
  if ("error" in env) {
    console.error(env.error);
    process.exit(1);
  }
  console.log("Sign in and pick a spreadsheet in the browser tab this opens (5 minutes).");
  process.exitCode = await live(env, {
    fetch,
    open: openBrowser,
    now: Date.now,
    log: console.log,
  });
}
