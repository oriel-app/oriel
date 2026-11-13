import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import {
  type CheckOptions,
  locateClaudeCode,
  locateCodex,
  parseVersion,
  supportedVersion,
} from "../packages/agent/src/index.ts";
import type { AppOptions } from "../packages/server/src/app.ts";
import { models } from "../packages/server/src/model.ts";
import type { Serving } from "../packages/server/src/serve.ts";
import { askTiny, testKnown } from "../packages/server/src/servers/testing.ts";
import { atlassianServer } from "../packages/jira/src/atlassian.ts";
import { atlassianStandIn, standInCaller } from "../packages/jira/src/atlassian-standin.ts";
import { slackServer } from "../packages/slack/src/slack-mcp.ts";
import { slackStandIn, standInCaller as slackCaller } from "../packages/slack/src/slack-standin.ts";
import type { SlackFixture } from "../packages/slack/src/fixture.ts";
import { standInFound as linearFound } from "../packages/linear/src/declared-fixture.ts";
import {
  linearStandIn,
  standInCaller as linearCaller,
} from "../packages/linear/src/linear-standin.ts";
import { memorySettings, settingsFile } from "../packages/server/src/settings.ts";
import { type SetupState, memorySetup, setupFile } from "../packages/server/src/setup/state.ts";
import { loadSheetsFixture } from "../packages/sheets/src/fixture.ts";
import { fixtureGoogle } from "../packages/sheets/src/stand-in.ts";
import { fixtureServer } from "../packages/sheets/src/sheets-mcp-fake.ts";
import { loadCalls as loadSheetsCalls } from "../packages/sheets/src/calls.ts";
import { sheetsMcpMain, sheetsServer } from "../packages/sheets/src/sheets-mcp.ts";
import { replayCalls } from "../packages/core/src/recorded-calls.ts";

type Login = "works" | "waits" | "fails";
type Install = "works" | "waits" | "fails";

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
  cli?: { version?: string; signedIn?: boolean };
  codex?: true | "ready";
  apiKeys?: true;
  install?: Install;
  login?: Login;
  refuses?: string;
  stillLooking?: true;
  state?: Partial<SetupState>;
  folder?: string;
  data?: string;
  db?: string;
  found?: true;
  atlassian?: "found" | "on";
  slack?: "found" | "on";
  slackFixture?: SlackFixture;
  linear?: "found" | "on";
  sheetsMcp?: "found" | "on";
  sheetsTabs?: number;
  aiGone?: true;
};

const sheetsMcpFound = {
  name: "sheets",
  status: "connected" as const,
  reports: sheetsServer.reports,
  url: null,
  command: `node ${sheetsMcpMain}`,
  tools: [...sheetsServer.reads, ...sheetsServer.writes],
  local: { command: "node", args: [sheetsMcpMain] },
};

const atlassianFound = {
  name: "atlassian",
  status: "connected" as const,
  reports: atlassianServer.reports,
  url: "https://mcp.atlassian.com/v2/mcp?tools=all",
  command: null,
  tools: [...atlassianServer.reads, ...atlassianServer.writes],
  transport: "http" as const,
};

const slackFound = {
  name: "slack",
  status: "connected" as const,
  reports: slackServer.reports,
  url: "https://mcp.slack.com/mcp",
  command: null,
  tools: [...slackServer.reads, ...slackServer.writes],
  transport: "http" as const,
};

type Start = (
  port: number,
  options: Omit<AppOptions, "reviewBase" | "sketchBase">,
) => Promise<Serving>;

const homes: string[] = [];
export const keepUntilDone = (folder: string) => void homes.push(folder);
const holds: (() => void)[] = [];
export const releaseAll = () => {
  for (const release of holds.splice(0)) release();
};
// These close only after `releaseAll`: let go while closing, what they held would finish on a
// closed server.
export const holdsUp = new WeakSet<Serving>();
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

  let gone = false;
  const settings = options.data
    ? settingsFile(join(options.data, "settings.json"), () => {})
    : memorySettings();
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
    env,
    check,
    checkCodex,
    trust: async () => null,
  });
  void chooser.look(settings.get());

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
  const atlassianTools = standInCaller(atlassianStandIn());
  const slackTools = slackCaller(slackStandIn(options.slackFixture));
  const linearTools = linearCaller(linearStandIn());
  const sheetsTools =
    options.sheetsTabs === undefined
      ? replayCalls(["preview.json", "sync.json"].flatMap((name) => loadSheetsCalls(name).calls))
      : fixtureServer(
          fixtureGoogle(sheetsFixture),
          sheetsFixture.spreadsheets.map((each) => each.id),
        ).read;
  const standing = options.atlassian || options.slack || options.linear || options.sheetsMcp;
  const state = options.data ? setupFile(join(options.data, "setup.json")) : memorySetup();
  if (options.state) state.set({ ...state.get(), ...options.state });

  const serving = await start(0, {
    db: options.data ? join(options.data, "oriel.db") : (options.db ?? ":memory:"),
    discover: async () => {
      if (gone) return null;
      const running = chooser.choose(settings.get()).model?.provider;
      return {
        agent: running
          ? { id: running.id, name: running.name }
          : { id: "claude-code", name: "Claude Code" },
        found: standing
          ? [
              ...(options.atlassian ? [atlassianFound] : []),
              ...(options.slack ? [slackFound] : []),
              ...(options.linear ? [linearFound] : []),
              ...(options.sheetsMcp ? [sheetsMcpFound] : []),
            ]
          : options.found
            ? [await askTiny()]
            : [],
      };
    },
    ...(standing
      ? {
          callServer: async (server) =>
            gone
              ? null
              : {
                  agent: { id: "claude-code", name: "Claude Code", kind: "claude-code" },
                  calls: {
                    call:
                      server.name === "slack"
                        ? slackTools
                        : server.name === linearFound.name
                          ? linearTools
                          : server.name === sheetsMcpFound.name
                            ? sheetsTools
                            : atlassianTools,
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
                },
        }
      : { knownServers: testKnown }),
    models: chooser,
    settings,
    agent,
    cliPaths: true,
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
  if (standing) await postTo(serving, "/api/servers/look", {});
  if (options.atlassian === "on")
    await postTo(serving, "/api/actions/source.on", { kind: "jira", server: "atlassian" });
  if (options.slack === "on")
    await postTo(serving, "/api/actions/source.on", { kind: "slack", server: "slack" });
  if (options.linear === "on")
    await postTo(serving, "/api/actions/source.on", { kind: "linear", server: linearFound.name });
  if (options.sheetsMcp === "on")
    await postTo(serving, "/api/actions/source.on", {
      kind: "sheets",
      server: sheetsMcpFound.name,
    });
  if (
    options.atlassian === "on" ||
    options.slack === "on" ||
    options.linear === "on" ||
    options.sheetsMcp === "on"
  ) {
    await postTo(serving, "/api/servers/dismiss", {});
    await serving.app.settled();
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
  if (options.aiGone) {
    gone = true;
    rmSync(join(home, ".signed-in"), { force: true });
    rmSync(join(home, ".codex-signed-in"), { force: true });
    await postTo(serving, "/api/settings/look", {});
    await postTo(serving, "/api/servers/look", {});
  }
  if (options.stillLooking || options.install === "waits" || options.login === "waits")
    holdsUp.add(serving);
  return serving;
}

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

export async function tokensOn(page: Page): Promise<number> {
  const text = await page.evaluate<string>(`[
    document.body.innerText,
    ...[...document.querySelectorAll("[placeholder], [title], [aria-label]")].flatMap((el) =>
      ["placeholder", "title", "aria-label"].map((name) => el.getAttribute(name) ?? ""),
    ),
  ].join("\\n")`);
  return (text.match(/\btokens?\b/gi) ?? []).length;
}

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
  await page.getByRole("heading", { name: /See your work in one place|Welcome back/ }).waitFor();
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
