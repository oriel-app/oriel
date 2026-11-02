// `node scripts/bench-browse.ts`: how big and how fast Browse's replies are
// over a 4,000-item index, built in memory. SYN's fixture, plus generated
// epics and stories, is served by SYN's Jira site in memory and synced into
// an in-memory database, as the tests' app does; no fixture file changes.
// Each route is asked once cold (the first request a newly started server
// answers) and then `--runs` times warm, timed through the server's own
// handler, so no network is in the numbers. The whole list in one reply
// (`/api/window`) is measured beside Browse's first reply (`/api/browse`)
// and the first page of its largest cluster (`/api/browse/items`).
import { parseArgs } from "node:util";
import { instant } from "../packages/core/src/ids.ts";
import type { FixtureIssue } from "../packages/jira/src/fixture.ts";
import { json, testApp } from "../packages/server/src/testing.ts";

const { values } = parseArgs({
  options: {
    items: { type: "string", default: "4000" },
    runs: { type: "string", default: "20" },
  },
});
const total = Number(values.items);
const runs = Number(values.runs);

const statuses = [
  { name: "To Do", category: "todo" },
  { name: "In Progress", category: "in-progress" },
  { name: "Done", category: "done" },
] as const;
const people = ["amara", "bastian", "yuting", "dara", "esme", "farid", null];
const day = 86_400_000;
const t0 = Date.parse("2026-10-29T09:00:00.000Z");

// Generated issues: one epic per 50 items, and stories spread over them
// unevenly, with one in eleven in no epic. Deterministic, so every run
// builds the same index.
function generated(count: number): FixtureIssue[] {
  const epics = Math.max(1, Math.round(count / 50));
  const issue = (n: number, over: Partial<FixtureIssue>): FixtureIssue => ({
    key: `SYN-${5000 + n}`,
    id: String(50_000 + n),
    issueType: "Story",
    summary: `Generated item ${n}: a story title about as long as a real one`,
    description: "What the story is for, in a sentence or two, as most of SYN's are.",
    status: statuses[n % 3] ?? statuses[0],
    epic: null,
    assignee: people[n % people.length] ?? null,
    points: n % 4 === 0 ? null : (n % 8) + 1,
    labels: [],
    comments: [],
    links: [],
    updatedAt: instant(new Date(t0 - ((n * 7) % 60) * day)),
    ...over,
  });
  return Array.from({ length: count }, (_, n) => {
    if (n < epics) return issue(n, { issueType: "Epic", summary: `Generated epic ${n}` });
    const epic = n % 11 === 0 ? null : Math.floor(Math.sqrt((n * 7919) % (epics * epics)));
    return issue(n, { epic: epic === null ? null : `SYN-${5000 + epic}` });
  });
}

const cleanups: (() => Promise<void>)[] = [];
const start = () =>
  testApp(
    { after: (fn) => cleanups.push(fn) },
    { live: true, issues: (syn) => [...syn, ...generated(total - syn.length)] },
  );

type Row = { route: string; bytes: number; coldMs: number; warmMs: number };

// Each route on a server of its own, so its first request is its cold one.
async function measure(route: string): Promise<Row | null> {
  const app = await start();
  const time = async () => {
    const at = performance.now();
    const reply = await app.get(route);
    return { reply, ms: performance.now() - at };
  };
  const cold = await time();
  if (cold.reply.status === 404) return null;
  if (cold.reply.status !== 200) throw new Error(`${route}: ${cold.reply.status}`);
  const warm: number[] = [];
  for (let run = 0; run < runs; run += 1) warm.push((await time()).ms);
  warm.sort((a, b) => a - b);
  return {
    route,
    bytes: Buffer.byteLength(cold.reply.body),
    coldMs: cold.ms,
    warmMs: warm[Math.floor(warm.length / 2)] ?? 0,
  };
}

const app = await start();
const rows: Row[] = [];
for (const grouping of ["epic", "assignee", "stuck", "linked"]) {
  const whole = await measure(`/api/window?grouping=${grouping}`);
  if (whole) rows.push(whole);
  const first = await measure(`/api/browse?grouping=${grouping}`);
  if (!first) continue;
  rows.push(first);
  const { clusters } = json<{ clusters: { row: { key: string; count: number } }[] }>(
    await app.get(`/api/browse?grouping=${grouping}`),
  );
  const largest = clusters.toSorted((a, b) => b.row.count - a.row.count)[0];
  if (!largest) continue;
  const query = new URLSearchParams({ grouping, cluster: largest.row.key });
  const page = await measure(`/api/browse/items?${query}`);
  if (page) rows.push({ ...page, route: `${page.route} (${largest.row.count} items)` });
}

const { items } = json<{ items: number }>(await app.get("/api/window?grouping=epic"));
console.log(`${total} records, ${items} items in clusters; warm is the median of ${runs}`);
console.log("route\tKB\tcold ms\twarm ms");
for (const row of rows)
  console.log(
    [row.route, (row.bytes / 1024).toFixed(1), row.coldMs.toFixed(1), row.warmMs.toFixed(1)].join(
      "\t",
    ),
  );
for (const cleanup of cleanups) await cleanup();
