import assert from "node:assert/strict";
import { test } from "node:test";
import type { After, Fetch } from "../packages/sheets/src/index.ts";
import { live } from "./sheets-live.ts";

// Made-up values; none is a real client or token.
const client = { id: "fake-client.apps.googleusercontent.com", secret: "fake-client-secret-0123" };
const tokens = { access: "fake-access-token", refresh: "fake-refresh-token" };

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
  const printed = lines.join("\n");
  for (const value of [client.id, client.secret, tokens.access, tokens.refresh, "4/fake-code"])
    assert.ok(!printed.includes(value));
});
