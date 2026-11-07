// The desktop app's first run for `pnpm shots` (decision 0038): its screens,
// and the onboarding budget timed from its first screen on a fresh data
// folder to an approved change set, on three paths. Nothing here is the
// person's: each server gets its own throwaway home, with a stub Claude Code
// in it or none, a stub of Anthropic's installer, a stand-in signature check
// and test turn, and SYN as a Jira site in memory that takes any Jira Cloud
// address. The stubs print the vendors' lines; nothing reaches the network.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import {
  type CheckOptions,
  locateClaudeCode,
  locateCodex,
  parseVersion,
  supportedVersion,
} from "../packages/agent/src/index.ts";
import { instant } from "../packages/core/src/ids.ts";
import { memorySite } from "../packages/jira/src/memory-site.ts";
import type { AppOptions } from "../packages/server/src/app.ts";
import { legacySecret, memorySecrets } from "../packages/server/src/connection.ts";
import { models } from "../packages/server/src/model.ts";
import type { Serving } from "../packages/server/src/serve.ts";
import { askTiny, testKnown } from "../packages/server/src/servers/testing.ts";
import { atlassianServer } from "../packages/jira/src/atlassian.ts";
import { atlassianStandIn, standInCaller } from "../packages/jira/src/atlassian-standin.ts";
import { memorySettings, settingsFile } from "../packages/server/src/settings.ts";
import { type SetupState, memorySetup, setupFile } from "../packages/server/src/setup/state.ts";
import { loadJiraFixture } from "../packages/jira/src/fixture.ts";
import { loadSheetsFixture } from "../packages/sheets/src/fixture.ts";
import { scope, tokenEndpoint } from "../packages/sheets/src/oauth.ts";
import { fixtureGoogle, standInToken } from "../packages/sheets/src/stand-in.ts";

// The Jira account SYN in memory takes, as the onboarding types it.
export const jiraAccount = { email: "pm@example.com", token: "shots-only-value" };

// How each stub behaves, read from its home when it runs.
type Login = "works" | "waits" | "fails";
type Install = "works" | "waits" | "fails";

// A stub `claude`, as Claude Code answers what the first run runs.
const stubCli = (version: string) =>
  [
    "#!/bin/bash",
    'case "$1 $2" in',
    `  "--version ") echo "${version} (Claude Code)" ;;`,
    '  "auth login")',
    '    echo "Opening browser to sign in…"',
    '    echo "If the browser didn\'t open, visit: https://claude.ai/oauth/authorize?code=true&state=shotsstate0123456789abcdefghij"',
    '    mode=$(cat "$HOME/.stub-login" 2>/dev/null)',
    '    if [ "$mode" = "waits" ]; then while [ ! -f "$HOME/.release" ]; do sleep 0.2; done; fi',
    '    if [ "$mode" = "fails" ]; then echo "Login timed out: no answer from the browser." >&2; exit 1; fi',
    '    touch "$HOME/.signed-in"; echo "Login successful." ;;',
    '  "auth status")',
    '    if [ -f "$HOME/.signed-in" ]; then',
    '      if [ -f "$HOME/.api-key" ]; then echo \'{"loggedIn":true,"authMethod":"api_key"}\'',
    '      else echo \'{"loggedIn":true,"authMethod":"claude.ai","email":"maya@example.com","subscriptionType":"pro"}\'; fi',
    "    else echo '{\"loggedIn\":false}'; exit 1; fi ;;",
    '  "update ") echo "Claude Code is up to date." ;;',
    "  *) exit 2 ;;",
    "esac",
    "",
  ].join("\n");

// Anthropic's installer, as it prints: nothing while it downloads, then
// "Setting up Claude Code...", then the binary sets itself up.
const stubInstaller = [
  "#!/bin/bash",
  "set -e",
  'mode=$(cat "$HOME/.stub-install" 2>/dev/null)',
  'if [ "$mode" = "waits" ]; then while [ ! -f "$HOME/.release" ]; do sleep 0.2; done; fi',
  'if [ "$mode" = "fails" ]; then echo "curl: (56) Recv failure: Connection reset by peer" >&2; echo "Download failed" >&2; exit 1; fi',
  'echo "Setting up Claude Code..."',
  'mkdir -p "$HOME/.local/share/claude/versions" "$HOME/.local/bin"',
  "cat > \"$HOME/.local/share/claude/versions/2.1.317\" <<'CLI'",
  stubCli("2.1.317").trimEnd(),
  "CLI",
  'chmod +x "$HOME/.local/share/claude/versions/2.1.317"',
  'ln -sf "$HOME/.local/share/claude/versions/2.1.317" "$HOME/.local/bin/claude"',
  'echo ""',
  'echo "✅ Installation complete!"',
  "",
].join("\n");

export type FirstRunOptions = {
  // Claude Code as the person's Mac has it, or none.
  cli?: { version?: string; signedIn?: boolean };
  // Codex on the PATH: signed out, or "ready", signed in (decision 0048).
  codex?: true | "ready";
  // Both signed in with the person's own API key, with no plan.
  apiKeys?: true;
  install?: Install;
  login?: Login;
  // What Claude Code says instead of answering the test turn; it answers
  // when absent.
  refuses?: string;
  // Oriel's look for the CLI doesn't end.
  stillLooking?: true;
  // The first run so far.
  state?: Partial<SetupState>;
  // Jira already connected, and a folder.
  jira?: true;
  folder?: string;
  // Jira's search: held, so the first sync never ends, or failing on its
  // second page.
  search?: "held" | "fails";
  // A data folder on disk, as the desktop app has, in place of memory.
  data?: string;
  // Google Sheets offered too, as the Sheets fixture's stand-in for Google
  // answers, with a made-up client of Oriel's (decision 0051).
  sheets?: true;
  // That many more tabs in the tracker, made here, each a small table of
  // its own, as a tracker with a tab a week has (OA-232).
  sheetsTabs?: number;
  // A database to start on, without a data folder.
  db?: string;
  // The person's Claude Code lists the tiny test tracker server (decision
  // 0059), which Oriel knows by its test-only entry, for Jira's kind.
  found?: true;
  // And the person turned Jira on through it, so the stand-in steps aside
  // and the first run offers Jira's connect step too, until OA-280.
  trackerOn?: true;
  // The person's Claude Code lists Atlassian's MCP server (OA-276), as the
  // stand-in of it answers SYN in memory: found, or Jira on through it.
  atlassian?: "found" | "on";
};

// Atlassian's server as the person's agent lists it, under the name they
// gave it there.
const atlassianFound = {
  name: "atlassian",
  status: "connected" as const,
  reports: atlassianServer.reports,
  url: "https://mcp.atlassian.com/v2/mcp?tools=all",
  command: null,
  tools: [...atlassianServer.reads, ...atlassianServer.writes],
  transport: "http" as const,
};

type Start = (
  port: number,
  options: Omit<AppOptions, "reviewBase" | "sketchBase">,
) => Promise<Serving>;

// A home on disk for the stubs, removed once the shots are done, and any
// other folder kept as long.
const homes: string[] = [];
export const keepUntilDone = (folder: string) => void homes.push(folder);
// What each server holds up, as a look that doesn't end, a search held or a
// stub waiting for the browser, let go once the shots are done, so every
// server can close.
const holds: (() => void)[] = [];
export const releaseAll = () => {
  for (const release of holds.splice(0)) release();
};
export const removeHomes = () => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
};

export async function firstRunServer(
  start: Start,
  agent: NonNullable<AppOptions["agent"]>,
  pickFolder: () => Promise<string | null>,
  options: FirstRunOptions = {},
): Promise<Serving> {
  const home = mkdtempSync(join(tmpdir(), "oriel-shots-home-"));
  homes.push(home);
  const bin = join(home, ".local", "bin");
  if (options.cli) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "claude"), stubCli(options.cli.version ?? "2.1.317"), { mode: 0o755 });
    if (options.cli.signedIn) writeFileSync(join(home, ".signed-in"), "");
  }
  const codexBin = join(home, "codex-bin");
  if (options.codex) {
    mkdirSync(codexBin, { recursive: true });
    // `codex login` signs in at once, as the browser would hand it back.
    writeFileSync(
      join(codexBin, "codex"),
      '#!/bin/bash\n[ "$1" = login ] && echo "Starting local login server on http://localhost:1455." && touch "$HOME/.codex-signed-in"\n',
      { mode: 0o755 },
    );
    if (options.codex === "ready") writeFileSync(join(home, ".codex-signed-in"), "");
  }
  if (options.apiKeys) writeFileSync(join(home, ".api-key"), "");
  writeFileSync(join(home, ".stub-login"), options.login ?? "works");
  writeFileSync(join(home, ".stub-install"), options.install ?? "works");
  const env = { HOME: home, PATH: ["/usr/bin", "/bin", bin, codexBin].join(":") };

  // The harness's check, as far as a stub answers it: on the PATH, the
  // version it prints, and signed in once its sign-in left its mark.
  const look = Promise.withResolvers<void>();
  if (!options.stillLooking) look.resolve();
  holds.push(() => {
    look.resolve();
    writeFileSync(join(home, ".release"), "");
  });
  const check = async ({ env: given, path }: CheckOptions) => {
    await look.promise;
    const cli = locateClaudeCode(given ?? {}, path);
    if (!cli)
      return { ok: false as const, problem: { kind: "missing" as const, message: "Not found." } };
    const printed = execFileSync(cli, ["--version"], { env, encoding: "utf8" });
    const version = parseVersion(printed);
    if (!version || !supportedVersion(version))
      return {
        ok: false as const,
        problem: {
          kind: "unsupported" as const,
          message: "Not a version Oriel works with.",
          ...(version ? { version: version.join(".") } : {}),
        },
      };
    return existsSync(join(home, ".signed-in"))
      ? { ok: true as const, cli: { path: cli, version: version.join(".") } }
      : { ok: false as const, problem: { kind: "signed-out" as const, message: "Signed out." } };
  };

  // An API key only the onboarding's key screen pastes.
  let key: string | null = null;
  const keys = {
    get: async () => key,
    set: async (next: string) => {
      key = next;
    },
    delete: async () => {
      key = null;
    },
  };
  const settings = options.data
    ? settingsFile(join(options.data, "settings.json"), () => {})
    : memorySettings();
  // Codex's check, as its stub answers: found, and signed in once its
  // sign-in left its mark. The real check, which starts Codex, never runs.
  const checkCodex = async ({ env: given, path }: CheckOptions) => {
    await look.promise;
    const cli = locateCodex(given ?? {}, path);
    if (!cli)
      return { ok: false as const, problem: { kind: "missing" as const, message: "Not found." } };
    return existsSync(join(home, ".codex-signed-in"))
      ? {
          ok: true as const,
          cli: { path: cli, version: "0.166.0" },
          models: [
            { id: "gpt-6.1-sol", label: "GPT-6.1-Sol", isDefault: true },
            { id: "gpt-6-luna", label: "GPT-6-Luna", isDefault: false },
          ],
          account: options.apiKeys
            ? { plan: null, email: null, personal: false }
            : { plan: "ChatGPT Plus", email: "sam@example.com", personal: true },
        }
      : { ok: false as const, problem: { kind: "signed-out" as const, message: "Signed out." } };
  };
  const chooser = models({
    key: null,
    kept: keys,
    env,
    check,
    checkCodex,
    trust: async () => null,
  });
  // Not awaited when it's held, so the page sees it still looking.
  void chooser.look(settings.get());

  const syn = loadJiraFixture();
  const site = memorySite(syn, instant(new Date()), {
    account: jiraAccount,
    projects: [
      {
        key: "MOB",
        name: "Mobile app",
        issues: 64,
        updated: instant(new Date("2025-06-30T10:00:00Z")),
      },
      {
        key: "DES",
        name: "Design requests",
        issues: 31,
        updated: instant(new Date("2025-03-12T10:00:00Z")),
      },
    ],
  });
  let searches = 0;
  const held = options.search === "held" ? site.hold("search") : null;
  if (held) holds.push(() => held.release());
  const fetchJira: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    // The second page of Jira's first sync doesn't come back.
    if (options.search === "fails" && url.includes("/search/jql") && ++searches > 1)
      throw new TypeError("fetch failed");
    return site.fetch(input, init);
  };
  // Google: the Sheets fixture's stand-in, and a token endpoint granting
  // its token for any code.
  const sheetsFixture = loadSheetsFixture();
  const tracker = sheetsFixture.spreadsheets.find((s) => s.slug === "tracker");
  for (let n = 1; n <= (options.sheetsTabs ?? 0); n++)
    tracker?.tabs.push({
      sheetId: 9000 + n,
      title: `Week ${n}`,
      rows: [
        ["Day", "Note"],
        ["Mon", "Stand-up moved"],
      ],
    });
  const google = fixtureGoogle(sheetsFixture);
  const fetchSheets: typeof fetch = async (input, init) =>
    String(input instanceof Request ? input.url : input) === tokenEndpoint
      ? Response.json({
          access_token: standInToken,
          expires_in: 3599,
          refresh_token: "shots-only-refresh",
          scope,
        })
      : google.fetch(input, init);
  // Jira connected before, as the secret store kept it until connections,
  // which the start moves into one.
  const secrets = memorySecrets(
    new Map(
      options.jira
        ? [
            [
              "jira",
              JSON.stringify({
                site: "https://oriel.atlassian.net",
                ...jiraAccount,
                project: "SYN",
              }),
            ],
          ]
        : [],
    ),
  );
  // SYN in memory, as one stand-in of Atlassian's server answers every
  // process: sync's and replay's.
  const atlassianTools = standInCaller(atlassianStandIn());
  const state = options.data ? setupFile(join(options.data, "setup.json")) : memorySetup();
  if (options.state) state.set({ ...state.get(), ...options.state });

  const serving = await start(0, {
    db: options.data ? join(options.data, "oriel.db") : (options.db ?? ":memory:"),
    secrets,
    sources: {
      jira: { mode: "window", fetch: fetchJira },
      ...(options.sheets ? { sheets: { mode: "window" as const, fetch: fetchSheets } } : {}),
    },
    // The person's agent, as a fake that asks the tiny server itself.
    discover: async () => ({
      agent: { id: "claude-code", name: "Claude Code" },
      found: options.atlassian
        ? [atlassianFound]
        : options.found || options.trackerOn
          ? [await askTiny()]
          : [],
    }),
    ...(options.atlassian
      ? {
          // Each process of the person's agent, as the stand-in answers it.
          callServer: async () => ({
            agent: { id: "claude-code", name: "Claude Code", kind: "claude-code" },
            calls: {
              call: atlassianTools,
              spent: () => ({
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                costUsd: 0,
                turns: 0,
              }),
              close: () => {},
            },
          }),
        }
      : { knownServers: testKnown }),
    ...(options.sheets ? { clients: { sheets: sheetsClient } } : {}),
    anywhere: true,
    legacyJira: legacySecret(secrets),
    models: chooser,
    settings,
    agent,
    cliPaths: true,
    keys: {
      store: keys,
      check: async (typed) => (typed.startsWith("sk-ant-") ? "ok" : "rejected"),
    },
    notify: async () => {},
    pickFolder,
    setup: {
      state,
      fresh: options.data !== undefined,
      home,
      env,
      trust: async () => null,
      installer: { script: async () => stubInstaller, latest: async () => "2.1.317" },
      testTurn: async () => ({
        said: options.refuses ?? null,
        inputTokens: options.refuses ? 0 : 2900,
        outputTokens: options.refuses ? 0 : 4,
      }),
      front: async () => {},
    },
  });
  if (options.atlassian) await postTo(serving, "/api/servers/look", {});
  if (options.atlassian === "on") {
    await postTo(serving, "/api/actions/source.on", { kind: "jira", server: "atlassian" });
    await postTo(serving, "/api/servers/dismiss", {});
    await serving.app.settled();
  }
  if (options.trackerOn) {
    await postTo(serving, "/api/servers/look", {});
    await postTo(serving, "/api/actions/source.on", { kind: "jira", server: "work-tracker" });
  }
  if (options.folder) {
    const url = new URL("/api/connections", serving.url);
    const reply = await serving.app.api(
      {
        method: "POST",
        url: url.pathname,
        headers: {
          host: url.host,
          origin: serving.url.replace(/\/$/, ""),
          "content-type": "application/json",
        },
        body: async () => JSON.stringify({ kind: "folder", given: { path: options.folder } }),
      },
      url,
    );
    if (!reply || reply.status !== 200) throw new Error("the first run's folder didn't connect");
  }
  return serving;
}

// A POST to the server's API, as the page sends it, which must work.
export async function postTo(serving: Serving, path: string, body: unknown): Promise<void> {
  const url = new URL(path, serving.url);
  const reply = await serving.app.api(
    {
      method: "POST",
      url: url.pathname,
      headers: {
        host: url.host,
        origin: serving.url.replace(/\/$/, ""),
        "content-type": "application/json",
      },
      body: async () => JSON.stringify(body),
    },
    url,
  );
  if (!reply || reply.status !== 200) throw new Error(`${path} didn't work`);
}

// A made-up client of Oriel's for Google, which only the stand-in sees.
const sheetsClient = {
  GOOGLE_CLIENT_ID: "shots-only.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "shots-only-value",
};

// Google's page, as a browser context shows it: signed in at once, with the
// fixture's tracker and RAID log picked, straight back to Oriel's loopback
// redirect. Nothing reaches Google.
export async function googleSignsIn(context: BrowserContext): Promise<void> {
  const picked = loadSheetsFixture()
    .spreadsheets.filter((s) => s.slug === "tracker" || s.slug === "raid")
    .map((s) => s.id);
  await context.route("https://accounts.google.com/**", async (route) => {
    const asked = new URL(route.request().url());
    const back = new URL(asked.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("state", asked.searchParams.get("state") ?? "");
    back.searchParams.set("code", "4/shots-only-code");
    back.searchParams.set("scope", scope);
    back.searchParams.set("picked_file_ids", picked.join(","));
    await route.fulfill({ status: 302, headers: { location: back.href } });
  });
}

// The details Jira takes, typed into the first run's form.
export async function fillJira(page: Page, token: string): Promise<void> {
  await page.locator('input[name="site"]').fill("oriel.atlassian.net");
  await page.locator('input[name="email"]').fill(jiraAccount.email);
  await page.locator('input[name="token"]').fill(token);
}

// "token" in what a screen shows: its text, and what fields and tooltips say.
export async function tokensOn(page: Page): Promise<number> {
  const text = await page.evaluate<string>(`[
    document.body.innerText,
    ...[...document.querySelectorAll("[placeholder], [title], [aria-label]")].flatMap((el) =>
      ["placeholder", "title", "aria-label"].map((name) => el.getAttribute(name) ?? ""),
    ),
  ].join("\\n")`);
  return (text.match(/\btokens?\b/gi) ?? []).length;
}

// One path of the onboarding budget (decisions 0038 and 0059), as fast as a
// script clicks: the first run's first screen on a fresh data folder, the
// AI, Your work, where the stand-in tracker is ready with no tracker to
// connect, the overview's question to start from, a plan drafted in the
// window chat, and that change approved. Returns how long it took, and
// "token" on each screen.
export async function timedPath(
  page: Page,
  url: string,
  path: "ready" | "signed-out" | "missing",
): Promise<{ ms: number; tokens: [string, number][] }> {
  const tokens: [string, number][] = [];
  const count = async (screen: string) => tokens.push([screen, await tokensOn(page)]);
  const opened = performance.now();
  await page.goto(url);
  await page.waitForURL(/\/setup$/);
  await page.locator(".provider-row#provider-claude-code").waitFor();
  await count("your AI");
  if (path === "missing") {
    await page.getByRole("button", { name: "Install", exact: true }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
    await count("installed");
  }
  if (path !== "ready") {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator(".provider-row[data-picked]").waitFor();
    await count("signed in");
  }
  await page.getByRole("button", { name: "Continue with Claude Code" }).click();
  await page.getByRole("heading", { name: "See what Oriel found" }).waitFor();
  await count("found");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: /Connect where your work lives|Welcome back/ }).waitFor();
  await page.locator(".provider-row", { hasText: "Epics and stories" }).waitFor();
  await count("your work");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL((at) => at.pathname === "/");
  await page.locator(".first-run-line").waitFor();
  await count("overview");
  await page.locator(".ask-question", { hasText: "Draft a small launch plan" }).click();
  await page.getByRole("button", { name: "Approve and apply" }).waitFor();
  await count("change set");
  await page.getByRole("button", { name: "Approve and apply" }).click();
  await page.locator('.change-set[data-status="applied"]').waitFor();
  await count("approved");
  return { ms: performance.now() - opened, tokens };
}

// Google Sheets' path (decision 0051), as fast as a script clicks: the first
// run's first screen on a fresh data folder, Claude Code ready, Sheets'
// Connect, the consent line, Google's page, signed in and picked at once,
// "Reading the headers", the draft in the row, Apply, the first sync, and
// the overview. The rest of the budget's path, a question and an approved
// change, is the window's, as on Jira's. Returns how long it took, how long
// the draft's turn kept the review waiting, and "token" on each screen.
export async function timedSheets(
  page: Page,
  url: string,
): Promise<{ ms: number; draftMs: number; tokens: [string, number][] }> {
  const tokens: [string, number][] = [];
  const count = async (screen: string) => tokens.push([screen, await tokensOn(page)]);
  const opened = performance.now();
  await page.goto(url);
  await page.waitForURL(/\/setup$/);
  await page.locator(".provider-row#provider-claude-code").waitFor();
  await page.getByRole("button", { name: "Continue with Claude Code" }).click();
  await page.getByRole("heading", { name: "See what Oriel found" }).waitFor();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: "Connect where your work lives" }).waitFor();
  await count("your work");
  const row = page.locator(".provider-row", { hasText: "Google Sheets" });
  await row.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "Connect Google Sheets" }).waitFor();
  await count("Google Sheets");
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Continue to Google" }).click();
  const google = await popup;
  await google.waitForLoadState();
  await google.close();
  // Back in Oriel: the headers read, then the draft, in the row.
  const asked = performance.now();
  await row.locator(".connect-review").waitFor();
  await row.getByText("Oriel's draft.").waitFor();
  const draftMs = performance.now() - asked;
  await count("review");
  await row.getByRole("button", { name: "Apply" }).click();
  await row.locator(".provider-status[data-connected]").waitFor();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL((at) => at.pathname === "/");
  await count("overview");
  return { ms: performance.now() - opened, draftMs, tokens };
}
