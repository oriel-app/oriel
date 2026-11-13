// `node --expose-gc scripts/bench-search.ts [--items <n>] [--runs <n>]`
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  type IndexRecord,
  instant,
  maxSearchText,
  ulid,
  unknown,
} from "../packages/core/src/index.ts";
import { indexStore } from "../packages/db/src/index-store.ts";
import { loadMigrations, migrate } from "../packages/db/src/migrate.ts";
import { open } from "../packages/db/src/open.ts";
import { ensureWorkspace } from "../packages/db/src/workspaces.ts";

const { values } = parseArgs({
  options: { items: { type: "string", default: "20000" }, runs: { type: "string", default: "20" } },
});
const total = Number(values.items);
const runs = Number(values.runs);
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("run with node --expose-gc");

let seed = 264;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const syllables = "ka ri to na me su lo pe ra vi do mu fe ta ne ko sa li bo ze".split(" ");
const accented = ["résumé", "café", "naïve", "façade", "jalapeño", "smörgåsbord"];
const common = "the and of to a in for on with launch fare route ferry timetable".split(" ");
const vocabulary = Array.from({ length: 20_000 }, (_, i) => {
  if (i < accented.length) return accented[i] ?? "";
  let word = "";
  for (let n = 2 + (i % 3); n > 0; n--) word += syllables[Math.floor(random() * syllables.length)];
  return word;
});
const word = () =>
  random() < 0.45
    ? (common[Math.floor(random() * common.length)] ?? "")
    : (vocabulary[Math.floor(vocabulary.length * random() ** 3)] ?? "");
const words = (count: number) => Array.from({ length: count }, word).join(" ");

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const item = (n: number): { record: IndexRecord; text: string } => {
  const key = `SYN-${n + 1}`;
  const length = Math.floor(80 + (maxSearchText - 80) * random() ** 2);
  return {
    record: {
      id: `jira:${key}`,
      stableId: String(10_000 + n),
      title: words(4 + (n % 7)),
      location: `https://oriel.atlassian.net/browse/${key}`,
      updatedAt: instant(new Date(Date.parse(t0) - (n % 400) * 3_600_000)),
      facets: {},
      attrs: {},
    },
    text: words(Math.ceil(length / 6)).slice(0, length),
  };
};
let chars = 0;

const dir = mkdtempSync(join(tmpdir(), "oriel-bench-search-"));
const memory = () => {
  gc();
  const { heapUsed, rss } = process.memoryUsage();
  return { heapMB: Math.round(heapUsed / 1e5) / 10, rssMB: Math.round(rss / 1e5) / 10 };
};
try {
  const db = open(join(dir, "oriel.db"));
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "bench" }, t0);
  const index = indexStore(db);
  const generated = memory();

  let syncMs = 0;
  let at = performance.now();
  const run = index.beginSync(workspaceId, "jira", unknown, t0);
  syncMs += performance.now() - at;
  for (let from = 0; from < total; from += 100) {
    const page = Array.from({ length: Math.min(100, total - from) }, (_, i) => item(from + i));
    chars += page.reduce((sum, { text }) => sum + text.length, 0);
    at = performance.now();
    run.apply({
      records: page.map(({ record }) => record),
      gone: [],
      cursor: null,
      texts: Object.fromEntries(page.map(({ record, text }) => [record.stableId, text])),
    });
    syncMs += performance.now() - at;
  }
  at = performance.now();
  run.finish(null, t0);
  syncMs += performance.now() - at;
  index.records(workspaceId, "jira", unknown);
  const synced = memory();

  const queries = ["launch", "ferry timetable", "resume", "kari", "SYN-1234", "the", "zezeze"];
  at = performance.now();
  const first = index.search(workspaceId, "café route", 50);
  const firstMs = performance.now() - at;
  const warm: number[] = [];
  for (let i = 0; i < runs; i++)
    for (const query of queries) {
      at = performance.now();
      index.search(workspaceId, query, 50);
      warm.push(performance.now() - at);
    }
  const searched = memory();

  const browse = (query: string) => {
    const store = index as unknown as Record<string, (...args: unknown[]) => unknown>;
    const all = index.records(workspaceId, "jira", unknown);
    if (store.matches) {
      const found = store.matches(workspaceId, query) as ReadonlyMap<string, string>;
      return all.filter((record) => found.has(record.id)).length;
    }
    const text = store.searchText?.(workspaceId) as (id: string) => string;
    return all.filter((record) => text(record.id).includes(query)).length;
  };
  at = performance.now();
  browse("timetable");
  const browseFirstMs = performance.now() - at;
  const browseWarm: number[] = [];
  for (let i = 0; i < runs; i++) {
    at = performance.now();
    browse("ferry");
    browseWarm.push(performance.now() - at);
  }
  const browsed = memory();
  const median = (all: number[]) => all.toSorted((a, b) => a - b)[Math.floor(all.length / 2)] ?? 0;
  const ms = (value: number) => Math.round(value * 10) / 10;
  db.close();
  console.log(
    JSON.stringify(
      {
        items: total,
        textChars: chars,
        firstHits: first.length,
        syncMs: ms(syncMs),
        searchFirstMs: ms(firstMs),
        searchWarmMedianMs: ms(median(warm)),
        searchWarmMaxMs: ms(Math.max(...warm)),
        browseFirstMs: ms(browseFirstMs),
        browseWarmMedianMs: ms(median(browseWarm)),
        memory: { generated, synced, searched, browsed },
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
