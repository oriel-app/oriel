// `pnpm shots`: screenshots of every screen, for looking at. A tool, not a
// test. It drives the installed Chrome, downloads no browser, and writes PNGs
// to the gitignored shots/. `pnpm shots` builds the web app first.
//
// The servers run on the SYN fixture in memory, with the scripted agent,
// whose runs go to the real sandbox (Deno). One writes to SYN as a Jira site
// in memory; the other is read-only, as Oriel is without credentials. Before
// any screenshot they get groups and threads, with runs, change sets, a
// search and a marker, through the same JSON routes the window uses.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { instant } from "../packages/core/src/ids.ts";
import { memorySite, memorySiteOrigin } from "../packages/jira/src/memory-site.ts";
import { type Serving, serve } from "../packages/server/src/serve.ts";
import { loadJiraFixture } from "./fixtures/load.ts";

type Grouping = "epic" | "assignee" | "stuck";
type Scene = { name: string; path: string; on?: Serving; act?(page: Page): Promise<void> };

const out = new URL("../shots/", import.meta.url);
mkdirSync(out, { recursive: true });

const site = memorySite(loadJiraFixture(), instant(new Date()));
const server = await serve(0, {
  db: ":memory:",
  jira: {
    kind: "fixture",
    writeTo: {
      site: memorySiteOrigin,
      credential: { headers: async () => ({}) },
      project: "SYN",
      fetch: site.fetch,
    },
  },
});
const readOnly = await serve(0);

// A request as the window sends it.
async function call<T>(on: Serving, method: string, path: string, body?: unknown): Promise<T> {
  const url = new URL(path, on.url);
  const reply = await on.app.api(
    {
      method,
      url: url.pathname,
      headers: {
        host: url.host,
        origin: on.url.replace(/\/$/, ""),
        "content-type": "application/json",
      },
      body: async () => JSON.stringify(body ?? {}),
    },
    url,
  );
  if (!reply || reply.status >= 300)
    throw new Error(`${method} ${path}: ${reply?.status} ${String(reply?.body)}`);
  return JSON.parse(String(reply.body)) as T;
}
const post = <T>(path: string, body: unknown, on: Serving = server) =>
  call<T>(on, "POST", path, body);
const changeSetOf = async (on: Serving, threadId: string): Promise<string> => {
  const view = await call<{ changeSets: { id: string }[] }>(on, "GET", `/api/threads/${threadId}`);
  const id = view.changeSets[0]?.id;
  if (!id) throw new Error("the scripted agent proposed no change set");
  return id;
};
const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

// SYN-1's epic cluster, keyed by the epic's stable ID.
const group = await post<{ id: string }>("/api/groups", checkout);
const ask = async (text: string, on: Serving = server, groupId = group.id) => {
  const opened = await post<{ id: string }>(`/api/groups/${groupId}/threads`, { text }, on);
  await on.app.settled();
  return opened.id;
};
const thread = await ask("Which stories here still need estimates?");
await post(`/api/threads/${thread}/messages`, { text: "Find anything about weather" });
await server.app.settled();
const changeSet = await changeSetOf(server, thread);
const link = await post<{ url: string }>(`/api/change-sets/${changeSet}/review-link`, {});

// The same question, approved while Jira refuses one of the writes: the
// change set applies partway and says where it stopped.
const partial = await ask("Estimate what's missing");
const partialSet = await changeSetOf(server, partial);
site.refuse("SYN-99");
const { hash } = await post<{ hash: string }>(`/api/change-sets/${partialSet}/diff`, {});
await post(`/api/change-sets/${partialSet}/approve`, { hash });
site.allow("SYN-99");

// Answered, over items it needn't change: the user marks it done.
await post(`/api/threads/${await ask("What's in here?")}/done`, {});
// A later change to the group shows in working threads as a marker.
await post(`/api/groups/${group.id}/add`, { items: ["jira:SYN-3"] });

// Without credentials: change sets can be reviewed and rejected only.
const readOnlyGroup = await post<{ id: string }>("/api/groups", checkout, readOnly);
const readOnlyThread = await ask("Which stories need estimates?", readOnly, readOnlyGroup.id);

// A folder of notes beside Jira, and a group that mixes both.
const notes = join(realpathSync(mkdtempSync(join(tmpdir(), "oriel-shots-"))), "Launch notes");
const note = (name: string, body: string) => {
  mkdirSync(dirname(join(notes, name)), { recursive: true });
  writeFileSync(join(notes, name), body);
};
note("Launch plan.md", "# Launch plan\n\nPhone wallets first, then saved cards.");
note("Customer interviews.md", "Five PMs; three asked for saved cards before anything else.");
note("research/Competitor checkout teardown.md", "How three checkouts handle a declined card.");
await post("/api/folder", { path: notes });
const files = server.app
  .window("epic")
  .clusters.flatMap((c) => c.list)
  .filter((row) => row.id.startsWith("folder:"));
const mixed = await post<{ id: string }>("/api/groups", {
  kind: "picked",
  name: "Saved cards launch",
  items: ["jira:SYN-23", "jira:SYN-99", "jira:SYN-104", ...files.map((file) => file.id)],
});
const mixedThread = await ask("What's in here?", server, mixed.id);

async function shown(page: Page, grouping: Grouping): Promise<void> {
  await page.locator(`main[aria-busy="false"] .clusters[data-grouping="${grouping}"]`).waitFor();
}

async function openFirstCluster(page: Page): Promise<void> {
  await page.locator(".cluster-toggle").first().click();
  await page.locator('.cluster-toggle[aria-expanded="true"]').first().waitFor();
}

async function openAll(page: Page): Promise<void> {
  // Each click opens one, so the first closed one is a different cluster each time.
  const closed = page.locator('.cluster-toggle[aria-expanded="false"]');
  for (let left = await closed.count(); left > 0; left -= 1) {
    await closed.first().click();
    await page.waitForFunction(
      `document.querySelectorAll('.cluster-toggle[aria-expanded="false"]').length < ${left}`,
    );
  }
}

const scenes: Scene[] = [
  { name: "epic", path: "/?grouping=epic", act: (page) => shown(page, "epic") },
  {
    name: "epic-expanded",
    path: "/?grouping=epic",
    act: async (page) => {
      await shown(page, "epic");
      await openFirstCluster(page);
    },
  },
  {
    name: "epic-picked",
    path: "/?grouping=epic",
    act: async (page) => {
      await shown(page, "epic");
      await openFirstCluster(page);
      const boxes = page.locator('.item input[type="checkbox"]');
      await boxes.nth(1).check();
      await boxes.nth(2).check();
      await page.locator(".selection-bar").waitFor();
    },
  },
  { name: "assignee", path: "/?grouping=assignee", act: (page) => shown(page, "assignee") },
  {
    name: "assignee-expanded",
    path: "/?grouping=assignee",
    act: async (page) => {
      await shown(page, "assignee");
      await openAll(page);
    },
  },
  { name: "stuck", path: "/?grouping=stuck", act: (page) => shown(page, "stuck") },
  {
    name: "stuck-expanded",
    path: "/?grouping=stuck",
    act: async (page) => {
      await shown(page, "stuck");
      await openAll(page);
    },
  },
  {
    name: "group",
    path: `/groups/${group.id}`,
    act: (page) => page.locator(".group-page .members").waitFor(),
  },
  {
    name: "group-mixed",
    path: `/groups/${mixed.id}`,
    act: (page) => page.locator(".group-page .members").waitFor(),
  },
  {
    name: "thread-mixed",
    path: `/threads/${mixedThread}`,
    act: async (page) => {
      await page.locator(".run summary").first().click();
      await page.locator(".run[open] .output").first().waitFor();
    },
  },
  {
    name: "folder-add",
    path: "/?grouping=epic",
    act: async (page) => {
      await shown(page, "epic");
      await page.getByRole("button", { name: "Use another folder" }).click();
      await page.locator(".folder-form input").fill("~/notes/launch");
    },
  },
  {
    name: "thread",
    path: `/threads/${thread}`,
    act: async (page) => {
      await page.locator(".change-set .diff").waitFor();
      await page.locator(".search-block").waitFor();
    },
  },
  {
    name: "thread-run-open",
    path: `/threads/${thread}`,
    act: async (page) => {
      await page.locator(".change-set .diff").waitFor();
      await page.locator(".run summary").first().click();
      await page.locator(".run[open] .code").first().waitFor();
    },
  },
  {
    name: "thread-partial",
    path: `/threads/${partial}`,
    act: (page) => page.locator(".diff-line[data-stopped] .line-error").waitFor(),
  },
  {
    name: "thread-read-only",
    path: `/threads/${readOnlyThread}`,
    on: readOnly,
    act: (page) => page.locator(".read-only-note").waitFor(),
  },
  {
    name: "inbox",
    path: "/inbox",
    act: (page) => page.locator(".inbox .thread-list").first().waitFor(),
  },
  {
    name: "review",
    path: new URL(link.url).pathname,
    act: async (page) => {
      await page.getByRole("button", { name: "Show the change" }).click();
      await page.locator(".review-card .diff").waitFor();
    },
  },
];
const widths = [1280, 390];
const themes = ["light", "dark"] as const;

const browser = await chromium.launch({ channel: "chrome" });
const problems: string[] = [];
try {
  for (const theme of themes) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: width < 600 ? 844 : 800 },
        deviceScaleFactor: 2,
        colorScheme: theme,
        locale: "en-US",
        timezoneId: "UTC",
      });
      const page = await context.newPage();
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
          problems.push(`${theme} ${width}: console ${message.type()}: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => problems.push(`${theme} ${width}: ${error.message}`));
      for (const scene of scenes) {
        await page.goto(new URL(scene.path, (scene.on ?? server).url).href);
        await scene.act?.(page);
        const path = fileURLToPath(new URL(`${scene.name}-${theme}-${width}.png`, out));
        await page.screenshot({ path, fullPage: true, animations: "disabled" });
        console.log(path);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
  await readOnly.close();
  rmSync(dirname(notes), { recursive: true, force: true });
}

for (const problem of problems) console.error(problem);
process.exitCode = problems.length === 0 ? 0 : 1;
