// The command whole, as a person or a client runs it: what it writes to
// stdout and stderr, and above all what it never writes.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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
const shipped = fileURLToPath(new URL("../fixture/backlog.json", import.meta.url));

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

test("login signs in in the browser, keeps the refresh token and the client 0600, and shows no secret", async () => {
  const person = browser();
  const g = google();
  const run1 = harness({ open: person.open, fetch: g.fetch });
  assert.equal(await run(["login"], run1.io), 0);
  const authorize = person.opened[0];
  assert.ok(authorize);
  assert.equal(
    authorize.origin + authorize.pathname,
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  assert.equal(authorize.searchParams.get("scope"), scopes.join(" "));
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(new URL(authorize.searchParams.get("redirect_uri") ?? "").hostname, "127.0.0.1");
  assert.equal(g.forms[0]?.get("code"), code);
  assert.equal(g.forms[0]?.get("client_secret"), clientSecret);

  assert.equal(run1.file().read(), refreshToken);
  assert.deepEqual(run1.client().read(), { id: clientId, secret: clientSecret });
  assert.equal(statSync(run1.file().path).mode & 0o777, 0o600);
  assert.equal(statSync(run1.client().path).mode & 0o777, 0o600);
  assert.equal(statSync(run1.folder()).mode & 0o777, 0o700);
  assert.deepEqual(run1.out, []);
  assert.deepEqual(run1.err, [
    "Opening your browser to sign in to Google…\n",
    `Signed in. The sign-in is kept in ${run1.folder()}.\n`,
  ]);
  showsNoSecret(...run1.out, ...run1.err);
  // Nor the sign-in's own state and verifier.
  const verifier = g.forms[0]?.get("code_verifier") ?? "";
  const state = authorize.searchParams.get("state") ?? "";
  assert.ok(verifier.length >= 43 && state.length >= 43);
  for (const text of run1.err) assert.ok(!text.includes(verifier) && !text.includes(state));
});

test("login with a scope unticked keeps nothing, and says which", async () => {
  const run1 = harness({
    open: browser([scopes[0]]).open,
    fetch: google([scopes[0]]).fetch,
  });
  assert.equal(await run(["login"], run1.io), 1);
  assert.equal(existsSync(run1.file().path), false);
  assert.equal(existsSync(run1.client().path), false);
  assert.deepEqual(run1.err.slice(1), [
    "Didn't sign in: Google didn't grant drive.metadata.readonly; sign in again and leave both ticked.\n",
  ]);
});

test("login with no client says to set one, and opens nothing", async () => {
  const run1 = harness({ env: {} });
  assert.equal(await run(["login"], run1.io), 1);
  assert.deepEqual(run1.err, [
    "Set GOOGLE_CLIENT_ID first, and GOOGLE_CLIENT_SECRET if the client has one.\n",
  ]);
});

test("logout deletes the sign-in and its client, and says when there was none", async () => {
  const run1 = harness();
  run1.file().write(refreshToken);
  run1.client().write({ id: clientId, secret: clientSecret });
  assert.equal(await run(["logout"], run1.io), 0);
  assert.equal(run1.file().read(), null);
  assert.equal(existsSync(run1.client().path), false);
  assert.equal(await run(["logout"], run1.io), 0);
  assert.deepEqual(run1.err, [
    `Signed out: deleted the sign-in in ${run1.folder()}.\n`,
    "Not signed in.\n",
  ]);
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

test("the server signed in reaches Google with a refreshed token, and only JSON-RPC goes to stdout", async () => {
  const g = google();
  const run1 = harness({
    fetch: g.fetch,
    lines: [
      initialize,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      callOf(1, "read_range", { spreadsheetId: backlogId, range: "Backlog!A1:B2" }),
    ],
  });
  run1.file().write(refreshToken);
  assert.equal(await run([], run1.io), 0);
  const [init, read] = answers(run1.out);
  assert.equal(init?.id, 0);
  assert.deepEqual(JSON.parse(read?.result.content[0]?.text ?? ""), {
    range: "Backlog!A1:B2",
    values: [
      ["Key", "Title"],
      ["T-1", "First"],
    ],
    truncated: false,
  });
  assert.equal(g.forms[0]?.get("grant_type"), "refresh_token");
  assert.deepEqual(run1.err, []);
  showsNoSecret(...run1.out);
});

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
  assert.equal(
    read?.result.content[0]?.text,
    "Google refused the request: Bad range for client [redacted] (project [redacted]) with [redacted]",
  );
  showsNoSecret(...run1.out, ...run1.err);
});

test("the server with no sign-in answers each tool so, and never opens a browser", async () => {
  const run1 = harness({
    lines: [
      initialize,
      callOf(1, "list_spreadsheets", {}),
      callOf(2, "append_rows", { spreadsheetId: backlogId, range: "Backlog", values: [["x"]] }),
    ],
  });
  assert.equal(await run([], run1.io), 0);
  const [, one, two] = answers(run1.out);
  for (const answer of [one, two]) {
    assert.equal(answer?.result.isError, true);
    assert.equal(answer?.result.content[0]?.text, "Not signed in. Run `sheets-mcp login`.");
  }
  assert.deepEqual(run1.err, []);
  showsNoSecret(...run1.out);
});

test("the server with no environment refreshes with the client login kept", async () => {
  const g = google();
  const run1 = harness({
    env: {},
    fetch: g.fetch,
    lines: [
      initialize,
      callOf(1, "read_range", { spreadsheetId: backlogId, range: "Backlog!A1:B1" }),
    ],
  });
  run1.file().write(refreshToken);
  run1.client().write({ id: clientId, secret: clientSecret });
  assert.equal(await run([], run1.io), 0);
  const [, read] = answers(run1.out);
  assert.equal(read?.result.isError, undefined);
  assert.equal(g.forms[0]?.get("client_id"), clientId);
  assert.equal(g.forms[0]?.get("client_secret"), clientSecret);
  assert.deepEqual(run1.err, []);
  showsNoSecret(...run1.out);
});

test("the environment's client wins over the one kept", async () => {
  const g = google();
  const run1 = harness({
    fetch: g.fetch,
    lines: [initialize, callOf(1, "read_range", { spreadsheetId: backlogId, range: "Backlog!A1" })],
  });
  run1.file().write(refreshToken);
  run1.client().write({ id: "999999999999-other.apps.googleusercontent.com", secret: null });
  await run([], run1.io);
  assert.equal(g.forms[0]?.get("client_id"), clientId);
});

test("the server with neither a client nor a sign-in says to run login", async () => {
  const run1 = harness({
    env: {},
    lines: [initialize, callOf(1, "list_spreadsheets", {})],
  });
  assert.equal(await run([], run1.io), 0);
  const [, one] = answers(run1.out);
  assert.equal(one?.result.isError, true);
  assert.equal(one?.result.content[0]?.text, "Not signed in. Run `sheets-mcp login`.");
});

test("--fixture serves the shipped fixture with no network, no token and no client", async () => {
  const run1 = harness({
    env: {},
    lines: [
      initialize,
      callOf(1, "list_spreadsheets", {}),
      callOf(2, "get_spreadsheet", { spreadsheetId: "1q2w3e4r5t6y7u8i9o0pBacklogFixture" }),
    ],
  });
  assert.equal(await run(["--fixture", shipped], run1.io), 0);
  const [, list, got] = answers(run1.out);
  assert.deepEqual(
    (
      JSON.parse(list?.result.content[0]?.text ?? "") as { spreadsheets: { name: string }[] }
    ).spreadsheets.map((s) => s.name),
    ["Product backlog", "Release checklist"],
  );
  const tabs = (
    JSON.parse(got?.result.content[0]?.text ?? "") as {
      tabs: { title: string; header?: string[] }[];
    }
  ).tabs;
  assert.deepEqual(
    tabs.map((t) => t.title),
    ["Backlog", "Sprint 42 notes"],
  );
  assert.equal(tabs[0]?.header?.[0], "Key");
  assert.equal(existsSync(run1.folder()), false);
  assert.deepEqual(run1.err, []);
});

test("--fixture with --shared writes to the file, which another process then reads", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "sheets-mcp-shared-")), "backlog.json");
  copyFileSync(shipped, file);
  const id = "1q2w3e4r5t6y7u8i9o0pBacklogFixture";
  const writer = harness({
    env: {},
    lines: [
      initialize,
      callOf(1, "update_range", { spreadsheetId: id, range: "Backlog!C2", values: [["Blocked"]] }),
    ],
  });
  assert.equal(await run(["--fixture", file, "--shared"], writer.io), 0);
  const reader = harness({
    env: {},
    lines: [initialize, callOf(1, "read_range", { spreadsheetId: id, range: "Backlog!C2" })],
  });
  assert.equal(await run(["--fixture", file, "--shared"], reader.io), 0);
  const [, read] = answers(reader.out);
  assert.deepEqual(JSON.parse(read?.result.content[0]?.text ?? "").values, [["Blocked"]]);
  // Without it, a write stays in the process's memory.
  copyFileSync(shipped, file);
  await run(["--fixture", file], writer.io);
  const again = harness({
    env: {},
    lines: [initialize, callOf(1, "read_range", { spreadsheetId: id, range: "Backlog!C2" })],
  });
  await run(["--fixture", file], again.io);
  const [, before] = answers(again.out);
  assert.deepEqual(JSON.parse(before?.result.content[0]?.text ?? "").values, [["Done"]]);
});

test("a fixture that isn't one, or arguments that aren't, say so on stderr", async () => {
  const bad = harness();
  assert.equal(await run(["--fixture", join(bad.io.home, "missing.json")], bad.io), 1);
  assert.match(bad.err.join(""), /no such file/);
  for (const argv of [
    ["serve"],
    ["login", "extra"],
    ["--nope"],
    ["login", "--fixture", shipped],
    ["--shared"],
  ]) {
    const wrong = harness();
    assert.equal(await run(argv, wrong.io), 2, argv.join(" "));
    assert.match(wrong.err.join(""), /^Usage:/);
    assert.deepEqual(wrong.out, []);
  }
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
  assert.match(read?.result.content[0]?.text ?? "", /x \[redacted\] \[redacted\]$/);
  for (const secret of secrets)
    for (const piece of [secret.slice(0, 12), secret.slice(-12)])
      assert.ok(!run1.out.join("").includes(piece), `part of ${secret}`);
});
