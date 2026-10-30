// `pnpm shots`: screenshots of every screen, for looking at. A tool, not a
// test. It drives the installed Chrome, downloads no browser, and writes PNGs
// to the gitignored shots/. `pnpm shots` builds the web app first.
//
// The server runs on the SYN fixture in memory, with the scripted agent,
// whose runs go to the real sandbox (Deno). Before any screenshot it makes a
// group from a cluster and a thread on it with a run, a change set and a
// search, through the same JSON routes the window uses.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { serve } from "../packages/server/src/serve.ts";

type Grouping = "epic" | "assignee" | "stuck";
type Scene = { name: string; path: string; act?(page: Page): Promise<void> };

const out = new URL("../shots/", import.meta.url);
mkdirSync(out, { recursive: true });

const server = await serve(0);
const origin = server.url.replace(/\/$/, "");

// A POST as the window sends it.
async function post<T>(path: string, body: unknown): Promise<T> {
  const url = new URL(path, server.url);
  const reply = await server.app.api(
    {
      method: "POST",
      url: url.pathname,
      headers: { host: url.host, origin, "content-type": "application/json" },
      body: async () => JSON.stringify(body),
    },
    url,
  );
  if (!reply || reply.status >= 300)
    throw new Error(`POST ${path}: ${reply?.status} ${String(reply?.body)}`);
  return JSON.parse(String(reply.body)) as T;
}

// SYN-1's epic cluster, keyed by the epic's stable ID.
const group = await post<{ id: string }>("/api/groups", {
  kind: "cluster",
  grouping: "epic",
  cluster: "10001",
});
const thread = await post<{ id: string }>(`/api/groups/${group.id}/threads`, {
  text: "Which stories here still need estimates?",
});
await server.app.settled();
await post(`/api/threads/${thread.id}/messages`, { text: "Find anything about weather" });
await server.app.settled();
const answered = await post<{ id: string }>(`/api/groups/${group.id}/threads`, {
  text: "What's in here?",
});
await server.app.settled();
// Answered, over items it needn't change: the user marks it done.
await post(`/api/threads/${answered.id}/done`, {});
const threadView = await (await fetch(new URL(`/api/threads/${thread.id}`, server.url))).json();
const changeSet = (threadView as { changeSets: { id: string }[] }).changeSets[0];
if (!changeSet) throw new Error("the scripted agent proposed no change set");
const link = await post<{ url: string }>(`/api/change-sets/${changeSet.id}/review-link`, {});
// A later change to the group shows in the thread as a marker.
await post(`/api/groups/${group.id}/add`, { items: ["jira:SYN-3"] });

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
    name: "thread",
    path: `/threads/${thread.id}`,
    act: async (page) => {
      await page.locator(".change-set .diff").waitFor();
      await page.locator(".search-block").waitFor();
    },
  },
  {
    name: "thread-run-open",
    path: `/threads/${thread.id}`,
    act: async (page) => {
      await page.locator(".change-set .diff").waitFor();
      await page.locator(".run summary").first().click();
      await page.locator(".run[open] .code").first().waitFor();
    },
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
        await page.goto(new URL(scene.path, server.url).href);
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
}

for (const problem of problems) console.error(problem);
process.exitCode = problems.length === 0 ? 0 : 1;
