// `pnpm perf`: how fast the window opens on a big world, in the installed
// Chrome. SYN's fixture plus generated issues, 4,000 in all (`--items`), is
// served by SYN's Jira site in memory and synced as from a live one into a
// database file in a temporary directory, with `--workstreams` workstreams
// made from its largest epics, as a user's would be. The server is the real
// one, on a free port.
//
// It times the server's start on an empty database and again on the one the
// first start left, then opens the overview once on each freshly started
// server (cold) and `--runs` more times (warm, the median). Each open
// reports time to first byte, when the app first drew, when the overview
// first showed its sections (the first useful paint), and every request it
// made, with its size and the server's time. Chrome's trace gives the time
// spent compiling and running scripts. Last, each route the overview and
// Browse ask for is timed through the server's own handler, one request at
// a time, so no other request is in its number.
//
// The budget is `budgets` below; over any of it, it exits 1. It reads the
// clock, so it is a script, not a test.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright-core";
import { instant } from "../packages/core/src/ids.ts";
import { memorySite, memorySiteOrigin } from "../packages/jira/src/memory-site.ts";
import { type Serving, serve } from "../packages/server/src/serve.ts";
import { bigWorld } from "./big-world.ts";
import { loadJiraFixture } from "./fixtures/load.ts";

const { values } = parseArgs({
  options: {
    items: { type: "string", default: "4000" },
    workstreams: { type: "string", default: "12" },
    runs: { type: "string", default: "7" },
    history: { type: "string", default: "20" },
  },
});
const total = Number(values.items);
const runs = Number(values.runs);
const history = Number(values.history);
// The overview shown on a warm open and on a cold one, as medians, and the
// overview's reply alone.
const budgets = { warmMs: 150, coldMs: 400, overviewMs: 50 };

const syn = loadJiraFixture();
const site = memorySite(
  { ...syn, issues: bigWorld(total)(syn.issues), edits: [] },
  instant(new Date()),
);
const dir = mkdtempSync(join(tmpdir(), "oriel-perf-"));
const db = join(dir, "perf.db");

const start = async (): Promise<{ serving: Serving; ms: number }> => {
  const at = performance.now();
  const serving = await serve(0, {
    db,
    jira: {
      kind: "live",
      site: memorySiteOrigin,
      credential: { headers: async () => ({}) },
      project: "SYN",
      fetch: site.fetch,
    },
  });
  return { serving, ms: performance.now() - at };
};

type Request = {
  path: string;
  bytes: number;
  startMs: number;
  serverMs: number;
  endMs: number;
};
type Open = {
  ttfbMs: number;
  drawnMs: number;
  shownMs: number;
  scriptMs: number;
  requests: Request[];
};

// Set before the page's own scripts: when #app first has content, and when
// the overview first has its sections, each after the frame that paints it.
const marks = `(() => {
  const seen = new Set();
  const mark = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    requestAnimationFrame(() => setTimeout(() => performance.mark(name), 0));
  };
  new MutationObserver(() => {
    const app = document.getElementById("app");
    if (app && app.childElementCount > 0) mark("oriel:drawn");
    if (document.querySelector(".overview-columns")) mark("oriel:shown");
  }).observe(document, { childList: true, subtree: true });
})();`;

async function open(page: Page, url: string): Promise<Open> {
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser");
  await browser.startTracing(page, { categories: ["devtools.timeline", "v8"] });
  await page.goto(url);
  await page.waitForFunction(() => performance.getEntriesByName("oriel:shown").length > 0);
  // Whatever the overview asked for after it showed.
  await page.waitForLoadState("networkidle");
  const trace = JSON.parse((await browser.stopTracing()).toString("utf8")) as {
    traceEvents: { name: string; ph: string; dur?: number }[];
  };
  const scripted = new Set([
    "v8.compile",
    "v8.compileModule",
    "EvaluateScript",
    "v8.evaluateModule",
  ]);
  const scriptMs =
    trace.traceEvents
      .filter((event) => event.ph === "X" && scripted.has(event.name))
      .reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000;
  const timed = await page.evaluate<{
    ttfbMs: number;
    drawnMs: number;
    shownMs: number;
    resources: (Omit<Request, "path"> & { name: string })[];
  }>(`(() => {
    const at = (name) => performance.getEntriesByName(name)[0]?.startTime ?? -1;
    return {
      ttfbMs: performance.getEntriesByType("navigation")[0].responseStart,
      drawnMs: at("oriel:drawn"),
      shownMs: at("oriel:shown"),
      resources: performance.getEntriesByType("resource").map((r) => ({
        name: r.name,
        bytes: r.encodedBodySize,
        startMs: r.startTime,
        serverMs: r.responseStart - r.requestStart,
        endMs: r.responseEnd,
      })),
    };
  })()`);
  return {
    ttfbMs: timed.ttfbMs,
    drawnMs: timed.drawnMs,
    shownMs: timed.shownMs,
    scriptMs,
    requests: timed.resources.map(({ name, ...rest }) => {
      const parsed = new URL(name);
      return { path: parsed.pathname + parsed.search, ...rest };
    }),
  };
}

const median = (numbers: number[]) =>
  numbers.toSorted((a, b) => a - b)[Math.floor(numbers.length / 2)] ?? 0;
const ms = (n: number) => `${n.toFixed(0)} ms`;
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

function report(label: string, opens: Open[]) {
  const pick = (f: (o: Open) => number) => median(opens.map(f));
  const first = opens[0];
  if (!first) return;
  const js = first.requests.filter((r) => r.path.endsWith(".js"));
  console.log(`\n${label}${opens.length > 1 ? ` (median of ${opens.length})` : ""}`);
  console.log(`  time to first byte      ${ms(pick((o) => o.ttfbMs))}`);
  console.log(`  app first drawn         ${ms(pick((o) => o.drawnMs))}`);
  console.log(`  overview shown          ${ms(pick((o) => o.shownMs))}`);
  console.log(`  compiling and running   ${ms(pick((o) => o.scriptMs))}`);
  console.log(
    `  scripts                 ${js.length} files, ${kb(js.reduce((s, r) => s + r.bytes, 0))}`,
  );
  const lastScript = (o: Open) =>
    Math.max(0, ...o.requests.filter((r) => r.path.endsWith(".js")).map((r) => r.endMs));
  console.log(`  last script loaded      ${ms(pick(lastScript))}`);
  // The nth request for a path in one open is the nth in every other.
  const nth = (o: Open, path: string, n: number) => o.requests.filter((r) => r.path === path)[n];
  console.log("  api calls                  start   server      end      size");
  const api = first.requests.filter((r) => r.path.startsWith("/api/"));
  api.forEach((request, index) => {
    const n = api.slice(0, index).filter((r) => r.path === request.path).length;
    const same = opens.flatMap((o) => nth(o, request.path, n) ?? []);
    const of = (f: (r: Request) => number) => ms(median(same.map(f))).padStart(9);
    console.log(
      `    ${request.path.padEnd(22)}${of((r) => r.startMs)}${of((r) => r.serverMs)}${of((r) => r.endMs)}${kb(request.bytes).padStart(10)}`,
    );
  });
}

const browser = await chromium.launch({ channel: "chrome", chromiumSandbox: true });
const problems: string[] = [];
const started: Serving[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(marks);
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(error.message));

  const first = await start();
  started.push(first.serving);
  console.log(`${total} issues; server started on an empty database in ${ms(first.ms)}`);
  // The user's workstreams: the largest epics, one each.
  const base = first.serving.url;
  const browse = (await (await fetch(new URL("/api/browse?grouping=epic", base))).json()) as {
    clusters: { row: { key: string; count: number } }[];
  };
  const largest = browse.clusters
    .toSorted((a, b) => b.row.count - a.row.count)
    .slice(0, Number(values.workstreams));
  const post = async (path: string, body: unknown) => {
    const made = await fetch(new URL(path, base), {
      method: "POST",
      headers: { "content-type": "application/json", origin: base.replace(/\/$/, "") },
      body: JSON.stringify(body),
    });
    if (!made.ok) throw new Error(`POST ${path}: ${made.status} ${await made.text()}`);
  };
  for (const cluster of largest)
    await post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: cluster.row.key });
  // Weeks of use: each round, teammates move some issues on in Jira, and
  // Oriel syncs, so the change log holds what moved.
  const keys = bigWorld(total)(syn.issues).map((issue) => issue.key);
  const moves = ["To Do", "In Progress", "Done"];
  for (let round = 0; round < history; round += 1) {
    for (let n = 0; n < 150; n += 1) {
      const key = keys[(round * 7919 + n * 104_729) % keys.length];
      if (key) site.edit(key, { status: moves[(round + n) % 3], points: (n % 8) + 1 });
    }
    await post("/api/jira/sync", {});
  }
  await first.serving.close();
  started.pop();

  // Started again on the database the first left: the server a user opens
  // the window on, cold for its first open and warm after.
  const again = await start();
  started.push(again.serving);
  console.log(`started again on that database in ${ms(again.ms)}`);
  const cold = await open(page, again.serving.url);
  const warm: Open[] = [];
  for (let run = 0; run < runs; run += 1) warm.push(await open(page, again.serving.url));
  report("cold open", [cold]);
  report("warm open", warm);

  // One request at a time, as the window would send each.
  const serving = again.serving;
  const call = async (path: string) => {
    const url = new URL(path, serving.url);
    const at = performance.now();
    const reply = await serving.app.api(
      { method: "GET", url: path, headers: { host: url.host } },
      url,
    );
    const took = performance.now() - at;
    if (reply?.status !== 200) throw new Error(`GET ${path}: ${reply?.status}`);
    return { ms: took, bytes: Buffer.byteLength(reply.body) };
  };
  const routes = [
    ...new Set(cold.requests.flatMap((r) => (r.path.startsWith("/api/") ? [r.path] : []))),
  ]
    .filter((path) => path !== "/api/telemetry")
    .concat(["epic", "assignee", "stuck", "linked"].map((g) => `/api/browse?grouping=${g}`));
  console.log(`\nthe server alone, one request at a time (median of ${runs * 3})`);
  const alone = new Map<string, number>();
  for (const path of routes) {
    const timed = [];
    for (let run = 0; run < runs * 3; run += 1) timed.push(await call(path));
    alone.set(path, median(timed.map((t) => t.ms)));
    console.log(
      `    ${path.padEnd(30)}${ms(alone.get(path) ?? 0).padStart(9)}${kb(timed[0]?.bytes ?? 0).padStart(10)}`,
    );
  }

  const over = (what: string, took: number, budget: number) => {
    if (took > budget) problems.push(`${what} took ${ms(took)}, over its budget of ${ms(budget)}`);
  };
  over("the overview on a cold open", cold.shownMs, budgets.coldMs);
  over("the overview on a warm open", median(warm.map((o) => o.shownMs)), budgets.warmMs);
  over("the overview's reply", alone.get("/api/overview") ?? 0, budgets.overviewMs);
  console.log(
    `\nbudget: shown in ${ms(budgets.warmMs)} warm and ${ms(budgets.coldMs)} cold; the overview's reply in ${ms(budgets.overviewMs)}`,
  );
} finally {
  await browser.close();
  for (const serving of started) await serving.close();
  rmSync(dir, { recursive: true, force: true });
}
for (const problem of problems) console.error(problem);
process.exitCode = problems.length === 0 ? 0 : 1;
