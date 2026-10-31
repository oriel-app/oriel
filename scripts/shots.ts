// `pnpm shots`: screenshots of every screen, for looking at. A tool, not a
// test. It drives the installed Chrome, downloads no browser, and writes PNGs
// to the gitignored shots/. `pnpm shots` builds the web app first.
//
// The servers run on the SYN fixture in memory, with the scripted agent,
// whose runs go to the real sandbox (Deno). Most write to SYN as a Jira site
// in memory, each to its own, so one scene's writes don't show in another's
// diffs; one is read-only, as Oriel is without credentials. Before any
// screenshot they get groups and threads, with runs, change sets, a search
// and a marker, through the same JSON routes the window uses. One also reads
// the Slack fixture's picked channel, read-only.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { instant } from "../packages/core/src/ids.ts";
import { memorySite, memorySiteOrigin } from "../packages/jira/src/memory-site.ts";
import type { TurnInput } from "../packages/server/src/agent.ts";
import type { SlackMode } from "../packages/server/src/app.ts";
import { devPlan, scriptedAgent, type Step } from "../packages/server/src/scripted-agent.ts";
import { type Serving, serve } from "../packages/server/src/serve.ts";
import { loadJiraFixture } from "./fixtures/load.ts";

type Grouping = "epic" | "assignee" | "stuck";
type Scene = { name: string; path: string; on?: Serving; act?(page: Page): Promise<void> };

const out = new URL("../shots/", import.meta.url);
mkdirSync(out, { recursive: true });

// What the scripted agent proposes when asked to plan: the checkout epic
// renamed, a story's description reworded, an estimate, and two new stories
// in the epic. Asked to plan only, it proposes just the new stories.
const planScript = (all: boolean) =>
  [
    ...(all
      ? [
          'jira.setSummary("jira:SYN-1", "Checkout v2: phone wallets, saved cards and gift cards");',
          'jira.setDescription("jira:SYN-23", "Same as the app, for every browser that supports it. Show the card form otherwise.");',
          'jira.setEstimate("jira:SYN-99", 3);',
        ]
      : []),
    'jira.createStory({ summary: "Pay with a gift card", description: "Enter the code from the card. A balance that doesn\'t cover the fare is topped up with another way to pay.", points: 3 });',
    'jira.createStory({ summary: "Show the gift card balance at checkout" });',
    "return null;",
  ].join("\n");
// Asked to mark stories done: two moved to Done, the built ones or the fixes.
const finishScript = (keys: readonly string[]) =>
  [...keys.map((key) => `jira.setStatus("jira:${key}", "Done");`), "return null;"].join("\n");
const planning = (input: TurnInput): Step[] => {
  if (/\bplan\b/i.test(input.text))
    return [
      { run: planScript(/rename/i.test(input.text)) },
      { text: "The proposed change is below." },
    ];
  if (/\bdone\b/i.test(input.text))
    return [
      {
        run: finishScript(
          /\bbuilt\b/i.test(input.text) ? ["SYN-23", "SYN-99"] : ["SYN-21", "SYN-104"],
        ),
      },
      { text: "The proposed change is below." },
    ];
  return devPlan(input);
};

// A server that writes to its own SYN site in memory, and reads Slack when
// given it.
const writing = async (slack?: SlackMode) => {
  const site = memorySite(loadJiraFixture(), instant(new Date()));
  const serving = await serve(0, {
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
    ...(slack ? { slack } : {}),
    agent: (deps) => scriptedAgent(deps, planning),
  });
  return { site, serving };
};
const server = (await writing()).serving;
const refusing = await writing();
const unanswered = await writing();
const holding = await writing();
const readOnly = await serve(0);
const chatty = (await writing({ kind: "fixture" })).serving;

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

// The same question, approved while one of the writes fails: the change
// set applies partway and says where it stopped. Jira refuses it, so nothing
// of it landed; or it goes out and no answer comes back, so it may have.
const stopAt = async (
  { site, serving }: Awaited<ReturnType<typeof writing>>,
  how: "refuse" | "loseAnswers",
) => {
  const { id: groupId } = await post<{ id: string }>("/api/groups", checkout, serving);
  const threadId = await ask("Estimate what's missing", serving, groupId);
  const setId = await changeSetOf(serving, threadId);
  site[how]("SYN-99");
  const { hash } = await post<{ hash: string }>(`/api/change-sets/${setId}/diff`, {}, serving);
  await post(`/api/change-sets/${setId}/approve`, { hash }, serving);
  site.allow("SYN-99");
  return threadId;
};
const partial = await stopAt(refusing, "refuse");
const unheard = await stopAt(unanswered, "loseAnswers");

// Another set stopped the same way; the refused change left out, and a
// review link shared for the rest: the reviewer may approve it or dismiss it.
const partlyReviewed = await (async () => {
  const threadId = await stopAt(refusing, "refuse");
  const setId = await changeSetOf(refusing.serving, threadId);
  const { lines } = await post<{ lines: { mutationId: string }[] }>(
    `/api/change-sets/${setId}/diff`,
    {},
    refusing.serving,
  );
  const refused = lines[1]?.mutationId;
  await post(`/api/change-sets/${setId}/edit`, { remove: [refused] }, refusing.serving);
  return post<{ url: string }>(`/api/change-sets/${setId}/review-link`, {}, refusing.serving);
})();

// Approving, with SYN-99's write held in flight until the shots are taken:
// the change set says it is being applied, and offers nothing else.
const inFlight = await (async () => {
  const { site, serving } = holding;
  const { id: groupId } = await post<{ id: string }>("/api/groups", checkout, serving);
  const threadId = await ask("Estimate what's missing", serving, groupId);
  const setId = await changeSetOf(serving, threadId);
  const held = site.hold("SYN-99");
  const { hash } = await post<{ hash: string }>(`/api/change-sets/${setId}/diff`, {}, serving);
  const approving = post(`/api/change-sets/${setId}/approve`, { hash }, serving);
  await held.reached;
  return { threadId, release: held.release, approving };
})();

// A plan: the epic renamed, a description reworded, and new stories in it.
const planned = await ask("Rename the epic and plan gift cards in it");
const plannedLink = await post<{ url: string }>(
  `/api/change-sets/${await changeSetOf(server, planned)}/review-link`,
  {},
);
// New stories, approved, then reverted: the revert deletes them.
const reverted = await (async () => {
  const threadId = await ask("Plan gift cards");
  const setId = await changeSetOf(server, threadId);
  const { hash } = await post<{ hash: string }>(`/api/change-sets/${setId}/diff`, {});
  await post(`/api/change-sets/${setId}/approve`, { hash });
  await post(`/api/change-sets/${setId}/revert`, {});
  return threadId;
})();

// Stories moved to Done: proposed, and another approved, then reverted.
const finished = await ask("Mark the built stories done");
const unfinished = await (async () => {
  const threadId = await ask("Mark the fixes done");
  const setId = await changeSetOf(server, threadId);
  const { hash } = await post<{ hash: string }>(`/api/change-sets/${setId}/diff`, {});
  await post(`/api/change-sets/${setId}/approve`, { hash });
  await post(`/api/change-sets/${setId}/revert`, {});
  return threadId;
})();

// A long ask, as a PM writes one: its title is short enough to scan.
const longAsk = await ask(
  "I'm meeting the payments team tomorrow morning and want to walk in knowing where checkout stands. Which stories in this epic have nobody on them, and is anything stopping saved cards from shipping this quarter? A short list I can paste into the meeting notes would be ideal.",
);
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

// Slack messages beside Jira items: the fare decision, with its replies, and
// the SMS wording thread, in a group with the stories they're about.
const fares = await post<{ id: string }>(
  "/api/groups",
  {
    kind: "picked",
    name: "Fares after cancellations",
    items: [
      "jira:SYN-45",
      "jira:SYN-61",
      "slack:C0FW1WEATHR-1788444000.000100",
      "slack:C0FW1WEATHR-1788782400.000100",
    ],
  },
  chatty,
);
const faresThread = await ask("What's in here?", chatty, fares.id);

// A group of one item, and one with none left, for how the page counts them.
const single = await post<{ id: string }>("/api/groups", {
  kind: "picked",
  name: "Declined card retry",
  items: ["jira:SYN-23"],
});
const emptied = await post<{ id: string }>("/api/groups", {
  kind: "picked",
  name: "Gift cards",
  items: ["jira:SYN-99"],
});
await post(`/api/groups/${emptied.id}/remove`, { items: ["jira:SYN-99"] });

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
    name: "slack-window",
    path: "/?grouping=epic",
    on: chatty,
    act: async (page) => {
      await shown(page, "epic");
      await page.locator(".cluster-toggle", { hasText: "No epics in this source" }).click();
      await page.locator('.cluster-toggle[aria-expanded="true"]').first().waitFor();
    },
  },
  {
    name: "group-slack",
    path: `/groups/${fares.id}`,
    on: chatty,
    act: (page) => page.locator(".group-page .members").waitFor(),
  },
  {
    name: "thread-slack",
    path: `/threads/${faresThread}`,
    on: chatty,
    act: async (page) => {
      await page.locator(".run summary").first().click();
      await page.locator(".run[open] .output").first().waitFor();
    },
  },
  {
    name: "group-one",
    path: `/groups/${single.id}`,
    act: (page) => page.locator(".group-page .members").waitFor(),
  },
  {
    name: "group-empty",
    path: `/groups/${emptied.id}`,
    act: (page) => page.locator(".group-page .rail-empty").waitFor(),
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
    // The threads waiting on the user, in the sidebar; on a narrow screen,
    // in its drawer.
    name: "needs-you",
    path: `/groups/${mixed.id}`,
    act: async (page) => {
      await page.locator(".nav-waiting-link").first().waitFor({ state: "attached" });
      if ((page.viewportSize()?.width ?? 0) <= 760) {
        await page.getByRole("button", { name: "Open the sidebar" }).click();
        await page.locator(".shell[data-drawer] .sidebar").waitFor();
      }
    },
  },
  {
    name: "folder-add",
    path: "/?grouping=epic",
    act: async (page) => {
      await shown(page, "epic");
      // On a narrow screen the folder is in the sidebar's drawer.
      if ((page.viewportSize()?.width ?? 0) <= 760) {
        await page.getByRole("button", { name: "Open the sidebar" }).click();
        await page.locator(".shell[data-drawer] .sidebar").waitFor();
      }
      await page.getByRole("button", { name: "Use another folder" }).click();
      await page.locator(".folder-form input").fill("~/notes/launch");
    },
  },
  {
    name: "thread",
    path: `/threads/${thread}`,
    act: async (page) => {
      await page.locator(".change-set .diff").waitFor();
      // Approving waits for the diff to be shown, and the thread to reload.
      await page.getByRole("button", { name: "Approve and apply" }).waitFor();
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
    name: "thread-plan",
    path: `/threads/${planned}`,
    act: async (page) => {
      await page.locator(".change-set .diff").waitFor();
      await page.getByRole("button", { name: "Approve and apply" }).waitFor();
    },
  },
  {
    name: "thread-long-ask",
    path: `/threads/${longAsk}`,
    act: (page) => page.locator(".run").first().waitFor(),
  },
  {
    name: "new-thread",
    path: "/threads/new",
    act: (page) =>
      page
        .getByRole("textbox", { name: "Message" })
        .fill("Plan kiosk wallets: an epic, and stories for tap to pay and receipts"),
  },
  {
    name: "thread-revert",
    path: `/threads/${reverted}`,
    act: (page) => page.locator(".change-set .change-set .diff").waitFor(),
  },
  {
    name: "thread-status",
    path: `/threads/${finished}`,
    act: (page) => page.getByRole("button", { name: "Approve and apply" }).waitFor(),
  },
  {
    name: "thread-status-revert",
    path: `/threads/${unfinished}`,
    act: (page) => page.locator(".change-set .change-set .diff").waitFor(),
  },
  {
    name: "thread-partial",
    path: `/threads/${partial}`,
    on: refusing.serving,
    act: (page) => page.locator(".diff-line[data-stopped] .line-error").waitFor(),
  },
  {
    name: "thread-unanswered",
    path: `/threads/${unheard}`,
    on: unanswered.serving,
    act: (page) => page.locator(".may-have-landed").waitFor(),
  },
  {
    name: "thread-applying",
    path: `/threads/${inFlight.threadId}`,
    on: holding.serving,
    act: (page) => page.locator('.change-set[data-status="applying"]').waitFor(),
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
  {
    name: "review-plan",
    path: new URL(plannedLink.url).pathname,
    act: async (page) => {
      await page.getByRole("button", { name: "Show the change" }).click();
      await page.locator(".review-card .diff").waitFor();
    },
  },
  {
    name: "review-partial",
    path: new URL(partlyReviewed.url).pathname,
    on: refusing.serving,
    act: async (page) => {
      await page.getByRole("button", { name: "Show the change" }).click();
      await page.getByRole("button", { name: "Dismiss" }).waitFor();
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
  await refusing.serving.close();
  await unanswered.serving.close();
  inFlight.release();
  await inFlight.approving;
  await holding.serving.close();
  await readOnly.close();
  await chatty.close();
  rmSync(dirname(notes), { recursive: true, force: true });
}

for (const problem of problems) console.error(problem);
process.exitCode = problems.length === 0 ? 0 : 1;
