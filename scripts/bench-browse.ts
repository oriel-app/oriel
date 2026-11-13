// `node scripts/bench-browse.ts [--items <n>] [--runs <n>]`
import { parseArgs } from "node:util";
import { json, testApp } from "../packages/server/src/testing.ts";
import { bigWorld } from "./big-world.ts";

const { values } = parseArgs({
  options: {
    items: { type: "string", default: "4000" },
    runs: { type: "string", default: "20" },
  },
});
const total = Number(values.items);
const runs = Number(values.runs);

const cleanups: (() => Promise<void>)[] = [];
const start = () =>
  testApp({ after: (fn) => cleanups.push(fn) }, { memory: true, issues: bigWorld(total) });

type Row = { route: string; bytes: number; coldMs: number; warmMs: number };

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

const { items } = app.app.window("epic");
console.log(`${total} records, ${items} items in clusters; warm is the median of ${runs}`);
console.log("route\tKB\tcold ms\twarm ms");
for (const row of rows)
  console.log(
    [row.route, (row.bytes / 1024).toFixed(1), row.coldMs.toFixed(1), row.warmMs.toFixed(1)].join(
      "\t",
    ),
  );
for (const cleanup of cleanups) await cleanup();
