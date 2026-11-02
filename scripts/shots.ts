// `pnpm shots`: screenshots of every screen, for looking at. A tool, not a
// test. It drives the installed Chrome, downloads no browser, and writes PNGs
// to the gitignored shots/. `pnpm shots` builds the web app first.
//
// The servers run on the SYN fixture in memory, with the scripted agent,
// whose runs go to the real sandbox (Deno). Most write to SYN as a Jira site
// in memory, each to its own, so one scene's writes don't show in another's
// diffs; one is read-only, as Oriel is without credentials. Before any
// screenshot they get workstreams and threads, with runs, change sets, a search
// and a marker, through the same JSON routes the window uses. Two start with
// Jira unconnected, to connect it from the window to SYN in memory: one for
// the form's shots, and one for the onboarding, timed from the first screen
// to an approved change, which also counts the word "token" on each screen.
// One more connects Jira to SYN with no issues, as a new project is. Another
// reads the Slack fixture's picked channel. Three more hand a story to the
// team: one change set moves it in Jira and posts in Slack's channel,
// proposed on one, approved on the next, and reverted on the last (OA-28).
//
// `pnpm shots --width 1440 panel-` takes only the scenes whose names
// start with `panel-`, at 1440px wide; with neither, every scene at 1280px
// and 390px, and the onboarding.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Page, type Route } from "playwright-core";
import { type Instant, instant } from "../packages/core/src/ids.ts";
import { memorySite, memorySiteOrigin } from "../packages/jira/src/memory-site.ts";
import type { TurnInput } from "../packages/server/src/agent.ts";
import { memoryStore } from "../packages/server/src/connection.ts";
import type { SlackMode } from "../packages/server/src/app.ts";
import { devPlan, scriptedAgent, type Step } from "../packages/server/src/scripted-agent.ts";
import { type Serving, serve } from "../packages/server/src/serve.ts";
import { loadJiraFixture } from "./fixtures/load.ts";

type Grouping = "epic" | "assignee" | "stuck";
type Scene = {
  name: string;
  path: string;
  on?: Serving;
  act?(page: Page): Promise<void>;
  // A refusal the scene asks for, which the browser logs as an error.
  refused?: number;
  // The window as the user sees it, not the whole page: what's fixed or
  // sticky to the window (the sidebar, the panel beside the page) spans it.
  window?: true;
};

const out = new URL("../shots/", import.meta.url);
mkdirSync(out, { recursive: true });

// What the scripted agent proposes when asked to plan: the checkout epic
// renamed, a story's description reworded, an estimate, and two new stories
// in the epic. Asked to plan only, it proposes just the new stories; asked
// for only one, the first.
const planScript = (all: boolean, one = false) =>
  [
    ...(all
      ? [
          'jira.setSummary("jira:SYN-1", "Checkout v2: phone wallets, saved cards and gift cards");',
          'jira.setDescription("jira:SYN-23", "Same as the app, for every browser that supports it. Show the card form otherwise.");',
          'jira.setEstimate("jira:SYN-99", 3);',
        ]
      : []),
    'jira.createStory({ summary: "Pay with a gift card", description: "Enter the code from the card. A balance that doesn\'t cover the fare is topped up with another way to pay.", points: 3 });',
    ...(one ? [] : ['jira.createStory({ summary: "Show the gift card balance at checkout" });']),
    "return null;",
  ].join("\n");
// Asked to hand SYN-61 to the team: it moves to Ready for Dev, and the
// channel hears so, beside Chen's message about its SMS copy.
const smsCopy = "slack:C0FW1WEATHR-1788782400.000100";
const handOffScript = [
  'jira.setStatus("jira:SYN-61", "Ready for Dev");',
  `slack.postMessage(${JSON.stringify(smsCopy)}, "SYN-61 is ready to pick up: the SMS copy is signed off, and the story is in Ready for Dev.");`,
  "return null;",
].join("\n");
// Asked to mark stories done: two moved to Done, the built ones or the fixes.
const finishScript = (keys: readonly string[]) =>
  [...keys.map((key) => `jira.setStatus("jira:${key}", "Done");`), "return null;"].join("\n");
const planning = (input: TurnInput): Step[] => {
  if (/\bplan\b/i.test(input.text))
    return [
      { run: planScript(/rename/i.test(input.text), /\bonly\b/i.test(input.text)) },
      { text: "The proposed change is below." },
    ];
  if (/\bpick up\b/i.test(input.text))
    return [{ run: handOffScript }, { text: "The proposed change is below." }];
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
// given it, on its own clock when given one.
const writing = async (slack?: SlackMode, now?: () => Instant) => {
  // A workflow with a column for stories ready to pick up, which SYN's lacks.
  const site = memorySite(loadJiraFixture(), instant(new Date()), {
    statuses: [{ name: "Ready for Dev", category: "todo" }],
  });
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
    ...(now ? { now } : {}),
    agent: (deps) => scriptedAgent(deps, planning),
  });
  return { site, serving };
};
const server = (await writing()).serving;
const refusing = await writing();
const unanswered = await writing();
const holding = await writing();
const readOnly = await serve(0);
// A server that syncs from a SYN site in memory as from a live one; this
// one's site goes offline once it has started.
const live = async () => {
  const site = memorySite(loadJiraFixture(), instant(new Date()));
  const serving = await serve(0, {
    db: ":memory:",
    jira: {
      kind: "live",
      site: memorySiteOrigin,
      credential: { headers: async () => ({}) },
      project: "SYN",
      fetch: site.fetch,
    },
  });
  return { site, serving };
};
const offline = await live();
offline.site.outage("offline");
// A server that syncs SYN from a board that takes no estimates, as a
// team-managed board with no points field does.
const unpointed = await serve(0, {
  db: ":memory:",
  jira: {
    kind: "live",
    site: memorySiteOrigin,
    credential: { headers: async () => ({}) },
    project: "SYN",
    fetch: memorySite(loadJiraFixture(), instant(new Date()), { estimates: false }).fetch,
  },
  agent: (deps) => scriptedAgent(deps, planning),
});

// Jira not connected yet; the window connects it to SYN in memory, which
// takes only this account.
const account = { email: "pm@example.com", token: "shots-only-value" };
const unconnected = (syn = loadJiraFixture()) =>
  serve(0, {
    db: ":memory:",
    jira: {
      kind: "window",
      store: memoryStore(),
      fetch: memorySite(syn, instant(new Date()), { account }).fetch,
    },
    agent: (deps) => scriptedAgent(deps, planning),
  });
const connecting = await unconnected();
// Jira connected to a project with no issues yet.
const empty = await unconnected({ ...loadJiraFixture(), issues: [], edits: [] });
const fillJira = async (page: Page, token: string) => {
  await page.locator(".connect-jira").waitFor();
  await page.locator('input[name="site"]').fill("oriel.atlassian.net");
  await page.locator('input[name="project"]').fill("SYN");
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="token"]').fill(token);
};
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
await post("/api/jira", { site: "oriel.atlassian.net", project: "SYN", ...account }, empty);
const changeSetOf = async (on: Serving, threadId: string): Promise<string> => {
  const view = await call<{ changeSets: { id: string }[] }>(on, "GET", `/api/threads/${threadId}`);
  const id = view.changeSets[0]?.id;
  if (!id) throw new Error("the scripted agent proposed no change set");
  return id;
};
const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

// SYN-1's epic cluster, keyed by the epic's stable ID.
const workstream = await post<{ id: string }>("/api/workstreams", checkout);
const ask = async (text: string, on: Serving = server, workstreamId = workstream.id) => {
  const opened = await post<{ id: string }>(
    `/api/workstreams/${workstreamId}/threads`,
    { text },
    on,
  );
  await on.app.settled();
  return opened.id;
};
const thread = await ask("Which stories here still need estimates?");
// Asked for estimates where the board takes none.
const unpointedThread = await ask(
  "Estimate the unestimated ones",
  unpointed,
  (await post<{ id: string }>("/api/workstreams", checkout, unpointed)).id,
);
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
  const { id: workstreamId } = await post<{ id: string }>("/api/workstreams", checkout, serving);
  const threadId = await ask("Estimate what's missing", serving, workstreamId);
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
  const { id: workstreamId } = await post<{ id: string }>("/api/workstreams", checkout, serving);
  const threadId = await ask("Estimate what's missing", serving, workstreamId);
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
// A later change to the workstream shows in working threads as a marker.
await post(`/api/workstreams/${workstream.id}/add`, { items: ["jira:SYN-3"] });

// Gift cards planned, then rejected: with no reason, the thread asks what was
// wrong; with one, the agent proposes a revised change set below the
// rejected one; and with one from a review link, it is held in the thread,
// under the reviewer's name, until the person sends it on or discards it.
const rejected = async (reason?: string, reviewer?: string) => {
  const threadId = await ask("Plan gift cards");
  const setId = await changeSetOf(server, threadId);
  const { hash } = await post<{ hash: string }>(`/api/change-sets/${setId}/diff`, {});
  const why = reason === undefined ? {} : { reason };
  if (reviewer === undefined) await post(`/api/change-sets/${setId}/reject`, { hash, ...why });
  else {
    const minted = await post<{ url: string }>(`/api/change-sets/${setId}/review-link`, {});
    const token = new URL(minted.url).pathname.split("/").at(-1);
    await post("/api/review/open", { token });
    const decision = { token, changeSet: setId, kind: "rejected", name: reviewer, hash };
    await post("/api/review/decide", { ...decision, ...why });
  }
  await server.app.settled();
  return threadId;
};
const rejectedBare = await rejected();
const revised = await rejected('One story too many: plan only "Pay with a gift card".');
const heldFromLink = await rejected("Plan only the gift card story, please.", "Dana");
// A change set whose review link someone is about to reject, with a reason.
const toReject = await post<{ url: string }>(
  `/api/change-sets/${await changeSetOf(server, await ask("Plan gift cards"))}/review-link`,
  {},
);

// Without credentials: change sets can be reviewed and rejected only.
const readOnlyWorkstream = await post<{ id: string }>("/api/workstreams", checkout, readOnly);
const readOnlyThread = await ask("Which stories need estimates?", readOnly, readOnlyWorkstream.id);

// A folder of notes beside Jira, and a workstream that mixes both.
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
const mixed = await post<{ id: string }>("/api/workstreams", {
  kind: "picked",
  name: "Saved cards launch",
  items: ["jira:SYN-23", "jira:SYN-99", "jira:SYN-104", ...files.map((file) => file.id)],
});
const mixedThread = await ask("What's in here?", server, mixed.id);

// Slack messages beside Jira items: the fare decision, with its replies, and
// the SMS wording thread, in a workstream with the stories they're about.
const fares = await post<{ id: string }>(
  "/api/workstreams",
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

// One change set to two sources: SYN-61 to Ready for Dev in Jira, and a
// message in Slack's channel that it's ready to pick up. Proposed, approved,
// and approved then reverted, each on a server of its own, so each diff reads
// its own Jira and Slack.
const handOff = async (then: "propose" | "approve" | "revert") => {
  const { serving } = await writing({ kind: "fixture" });
  const { id: workstreamId } = await post<{ id: string }>(
    "/api/workstreams",
    { kind: "picked", name: "SMS updates", items: ["jira:SYN-61", smsCopy] },
    serving,
  );
  const threadId = await ask(
    "SYN-61 is ready to pick up: hand it to the team",
    serving,
    workstreamId,
  );
  const setId = await changeSetOf(serving, threadId);
  const review = await post<{ url: string }>(`/api/change-sets/${setId}/review-link`, {}, serving);
  if (then !== "propose") {
    const { hash } = await post<{ hash: string }>(`/api/change-sets/${setId}/diff`, {}, serving);
    await post(`/api/change-sets/${setId}/approve`, { hash }, serving);
  }
  if (then === "revert") {
    const { revert } = await post<{ revert: string }>(
      `/api/change-sets/${setId}/revert`,
      {},
      serving,
    );
    const { hash } = await post<{ hash: string }>(`/api/change-sets/${revert}/diff`, {}, serving);
    await post(`/api/change-sets/${revert}/approve`, { hash }, serving);
  }
  return { serving, workstreamId, threadId, review: new URL(review.url).pathname };
};
const handing = await handOff("propose");
const handed = await handOff("approve");
const handedBack = await handOff("revert");
// Another thread asks where the hand-off was approved; the agent links to it.
const askedWhere = await ask(
  "Where did I approve the post that SYN-61 is ready?",
  handed.serving,
  handed.workstreamId,
);

// A workstream of one item, and one with none left, for how the page counts them.
const single = await post<{ id: string }>("/api/workstreams", {
  kind: "picked",
  name: "Declined card retry",
  items: ["jira:SYN-23"],
});
const emptied = await post<{ id: string }>("/api/workstreams", {
  kind: "picked",
  name: "Gift cards",
  items: ["jira:SYN-99"],
});
await post(`/api/workstreams/${emptied.id}/remove`, { items: ["jira:SYN-99"] });

// Notes picked in the window and made a workstream, on a server of their own: each
// pass of the scenes makes another workstream, which no other scene should show.
const picking = (await writing()).serving;
await post("/api/folder", { path: notes }, picking);
// A workstream to remove items from, and undo that, on the same server: each pass
// puts its items back first.
const trimmed = await post<{ id: string }>(
  "/api/workstreams",
  {
    kind: "picked",
    name: "Checkout polish",
    items: ["jira:SYN-21", "jira:SYN-23", "jira:SYN-99", "jira:SYN-104"],
  },
  picking,
);
const trim = async (page: Page) => {
  await post(
    `/api/workstreams/${trimmed.id}/add`,
    { items: ["jira:SYN-21", "jira:SYN-23", "jira:SYN-99", "jira:SYN-104"] },
    picking,
  );
  await page.reload();
  await page.locator(".workstream-page .members").waitFor();
  for (const key of ["SYN-23", "SYN-99"]) {
    await page.getByRole("button", { name: `Remove ${key}` }).click();
    await page.locator(".undo", { hasText: key }).waitFor();
  }
};

// Threads on a server whose clock moves on eight days partway through: the
// two asked before that and left unsettled are dropped, beside two done.
const idling = await (async () => {
  let later = 0;
  const { serving } = await writing(undefined, () => instant(new Date(Date.now() + later)));
  const { id: workstreamId } = await post<{ id: string }>("/api/workstreams", checkout, serving);
  const done = async (text: string) =>
    post(`/api/threads/${await ask(text, serving, workstreamId)}/done`, {}, serving);
  await ask("Who is on the saved cards stories?", serving, workstreamId);
  await ask("Is anything blocking phone wallets?", serving, workstreamId);
  await done("What's in here?");
  later = 8 * 24 * 60 * 60 * 1000;
  await done("Which stories have no estimate?");
  return serving;
})();

async function shown(page: Page, grouping: Grouping): Promise<void> {
  await page.locator(`main[aria-busy="false"] .clusters[data-grouping="${grouping}"]`).waitFor();
}

// A request the page sends and never hears back about, so a shot shows what
// a click shows before the server answers.
// Aborted once the shot is taken, so the server never hears of it.
const hung: Route[] = [];
async function hang(page: Page, path: string): Promise<void> {
  await page.route(`**${path}`, (route) => {
    hung.push(route);
  });
}

// On a narrow screen the sources are in the sidebar's drawer.
async function openSidebar(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 0) > 760) return;
  await page.getByRole("button", { name: "Open the sidebar" }).click();
  await page.locator(".shell[data-drawer] .sidebar").waitFor();
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
  {
    name: "jira-connect",
    path: "/?grouping=epic",
    on: connecting,
    act: (page) => fillJira(page, account.token),
  },
  {
    name: "jira-refused",
    path: "/?grouping=epic",
    on: connecting,
    refused: 400,
    act: async (page) => {
      await fillJira(page, "not-the-one");
      await page.getByRole("button", { name: "Connect" }).click();
      await page.locator(".connect-problem").waitFor();
    },
  },
  {
    name: "jira-empty",
    path: "/?grouping=epic",
    on: empty,
    act: (page) => page.locator(".empty-jira").waitFor(),
  },
  {
    name: "jira-empty-stuck",
    path: "/?grouping=stuck",
    on: empty,
    act: async (page) => {
      await page.locator(".empty-jira").waitFor();
      await page.locator(".cluster").first().waitFor();
    },
  },
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
      await page.locator('.anchor-pick input[type="checkbox"]').first().check();
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
    name: "no-estimates-epic",
    path: "/?grouping=epic",
    on: unpointed,
    act: async (page) => {
      await shown(page, "epic");
      await openFirstCluster(page);
    },
  },
  {
    name: "no-estimates-stuck",
    path: "/?grouping=stuck",
    on: unpointed,
    act: (page) => shown(page, "stuck"),
  },
  {
    name: "no-estimates-thread",
    path: `/threads/${unpointedThread}`,
    on: unpointed,
    act: async (page) => {
      await page.locator(".run summary").first().click();
      await page.locator(".run[open]").first().waitFor();
    },
  },
  {
    name: "stuck-expanded",
    path: "/?grouping=stuck",
    act: async (page) => {
      await shown(page, "stuck");
      await openAll(page);
    },
  },
  {
    name: "workstream",
    path: `/workstreams/${workstream.id}`,
    act: (page) => page.locator(".workstream-page .members").waitFor(),
  },
  {
    name: "workstream-mixed",
    path: `/workstreams/${mixed.id}`,
    act: (page) => page.locator(".workstream-page .members").waitFor(),
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
    name: "workstream-slack",
    path: `/workstreams/${fares.id}`,
    on: chatty,
    act: (page) => page.locator(".workstream-page .members").waitFor(),
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
    name: "thread-handoff",
    path: `/threads/${handing.threadId}`,
    on: handing.serving,
    act: (page) => page.getByRole("button", { name: "Approve and apply" }).waitFor(),
  },
  {
    name: "review-handoff",
    path: handing.review,
    on: handing.serving,
    act: async (page) => {
      await page.getByRole("button", { name: "Show the change" }).click();
      await page.locator(".review-card .diff").waitFor();
    },
  },
  {
    name: "thread-handoff-applied",
    path: `/threads/${handed.threadId}`,
    on: handed.serving,
    act: (page) => page.getByRole("button", { name: "Revert" }).waitFor(),
  },
  {
    name: "workstream-handoff-applied",
    path: `/workstreams/${handed.workstreamId}`,
    on: handed.serving,
    act: (page) => page.locator(".workstream-page .members").waitFor(),
  },
  {
    name: "thread-handoff-reverted",
    path: `/threads/${handedBack.threadId}`,
    on: handedBack.serving,
    act: (page) => page.locator(".change-set .change-set .diff").waitFor(),
  },
  // The panel beside the page, one per source's view, and from the window at
  // both zoom levels: a plain click opens it, an address can too.
  {
    name: "panel-jira-list",
    window: true,
    path: "/?grouping=epic",
    act: async (page) => {
      await shown(page, "epic");
      await page.locator(".cluster-toggle", { hasText: "Checkout" }).first().click();
      await page.locator(".item a.key", { hasText: "SYN-23" }).click();
      await page.locator(".item-panel .panel-facts").waitFor();
    },
  },
  {
    name: "panel-jira-cluster",
    window: true,
    path: "/?grouping=epic&item=jira%3ASYN-1",
    act: async (page) => {
      await shown(page, "epic");
      await page.locator(".item-panel .panel-facts").waitFor();
    },
  },
  {
    name: "panel-slack",
    window: true,
    path: `/workstreams/${fares.id}`,
    on: chatty,
    act: async (page) => {
      await page.locator(".workstream-page .members").waitFor();
      await page.locator(".workstream-page a.replies").first().click();
      await page.locator(".item-panel .panel-thread").last().waitFor();
    },
  },
  {
    name: "panel-folder",
    window: true,
    path: `/workstreams/${mixed.id}`,
    act: async (page) => {
      await page.locator(".workstream-page .members").waitFor();
      await page.locator(".workstream-page .key.item-link").first().click();
      await page.locator(".item-panel .panel-text").waitFor();
    },
  },
  {
    name: "panel-thread-rail",
    window: true,
    path: `/threads/${thread}`,
    act: async (page) => {
      await page.locator(".rail .members").waitFor();
      await page.locator(".rail a.key").first().click();
      await page.locator(".item-panel .panel-facts").waitFor();
    },
  },
  {
    name: "workstream-one",
    path: `/workstreams/${single.id}`,
    act: (page) => page.locator(".workstream-page .members").waitFor(),
  },
  {
    name: "workstream-empty",
    path: `/workstreams/${emptied.id}`,
    act: (page) => page.locator(".workstream-page .rail-empty").waitFor(),
  },
  {
    // Two items removed with ×, each undoable for a few seconds.
    name: "workstream-undo",
    path: `/workstreams/${trimmed.id}`,
    on: picking,
    act: trim,
  },
  {
    // One of them undone: back where it was.
    name: "workstream-undone",
    path: `/workstreams/${trimmed.id}`,
    on: picking,
    act: async (page) => {
      await trim(page);
      await page.getByRole("button", { name: "Undo removing SYN-23" }).click();
      await page.locator('.members [data-item="jira:SYN-23"]').waitFor();
    },
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
    path: `/workstreams/${mixed.id}`,
    act: async (page) => {
      await page.locator(".nav-waiting-link").first().waitFor({ state: "attached" });
      if ((page.viewportSize()?.width ?? 0) <= 760) {
        await page.getByRole("button", { name: "Open the sidebar" }).click();
        await page.locator(".shell[data-drawer] .sidebar").waitFor();
      }
    },
  },
  {
    // A thread's menu, from a right-click on it in the sidebar.
    name: "thread-menu",
    path: `/workstreams/${mixed.id}`,
    act: async (page) => {
      if ((page.viewportSize()?.width ?? 0) <= 760) {
        await page.getByRole("button", { name: "Open the sidebar" }).click();
        await page.locator(".shell[data-drawer] .sidebar").waitFor();
      }
      await page.locator(".nav-waiting-link").first().click({ button: "right" });
      await page.getByRole("menu").waitFor();
    },
  },
  {
    // A thread in the sidebar swiped left past its first stop, against
    // resistance, to show Delete beside Mark done: a trackpad's sideways
    // wheel, as on a wide screen, works in the drawer too.
    name: "thread-swipe",
    path: `/workstreams/${mixed.id}`,
    act: async (page) => {
      if ((page.viewportSize()?.width ?? 0) <= 760) {
        await page.getByRole("button", { name: "Open the sidebar" }).click();
        await page.locator(".shell[data-drawer] .sidebar").waitFor();
      }
      // Once the sidebar has loaded, so the row holds still under the pointer.
      await page.locator(".sidebar-workstreams .nav-workstream").first().waitFor();
      const row = page.locator(".sidebar-needs .swipe").first();
      await row.hover();
      // At twice the pixel density each step moves half as far.
      for (let i = 0; i < 48; i++) {
        await page.mouse.wheel(10, 0);
        await page.waitForTimeout(16);
      }
      await row.locator('.swipe-action[tabindex="0"]', { hasText: "Delete" }).waitFor();
    },
  },
  {
    // Deleting a thread whose change set wrote to Jira first says so: from
    // its workstream's list of threads.
    name: "thread-delete",
    path: `/threads/${partial}`,
    on: refusing.serving,
    act: async (page) => {
      await page.locator(".thread-head .crumb").click();
      await page.locator(`.thread-list a[href="/threads/${partial}"]`).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Delete…" }).click();
      await page.locator(".confirm-body", { hasText: "revert" }).waitFor();
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
    // Jira syncing: the request is held until the screenshot is taken.
    name: "jira-syncing",
    path: "/?grouping=epic",
    act: async (page) => {
      await shown(page, "epic");
      await page.route("**/api/jira/sync", () => {});
      await openSidebar(page);
      await page
        .getByRole("region", { name: "Jira" })
        .getByRole("button", { name: "Sync" })
        .click();
      await page.getByRole("button", { name: "Syncing…" }).waitFor();
    },
  },
  {
    name: "jira-sync-failed",
    path: "/?grouping=epic",
    on: offline.serving,
    refused: 502,
    act: async (page) => {
      await shown(page, "epic");
      await openSidebar(page);
      await page
        .getByRole("region", { name: "Jira" })
        .getByRole("button", { name: "Sync" })
        .click();
      await page.locator(".jira .source-problem").waitFor();
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
    // Reloaded mid-apply, the thread is out of Needs you, applying.
    name: "needs-you-applying",
    path: `/threads/${inFlight.threadId}`,
    on: holding.serving,
    act: async (page) => {
      await page.locator('.change-set[data-status="applying"]').waitFor();
      await openSidebar(page);
    },
  },
  {
    // The moment Approve and apply is clicked, before the server answers.
    name: "thread-approving",
    path: `/threads/${thread}`,
    act: async (page) => {
      await hang(page, "/approve");
      await page.getByRole("button", { name: "Approve and apply" }).click();
      await page.locator('.change-set[data-status="applying"]').waitFor();
      await openSidebar(page);
    },
  },
  {
    // The moment Reject is clicked: the thread waits on the user's reply.
    name: "thread-rejecting",
    path: `/threads/${thread}`,
    act: async (page) => {
      await page.getByRole("button", { name: "Approve and apply" }).waitFor();
      await hang(page, "/reject");
      await page.getByRole("button", { name: "Reject" }).click();
      await page.locator('.change-set[data-status="rejected"]').waitFor();
      await openSidebar(page);
    },
  },
  {
    // A reason typed to go with Reject.
    name: "thread-reject-reason",
    path: `/threads/${planned}`,
    act: async (page) => {
      await page.getByRole("button", { name: "Approve and apply" }).waitFor();
      await page
        .getByRole("textbox", { name: "Why reject it (optional)" })
        .fill('Title should be "Checkout v2: wallets and gift cards"');
    },
  },
  {
    // Rejected with no reason: the thread asks what was wrong; Your turn.
    name: "thread-rejected-asks",
    path: `/threads/${rejectedBare}`,
    act: async (page) => {
      await page.locator('.change-set[data-status="rejected"]').waitFor();
      await openSidebar(page);
    },
  },
  {
    // Rejected with a reason: the revised change set below the rejected one.
    name: "thread-revised",
    path: `/threads/${revised}`,
    act: (page) => page.getByRole("button", { name: "Approve and apply" }).waitFor(),
  },
  {
    // Rejected from a review link with a reason, held for the person.
    name: "thread-held-from-link",
    path: `/threads/${heldFromLink}`,
    act: (page) => page.getByRole("button", { name: "Send to agent" }).waitFor(),
  },
  {
    // The held reason, being edited before it is sent.
    name: "thread-held-editing",
    path: `/threads/${heldFromLink}`,
    act: async (page) => {
      await page.getByRole("button", { name: "Edit" }).click();
      await page
        .getByRole("textbox", { name: "Edit Dana's reason" })
        .fill("Plan only the gift card story, and estimate it.");
    },
  },
  {
    name: "thread-read-only",
    path: `/threads/${readOnlyThread}`,
    on: readOnly,
    act: (page) => page.locator(".read-only-note").waitFor(),
  },
  {
    name: "done",
    path: "/done",
    act: (page) => page.locator(".done-page .thread-list").waitFor(),
  },
  {
    name: "done-dropped",
    path: "/done?tab=dropped",
    on: idling,
    act: (page) => page.locator(".done-page .thread-list").waitFor(),
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
    // Approving through the link, while it applies.
    name: "review-applying",
    path: new URL(link.url).pathname,
    act: async (page) => {
      await page.getByRole("button", { name: "Show the change" }).click();
      await page.getByRole("textbox", { name: "Your name" }).fill("Dana");
      await hang(page, "/api/review/decide");
      await page.getByRole("button", { name: "Approve" }).click();
      await page.getByText("Approving and applying…").waitFor();
    },
  },
  {
    // About to reject from a review link, saying what's wrong.
    name: "review-reject-reason",
    path: new URL(toReject.url).pathname,
    act: async (page) => {
      await page.getByRole("button", { name: "Show the change" }).click();
      await page.getByRole("textbox", { name: "Your name" }).fill("Dana");
      await page
        .getByRole("textbox", { name: "If you reject it, what's wrong? (optional)" })
        .fill("One story too many: the balance can wait.");
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
    // In the epic grouping a folder's files are in "No epics in this source";
    // the workstream made of two of them is named from what they are.
    name: "picked-notes-workstream",
    path: "/?grouping=epic",
    on: picking,
    act: async (page) => {
      await shown(page, "epic");
      const notes = page.locator(".cluster", { hasText: "No epics in this source" });
      await notes.locator(".cluster-toggle").click();
      const boxes = notes.locator('.item input[type="checkbox"]');
      await boxes.nth(0).check();
      await boxes.nth(1).check();
      await page.locator(".selection-bar").getByRole("button", { name: "New workstream" }).click();
      await page.locator(".workstream-page .members").waitFor();
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
  // These last: the sidebar remembers them in the browser, and every
  // scene of a width and theme shares one.
  {
    // The latest done threads, opened at the foot of the sidebar.
    name: "sidebar-done",
    path: `/workstreams/${mixed.id}`,
    act: async (page) => {
      if ((page.viewportSize()?.width ?? 0) <= 760) {
        await page.getByRole("button", { name: "Open the sidebar" }).click();
        await page.locator(".shell[data-drawer] .sidebar").waitFor();
      }
      await page.locator(".sidebar-done").getByRole("button", { name: /^Done/ }).click();
      await page.locator(".nav-done").waitFor();
    },
  },
  {
    // Beside dropped threads, the opened Done section leads to their tab.
    name: "sidebar-done-dropped",
    path: "/done?tab=dropped",
    on: idling,
    act: async (page) => {
      if ((page.viewportSize()?.width ?? 0) <= 760) {
        await page.getByRole("button", { name: "Open the sidebar" }).click();
        await page.locator(".shell[data-drawer] .sidebar").waitFor();
      }
      await page.locator(".sidebar-done").getByRole("button", { name: /^Done/ }).click();
      await page.locator(".nav-done").getByRole("link", { name: "2 dropped" }).waitFor();
    },
  },
  // Finding your way back (OA-108, OA-110): the sidebar's search finds the
  // hand-off by what it posted, and opens its thread there; another thread's
  // agent links to it.
  {
    name: "search-results",
    path: "/?grouping=epic",
    on: handed.serving,
    act: async (page) => {
      await openSidebar(page);
      await page.getByRole("combobox", { name: "Search threads" }).fill("ready to pick up");
      await page.locator(".search-result").first().waitFor();
    },
  },
  {
    name: "search-opened",
    path: "/?grouping=epic",
    on: handed.serving,
    act: async (page) => {
      await openSidebar(page);
      const field = page.getByRole("combobox", { name: "Search threads" });
      await field.fill("ready to pick up");
      await page.locator(".search-result").first().waitFor();
      await field.press("Enter");
      await page.locator(".change-set[data-opened] .diff").waitFor();
    },
  },
  {
    name: "thread-link",
    path: `/threads/${askedWhere}`,
    on: handed.serving,
    act: (page) => page.locator(".chat a[href*='changeSet=']").waitFor(),
  },
  {
    // Folded on a wide screen, the fold button counts the threads waiting on
    // the user; a narrow screen's menu does.
    name: "sidebar-folded",
    path: `/workstreams/${mixed.id}`,
    act: async (page) => {
      await page.locator(".nav-waiting-link").first().waitFor({ state: "attached" });
      if ((page.viewportSize()?.width ?? 0) <= 760) return;
      await page.getByRole("button", { name: "Hide sidebar" }).click();
      await page.locator(".sidebar-fold .bar-count").waitFor();
    },
  },
  {
    // Folded, the search's icon opens the sidebar at the field.
    name: "sidebar-folded-search",
    path: `/workstreams/${mixed.id}`,
    act: async (page) => {
      if ((page.viewportSize()?.width ?? 0) <= 760) return;
      // The scene before may have left it folded.
      const hide = page.getByRole("button", { name: "Hide sidebar" });
      if (await hide.count()) await hide.click();
      await page.getByRole("button", { name: "Search threads" }).click();
      await page.getByRole("combobox", { name: "Search threads" }).fill("estimates");
      await page.locator(".search-results [role=status]:not(:empty)").waitFor();
    },
  },
];
const asked = parseArgs({
  options: { width: { type: "string", multiple: true } },
  allowPositionals: true,
});
const widths = asked.values.width?.map(Number) ?? [1280, 390];
const picked = asked.positionals;
for (const width of widths)
  if (!Number.isInteger(width) || width < 320) throw new Error(`Not a width in pixels: ${width}`);
for (const start of picked)
  if (!scenes.some((scene) => scene.name.startsWith(start)))
    throw new Error(`No scene's name starts with ${start}`);
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
      let scene: Scene | null = null;
      page.on("console", (message) => {
        const expected = scene?.refused && message.text().includes(`status of ${scene.refused}`);
        if ((message.type() === "error" || message.type() === "warning") && !expected) {
          problems.push(`${theme} ${width}: console ${message.type()}: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => problems.push(`${theme} ${width}: ${error.message}`));
      for (scene of scenes) {
        const { name } = scene;
        if (picked.length > 0 && !picked.some((start) => name.startsWith(start))) continue;
        await page.goto(new URL(scene.path, (scene.on ?? server).url).href);
        await scene.act?.(page);
        const path = fileURLToPath(new URL(`${scene.name}-${theme}-${width}.png`, out));
        await page.screenshot({ path, fullPage: !scene.window, animations: "disabled" });
        // Leaving first cancels a held request quietly; aborting it logs.
        if (hung.length > 0) await page.goto("about:blank");
        for (const route of hung.splice(0)) await route.abort().catch(() => {});
        await page.unrouteAll({ behavior: "ignoreErrors" });
        console.log(path);
      }
      await context.close();
    }
  }
  if (picked.length === 0) await onboarding();
} finally {
  await browser.close();
  await server.close();
  await refusing.serving.close();
  await offline.serving.close();
  await unpointed.close();
  await unanswered.serving.close();
  inFlight.release();
  await inFlight.approving;
  await holding.serving.close();
  await readOnly.close();
  await connecting.close();
  await empty.close();
  await picking.close();
  await chatty.close();
  for (const { serving } of [handing, handed, handedBack]) await serving.close();
  await idling.close();
  rmSync(dirname(notes), { recursive: true, force: true });
}

// The onboarding budget (SPEC §4), as fast as a script clicks: connect
// Jira, see the epics, ask one question, approve one change. The clock
// starts when Jira connects; the word "token" is counted on each screen,
// in its text and in what it shows in fields and tooltips.
async function onboarding(): Promise<void> {
  const on = await unconnected();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const tokens: [string, number][] = [];
  const count = async (screen: string) => {
    const text = await page.evaluate<string>(`[
      document.body.innerText,
      ...[...document.querySelectorAll("[placeholder], [title], [aria-label]")].flatMap((el) =>
        ["placeholder", "title", "aria-label"].map((name) => el.getAttribute(name) ?? ""),
      ),
    ].join("\\n")`);
    tokens.push([screen, (text.match(/\btokens?\b/gi) ?? []).length]);
  };
  try {
    const opened = performance.now();
    await page.goto(on.url);
    await fillJira(page, account.token);
    await count("connect");
    await page.getByRole("button", { name: "Connect" }).click();
    await page.locator(".connect-jira").waitFor({ state: "detached" });
    const connected = performance.now();
    await shown(page, "epic");
    await count("epics");
    const checkoutEpic = page.locator(".cluster", { hasText: "Checkout" }).first();
    await checkoutEpic.getByRole("button", { name: "Make workstream" }).click();
    await page.locator(".workstream-page .members").waitFor();
    await count("workstream");
    await page.getByLabel("Ask about this workstream").fill("Plan gift cards in this epic");
    await page.getByRole("button", { name: "Ask" }).click();
    await page.getByRole("button", { name: "Approve and apply" }).waitFor();
    await count("thread");
    await page.getByRole("button", { name: "Approve and apply" }).click();
    await page.locator('.change-set[data-status="applied"]').waitFor();
    await count("approved");
    const done = performance.now();
    const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
    console.log(
      `onboarding: ${seconds(connected - opened)} to connect, then ${seconds(done - connected)} from connect to an approved change`,
    );
    console.log(
      `onboarding: "token" appears ${tokens.map(([screen, n]) => `${n}× on ${screen}`).join(", ")}`,
    );
    const total = tokens.reduce((sum, [, n]) => sum + n, 0);
    if (total > 1)
      problems.push(`onboarding: "token" appears ${total} times, over the budget of 1`);
  } finally {
    await context.close();
    await on.close();
  }
}

for (const problem of problems) console.error(problem);
process.exitCode = problems.length === 0 ? 0 : 1;
