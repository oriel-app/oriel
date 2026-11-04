import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { pathToFileURL } from "node:url";
import type { After, Fetch } from "../packages/sheets/src/index.ts";
import { live, liveEnv } from "./sheets-live.ts";

// Made-up values; none is a real client or token.
const client = { id: "fake-client.apps.googleusercontent.com", secret: "fake-client-secret-0123" };
const envText = `GOOGLE_CLIENT_ID=${client.id}\nGOOGLE_CLIENT_SECRET=${client.secret}\nANTHROPIC_API_KEY=sk-ant-fake\n`;
const tokens = { access: "fake-access-token", refresh: "fake-refresh-token" };

const realDir = (t: TestContext) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oriel-sheets-live-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("--env names the .env holding the client, a regular file with one link; else the root's", async (t) => {
  const dir = realDir(t);
  const path = join(dir, "main.env");
  writeFileSync(path, envText);
  const root = pathToFileURL(join(dir, "missing", ".env"));
  assert.deepEqual(await liveEnv(path, root), client);
  const link = join(dir, "link.env");
  symlinkSync(path, link);
  assert.deepEqual(await liveEnv(link, root), {
    error: `${link} is not a regular file with one link; it is refused`,
  });
  assert.deepEqual(await liveEnv(join(dir, "none.env"), root), {
    error: `no file at ${join(dir, "none.env")}`,
  });
  assert.deepEqual(await liveEnv(undefined, pathToFileURL(path)), client);
  writeFileSync(join(dir, "partial.env"), `GOOGLE_CLIENT_SECRET=${client.secret}\n`);
  const partial = await liveEnv(join(dir, "partial.env"), root);
  assert.ok("error" in partial && !partial.error.includes(client.secret));
});

// Google, from the token endpoint to Drive: signed in until revoked.
function google() {
  let revoked = false;
  const fetch: Fetch = async (input) => {
    const url = new URL(String(input));
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.href === "https://oauth2.googleapis.com/revoke") {
      revoked = true;
      return json(200, {});
    }
    if (url.href === "https://oauth2.googleapis.com/token")
      return revoked
        ? json(400, { error: "invalid_grant" })
        : json(200, {
            access_token: tokens.access,
            expires_in: 3599,
            refresh_token: tokens.refresh,
            scope: "https://www.googleapis.com/auth/drive.file",
          });
    if (url.pathname === "/drive/v3/files/1AbC-sheet") return json(200, { version: "42" });
    if (url.pathname.endsWith("/comments")) return json(403, { error: { message: "secret" } });
    return json(200, {});
  };
  return fetch;
}

test("it prints each picked spreadsheet's ID and version, and statuses, never a value", async () => {
  const lines: string[] = [];
  const never: After = () => () => {};
  const open = async (address: string) => {
    const authorize = new URL(address);
    const back = new URL(authorize.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("code", "4/fake-code");
    back.searchParams.set("state", authorize.searchParams.get("state") ?? "");
    back.searchParams.set("picked_file_ids", "1AbC-sheet");
    await (await fetch(back)).text();
  };
  const code = await live(client, {
    fetch: google(),
    open,
    now: () => 0,
    after: never,
    log: (line) => lines.push(line),
  });
  assert.equal(code, 0);
  assert.deepEqual(lines, [
    "1AbC-sheet version 42",
    "sheets api: 200",
    "comments: 403",
    "about: 200",
    "refresh: refreshed",
    "revoke: 200",
    "refresh after revoke: signed-out",
  ]);
  const printed = lines.join("\n");
  for (const value of [client.id, client.secret, tokens.access, tokens.refresh, "4/fake-code"])
    assert.ok(!printed.includes(value));
});
