// The command whole, as a person or a client runs it: what it writes to
// stdout and stderr, and above all what it never writes.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type CliIo, run } from "./cli.ts";
import type { After } from "./loopback.ts";
import { type Fetch, scopes, tokenEndpoint } from "./oauth.ts";
import { standIn } from "./stand-in.ts";
import { backlogId, smallFixture } from "./testing.ts";
import { clientFile, configFolder, tokenFile } from "./token-file.ts";

// Made-up values; none is a real client or token.
const clientId = "123456789012-fakeclient0abcdef.apps.googleusercontent.com";
const clientSecret = "GOCSPX-fake-client-secret";
const code = "4/0Afake-authorization-code";
const accessToken = "ya29.fake-access-token";
const refreshToken = "1//fake-refresh-token";
const env = { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret };
const never: After = () => () => {};

// Everything a run wrote, by stream.
function harness(over: Partial<CliIo> & { lines?: unknown[] } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    env,
    home: mkdtempSync(join(tmpdir(), "sheets-mcp-home-")),
    stdin: (over.lines ?? []).map((line) => `${JSON.stringify(line)}\n`),
    stdout: { write: (t) => out.push(t) },
    stderr: { write: (t) => err.push(t) },
    fetch: async () => {
      throw new Error("no network in tests");
    },
    open: async () => {
      throw new Error("no browser in tests");
    },
    now: () => 1_800_000_000_000,
    after: never,
    ...over,
  };
  const folder = () => configFolder(io.env, io.home);
  return {
    io,
    out,
    err,
    file: () => tokenFile(folder()),
    client: () => clientFile(folder()),
    folder,
  };
}

// What must never show, whole or as its client's project number.
const secrets = [clientId, "123456789012", clientSecret, code, accessToken, refreshToken];
function showsNoSecret(...texts: string[]) {
  for (const text of texts)
    for (const secret of secrets) assert.ok(!text.includes(secret), `shown: ${secret}`);
}

// A browser that consents at once and follows Google back to the redirect;
// what it was sent to is kept, to find the state and the challenge in.
function browser(granted: readonly string[] = scopes) {
  const opened: URL[] = [];
  const open = async (address: string) => {
    const authorize = new URL(address);
    opened.push(authorize);
    const back = new URL(authorize.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("code", code);
    back.searchParams.set("state", authorize.searchParams.get("state") ?? "");
    back.searchParams.set("scope", granted.join(" "));
    await (await fetch(back)).text();
  };
  return { open, opened };
}

// Google: its token endpoint, and the APIs as the stand-in answers them.
function google(granted: readonly string[] = scopes) {
  const api = standIn(smallFixture(), { token: accessToken });
  const forms: URLSearchParams[] = [];
  const fetch: Fetch = async (input, init) => {
    if (String(input) !== tokenEndpoint) return api.fetch(input, init);
    forms.push(new URLSearchParams(String(init?.body)));
    return Response.json({
      access_token: accessToken,
      expires_in: 3599,
      refresh_token: refreshToken,
      scope: granted.join(" "),
      token_type: "Bearer",
    });
  };
  return { fetch, forms, api };
}

test("login keeps the refresh token and the client, and shows no secret", async () => {
  const person = browser();
  const g = google();
  const run1 = harness({ open: person.open, fetch: g.fetch });
  assert.equal(await run(["login"], run1.io), 0);
  const authorize = person.opened[0];
  assert.ok(authorize);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(new URL(authorize.searchParams.get("redirect_uri") ?? "").hostname, "127.0.0.1");
  assert.equal(g.forms[0]?.get("code"), code);
  assert.equal(g.forms[0]?.get("client_secret"), clientSecret);

  assert.equal(run1.file().read(), refreshToken);
  assert.deepEqual(run1.client().read(), { id: clientId, secret: clientSecret });
  assert.deepEqual(run1.out, []);
  showsNoSecret(...run1.out, ...run1.err);
  // Nor the sign-in's own state and verifier.
  const verifier = g.forms[0]?.get("code_verifier") ?? "";
  const state = authorize.searchParams.get("state") ?? "";
  assert.ok(verifier.length >= 43 && state.length >= 43);
  for (const text of run1.err) assert.ok(!text.includes(verifier) && !text.includes(state));
});

test("logout deletes the sign-in and its client", async () => {
  const run1 = harness();
  run1.file().write(refreshToken);
  run1.client().write({ id: clientId, secret: clientSecret });
  assert.equal(await run(["logout"], run1.io), 0);
  assert.equal(run1.file().read(), null);
  assert.equal(existsSync(run1.client().path), false);
  showsNoSecret(...run1.err);
});

const initialize = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  },
};
const callOf = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});
const answers = (out: string[]) =>
  out
    .join("")
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          id: number;
          result: { content: { text: string }[]; isError?: boolean };
        },
    );

test("what Google says is shown with every secret in it struck out", async () => {
  const g = google();
  const fetch: Fetch = async (input, init) =>
    String(input) === tokenEndpoint
      ? g.fetch(input, init)
      : Response.json(
          {
            error: {
              code: 400,
              message: `Bad range for client ${clientId} (project 123456789012) with ${accessToken}`,
            },
          },
          { status: 400 },
        );
  const run1 = harness({
    fetch,
    lines: [initialize, callOf(1, "read_range", { spreadsheetId: backlogId, range: "Backlog!A1" })],
  });
  run1.file().write(refreshToken);
  await run([], run1.io);
  const [, read] = answers(run1.out);
  assert.equal(read?.result.isError, true);
  assert.ok(read?.result.content[0]?.text.includes("Bad range for client"));
  showsNoSecret(...run1.out, ...run1.err);
});

test("a long message from Google is never cut through a secret", async () => {
  const g = google();
  const fetch: Fetch = async (input, init) =>
    String(input) === tokenEndpoint
      ? g.fetch(input, init)
      : Response.json(
          { error: { code: 400, message: `${"x".repeat(190)} ${accessToken} ${clientSecret}` } },
          { status: 400 },
        );
  const run1 = harness({
    fetch,
    lines: [initialize, callOf(1, "read_range", { spreadsheetId: backlogId, range: "Backlog!A1" })],
  });
  run1.file().write(refreshToken);
  await run([], run1.io);
  const [, read] = answers(run1.out);
  assert.equal(read?.result.isError, true);
  for (const secret of secrets)
    for (const piece of [secret.slice(0, 12), secret.slice(-12)])
      assert.ok(!run1.out.join("").includes(piece), `part of ${secret}`);
});
