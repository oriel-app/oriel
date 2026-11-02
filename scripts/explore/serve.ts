// Spike: a server for the window hill-climb. It serves the real web app with
// the JSON routes it loads on the window (the window, workstreams, threads,
// Jira, folder) answered from a generated world, so round 0 is today's window
// code on that world; and the prototype overview's routes under
// /api/explore/. Never the live server, never on 4310.
//
// node scripts/explore/serve.ts --scale large --port 4391
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import type { IndexRecord, Instant, ItemId, Presentations } from "../../packages/core/src/index.ts";
import { clusterZoom, listZoom } from "../../packages/groupings/src/index.ts";
import { bodyReader, webFiles } from "../../packages/server/src/serve.ts";
import { handler, type Reply } from "../../packages/server/src/site.ts";
import { groupings } from "../../packages/server/src/window.ts";
import type { Cite } from "../../packages/web/src/explore/data.ts";
import type {
  GroupingId,
  ThreadSummaryView,
  WindowView,
  WorkstreamSummary,
} from "../../packages/web/src/view.ts";
import { ask, chat, make, unmake } from "./ask.ts";
import { list, overview } from "./overview.ts";
import { type Scale, type WItem, world as makeWorld, type World } from "./world.ts";

// Today's window knows three kinds of source. A world's other sources show
// there as the nearest kind: trackers, code, support, incidents and feedback
// as tracker items; chat as chat; docs, design files and wiki as files.
function kindOf(item: WItem, w: World): "jira" | "slack" | "folder" {
  if (item.source === "jira" || item.source === "slack" || item.source === "folder")
    return item.source;
  const shape = w.sources.find((source) => source.id === item.source)?.shape;
  if (shape === "chat") return "slack";
  if (shape === "folder" || shape === "design" || shape === "wiki") return "folder";
  return "jira";
}

export function recordsOf(w: World): { records: IndexRecord[]; idOf: (id: string) => string } {
  const ids = new Map<string, string>();
  const idOf = (id: string) => ids.get(id) ?? id;
  for (const item of w.items) {
    const kind = kindOf(item, w);
    const native = item.source === kind;
    const key = native
      ? item.id.slice(item.id.indexOf(":") + 1)
      : kind === "jira" && (item.source === "trk" || item.source === "iss")
        ? item.key
        : `${item.source}/${item.key.replace(/\s+/g, "-").replace(/^#/, "")}`;
    ids.set(item.id, `${kind}:${key}`);
  }
  const people = new Map(w.people.map((person) => [person.id, person.name]));
  const records = w.items.map((item): IndexRecord => {
    const kind = kindOf(item, w);
    const tracks = kind === "jira";
    return {
      id: idOf(item.id) as ItemId,
      stableId: item.id,
      title: item.title,
      location: item.url,
      updatedAt: item.updatedAt as Instant,
      facets: {
        ...(tracks
          ? {
              people: item.assignee
                ? [{ role: "assignee", id: item.assignee, name: people.get(item.assignee) ?? "" }]
                : [],
            }
          : {}),
        ...(item.state ? { state: item.state } : {}),
        ...(item.container !== undefined
          ? {
              container: item.container
                ? { id: idOf(item.container) as ItemId, stableId: item.container }
                : null,
            }
          : {}),
        kind: item.kind,
        ...(item.estimate !== undefined ? { estimate: item.estimate } : {}),
      },
      attrs: {
        type: item.kind[0]?.toUpperCase() + item.kind.slice(1),
        status: item.status ?? "",
        replies: item.replies ?? 0,
      },
    };
  });
  return { records, idOf };
}

const details = (record: IndexRecord) => {
  const attrs = record.attrs as { type: string; status: string; replies: number };
  return { type: attrs.type, status: attrs.status, labels: [], replies: attrs.replies };
};
const presentations: Presentations = {
  jira: { name: "Tracker", details },
  slack: { name: "Chat", details },
  folder: { name: "Files", details },
};

export function windowView(w: World, records: IndexRecord[], grouping: GroupingId): WindowView {
  const now = w.now as Instant;
  const clusters = groupings[grouping].group(records, now);
  const rows = clusterZoom(now, presentations);
  const lists = listZoom(now, presentations);
  const shown = clusters.map((cluster) => ({
    row: rows.view(cluster, records),
    list: lists.view(cluster, records),
  }));
  return {
    grouping,
    clusters: shown,
    items: new Set(clusters.flatMap((cluster) => cluster.itemIds)).size,
    asOf: now,
    fixture: false,
    locations: Object.fromEntries(records.map((record) => [record.id, record.location])),
  };
}

function summaries(w: World): WorkstreamSummary[] {
  return w.workstreams.map((ws) => {
    const threads = w.threads.filter((thread) => thread.workstream === ws.id);
    const count = (state: string) => threads.filter((thread) => thread.state === state).length;
    return {
      id: ws.id,
      name: ws.name,
      origin: ws.from ? { kind: "cluster", grouping: "Epic", label: ws.name } : { kind: "picked" },
      version: 1,
      size: ws.members.length,
      createdAt: ws.createdAt,
      threads: {
        working: count("working"),
        done: count("done"),
        "handed-off": count("handed-off"),
        dropped: count("dropped"),
      },
      done: ws.done ? { at: ws.done, by: "user" } : null,
    };
  });
}

function threadsView(w: World): ThreadSummaryView[] {
  const names = new Map(w.workstreams.map((ws) => [ws.id, ws.name]));
  return w.threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    workstream: { id: thread.workstream, name: names.get(thread.workstream) ?? "" },
    state: thread.state,
    doneBy: thread.doneBy,
    waitingOn: thread.waitingOn,
    activityAt: thread.activityAt,
  }));
}

export async function startExplore(scale: Scale, port: number) {
  const w = makeWorld(scale);
  const { records } = recordsOf(w);
  // Pinned answers: the question, rerun on each look.
  const pins: { id: string; q: string; cites: Cite[] }[] = [];
  // Built per request, as the real server builds the window per request.
  const json = (status: number, body: unknown): Reply => ({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const site = {
    ...webFiles(),
    port,
    window: (grouping: GroupingId) => windowView(w, records, grouping),
    api: async (
      request: { method: string; body?: (n: number) => Promise<string | null> },
      url: URL,
    ): Promise<Reply | null> => {
      const path = url.pathname;
      if (path === "/api/workstreams") return json(200, { workstreams: summaries(w) });
      if (path === "/api/threads") return json(200, { threads: threadsView(w) });
      if (path === "/api/threads/events") return { status: 204, headers: {}, body: "" };
      if (path === "/api/jira")
        return json(200, {
          connected: {
            site: "https://tracker.example",
            project: "PAY",
            items: w.items.length,
            syncedAt: w.now,
          },
          connectable: false,
        });
      if (path === "/api/folder") return json(200, null);
      if (path === "/api/telemetry") return { status: 204, headers: {}, body: "" };
      if (path === "/api/explore/overview")
        return json(200, { ...overview(w), chat: chat(w, pins) });
      const post = async () =>
        JSON.parse((await request.body?.(10_000)) ?? "{}") as {
          q?: string;
          cites?: Cite[];
          id?: string;
          name?: string;
        };
      if (path === "/api/explore/ask" && request.method === "POST") {
        const body = await post();
        return json(200, ask(w, body.q ?? "", body.cites ?? []));
      }
      if (path === "/api/explore/pin" && request.method === "POST") {
        const body = await post();
        const id = `pin${pins.length + 1}`;
        pins.push({ id, q: body.q ?? "", cites: body.cites ?? [] });
        return json(200, { id });
      }
      if (path === "/api/explore/unpin" && request.method === "POST") {
        const body = await post();
        pins.splice(
          pins.findIndex((p) => p.id === body.id),
          1,
        );
        return json(200, {});
      }
      if (path === "/api/explore/unmake" && request.method === "POST") {
        unmake(w, (await post()).id ?? "");
        return json(200, {});
      }
      if (path === "/api/explore/list") {
        const p = url.searchParams;
        return json(
          200,
          list(
            w,
            {
              ...(p.get("q") ? { q: p.get("q") ?? "" } : {}),
              ...(p.get("source") ? { source: p.get("source") ?? "" } : {}),
              ...(p.get("person") ? { person: p.get("person") ?? "" } : {}),
              ...(p.get("workstream") ? { workstream: p.get("workstream") ?? "" } : {}),
              ...(p.get("changed") ? { changed: true } : {}),
            },
            Number(p.get("page") ?? 0),
          ),
        );
      }
      if (path === "/api/explore/make" && request.method === "POST") {
        const body = await post();
        const made = make(w, body.id ?? "", body.name);
        return made ? json(200, made) : json(404, { error: "no such item" });
      }
      return null;
    },
  };
  const handle = handler(site);
  const server = createServer(async (req, res) => {
    const reply = await handle({
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: req.headers as never,
      body: bodyReader(req),
    });
    res.writeHead(reply.status, reply.headers);
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    world: w,
    url: `http://localhost:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      scale: { type: "string", default: "large" },
      port: { type: "string", default: "4391" },
    },
  });
  const port = Number(values.port);
  if (port === 4310) throw new Error("4310 is the live server's");
  const serving = await startExplore(values.scale as Scale, port);
  console.log(`${values.scale} world on ${serving.url}`);
}
