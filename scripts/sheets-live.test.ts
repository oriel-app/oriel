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
  // --no-secret reads the ID alone, even where the secret is set.
  assert.deepEqual(await liveEnv(path, root, { noSecret: true }), { id: client.id, secret: null });
  assert.deepEqual(await liveEnv(join(dir, "partial.env"), root, { noSecret: true }), {
    error: "GOOGLE_CLIENT_ID must be set in .env",
  });
});

// Google, from the token endpoint to Drive: signed in until revoked. With
// `wantsSecret`, it refuses a token request with no secret, as Google says
// it may not, once it has taken `allowed` of them.
function google({ wantsSecret = false, allowed = 0 } = {}) {
  let revoked = false;
  let taken = 0;
  const fetch: Fetch = async (input, init) => {
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
    if (
      url.href === "https://oauth2.googleapis.com/token" &&
      wantsSecret &&
      !new URLSearchParams(String(init?.body)).has("client_secret") &&
      taken++ >= allowed
    )
      return json(400, {
        error: "invalid_request",
        error_description: "client_secret is missing.",
      });
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

const never: After = () => () => {};

// The person signs in and picks one spreadsheet.
const open = async (address: string) => {
  const authorize = new URL(address);
  const back = new URL(authorize.searchParams.get("redirect_uri") ?? "");
  back.searchParams.set("code", "4/fake-code");
  back.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  back.searchParams.set("picked_file_ids", "1AbC-sheet");
  await (await fetch(back)).text();
};

const run = async (as: typeof client | { id: string; secret: null }, answers: Fetch) => {
  const lines: string[] = [];
  const code = await live(as, {
    fetch: answers,
    open,
    now: () => 0,
    after: never,
    log: (line) => lines.push(line),
  });
  return { code, lines };
};

test("it prints each picked spreadsheet's ID and version, and statuses, never a value", async () => {
  const { code, lines } = await run(client, google());
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

test("--no-secret ends on whether Google took the exchange and refresh without it", async () => {
  const idOnly = { id: client.id, secret: null };
  const accepted = await run(idOnly, google());
  assert.equal(accepted.code, 0);
  assert.equal(
    accepted.lines.at(-1),
    "verdict: Google accepted the exchange and refresh without the secret",
  );

  const exchange = await run(idOnly, google({ wantsSecret: true }));
  assert.equal(exchange.code, 1);
  assert.deepEqual(exchange.lines, [
    "sign-in failed: Google refused the token request without the client's secret (400 invalid_request)",
    "verdict: Google refused the exchange without the secret",
  ]);

  const refreshed = await run(idOnly, google({ wantsSecret: true, allowed: 1 }));
  assert.equal(refreshed.code, 1);
  assert.ok(
    refreshed.lines.includes(
      "refresh: failed (Google refused the token request without the client's secret (400 invalid_request))",
    ),
  );
  assert.equal(
    refreshed.lines.at(-1),
    "verdict: Google accepted the exchange without the secret, but refused the refresh",
  );

  // With the secret, no verdict is printed.
  assert.ok(!(await run(client, google())).lines.some((line) => line.startsWith("verdict")));
});
