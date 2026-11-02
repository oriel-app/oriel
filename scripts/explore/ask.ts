// Spike: the window chat, mocked, for rounds 10 to 14 (TASKS2.md). No model:
// a fixed set of questions, matched by pattern and answered from the world by
// the reads 0027 gives the window chat's agent. What's scored is the design:
// where you ask, how answers read, how acting and pinning work.
import type { Answer, Block, ChatData, Cite, Pinned } from "../../packages/web/src/explore/data.ts";
import { overview } from "./overview.ts";
import type { WItem, World, WWorkstream } from "./world.ts";

const day = 86_400_000;
const weekday = (iso: string) =>
  new Date(iso).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" });

function reads(w: World) {
  const nowMs = Date.parse(w.now);
  const lastSeenMs = Date.parse(w.lastSeen);
  const itemById = new Map(w.items.map((item) => [item.id, item]));
  const open = w.workstreams.filter((ws) => ws.done === null);
  const changedSince = new Set(
    w.changes.filter((change) => Date.parse(change.at) > lastSeenMs).map((change) => change.item),
  );
  const members = (ws: WWorkstream) => ws.members.flatMap((id) => itemById.get(id) ?? []);
  const moved = (ws: WWorkstream) => members(ws).filter((item) => changedSince.has(item.id));
  const person = new Map(w.people.map((p) => [p.id, p.name]));
  const daysAgo = (iso: string) => Math.floor((nowMs - Date.parse(iso)) / day);
  return { nowMs, itemById, open, changedSince, members, moved, person, daysAgo };
}

// The workstreams moved since the user looked, most first.
function movedBy(w: World) {
  const r = reads(w);
  return r.open
    .map((ws) => ({ ws, moved: r.moved(ws).length }))
    .filter((row) => row.moved > 0)
    .toSorted((a, b) => b.moved - a.moved || a.ws.name.localeCompare(b.ws.name));
}

// Per source, items changed since the user looked, most first.
function bySource(w: World) {
  const r = reads(w);
  return w.sources
    .map((source) => {
      const mine = w.items.filter((item) => item.source === source.id);
      return {
        name: source.name,
        items: mine.length,
        changed: mine.filter((item) => r.changedSince.has(item.id)).length,
      };
    })
    .toSorted((a, b) => b.changed - a.changed || a.name.localeCompare(b.name));
}

// Per person, a workstream's members in progress, most first.
function inProgress(w: World, ws: WWorkstream) {
  const r = reads(w);
  const doing = r
    .members(ws)
    .filter((item) => item.state === "in-progress" && item.assignee && item.kind !== "epic");
  return [...Map.groupBy(doing, (item) => item.assignee ?? "")]
    .map(([id, list]) => ({
      name: r.person.get(id) ?? id,
      count: list.length,
      moved: list.filter((item) => r.changedSince.has(item.id)).length,
    }))
    .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function lastChanged(w: World, ws: WWorkstream) {
  return reads(w)
    .members(ws)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function make(w: World, id: string, name?: string) {
  const anchor = w.items.find((item) => item.id === id);
  if (!anchor) return null;
  const members = [
    anchor.id,
    ...w.items.filter((item) => item.container === anchor.id).map((item) => item.id),
  ];
  const ws: WWorkstream = {
    id: `01JMADE${String(w.workstreams.length).padStart(19, "0")}`,
    name: name ?? anchor.title,
    members,
    createdAt: w.now,
    done: null,
    from: `epic:${anchor.id}`,
  };
  w.workstreams.push(ws);
  return { id: ws.id, name: ws.name, size: members.length };
}

export function unmake(w: World, id: string) {
  const at = w.workstreams.findIndex((ws) => ws.id === id);
  if (at >= 0) w.workstreams.splice(at, 1);
}

const can = [
  "Chart what moved since I looked, by workstream",
  "Which sources changed most since I looked?",
  "Who has work in progress in <a workstream>?",
  "Why is <a workstream> stalled?",
  "Make a workstream of <an item key, or the top thing not in one>",
];

export function ask(w: World, q: string, cites: Cite[] = []): Answer {
  const r = reads(w);
  const text = q.toLowerCase();
  const base = { q, cites, lines: [], blocks: [], pin: null, made: null } satisfies Answer;
  // What it's about: a cited workstream or item, or one the question names.
  const cited = cites.find((c) => c.kind === "workstream");
  const named = r.open
    .filter((ws) => text.includes(ws.name.toLowerCase()))
    .toSorted((a, b) => b.name.length - a.name.length)[0];
  const ws = (cited && r.open.find((x) => x.id === cited.id)) ?? named;
  const keyed = q.match(/\b[A-Z][A-Z0-9]*-\d+\b/)?.[0];
  const item: WItem | undefined =
    w.items.find((x) => x.id === cites.find((c) => c.kind === "item")?.id) ??
    (keyed ? w.items.find((x) => x.key === keyed) : undefined);

  if (/\bmake\b|\bcreate\b|\bstart\b/.test(text) && /workstream/.test(text)) {
    const top = overview(w).candidates.find((c) => c.kind === "cluster");
    const anchor = item ?? (top ? r.itemById.get(top.id) : undefined);
    if (!anchor) return { ...base, lines: ["There's nothing to make a workstream of."] };
    const made = make(w, anchor.id);
    if (!made) return { ...base, lines: ["I couldn't find that item."] };
    return {
      ...base,
      lines: [
        `Made the workstream ${made.name}, with ${made.size} items: ${anchor.key} and the ${made.size - 1} items under it.`,
      ],
      made,
    };
  }

  if (/chart|graph|plot|bars?\b/.test(text) && /moved|changed|activity/.test(text)) {
    const rows = movedBy(w);
    const [first, second, third] = rows;
    if (!first)
      return { ...base, lines: [`Nothing moved since you looked ${weekday(w.lastSeen)}.`] };
    const shown = rows.slice(0, 10);
    const block: Block = {
      kind: "bars",
      read: `the change log: members changed since ${weekday(w.lastSeen)}`,
      title: `Items moved since ${weekday(w.lastSeen)}, by workstream`,
      unit: "items",
      bars: shown.map((row) => ({ label: row.ws.name, value: row.moved })),
      more: rows.length - shown.length,
    };
    const tail = [second, third]
      .flatMap((row) => (row ? [`${row.ws.name} ${row.moved}`] : []))
      .join(", ");
    return {
      ...base,
      lines: [
        `${rows.length} of your ${r.open.length} workstreams moved since you looked. ${first.ws.name} moved most, ${first.moved} items${second ? `; then ${second.ws.name}, ${second.moved}` : ""}.`,
      ],
      blocks: [block],
      pin: {
        title: "Moved most since you looked",
        headline: `${first.ws.name} ${first.moved}${tail ? `, ${tail}` : ""}`,
      },
    };
  }

  if (/source/.test(text)) {
    const rows = bySource(w);
    const [first, second] = rows;
    if (!first) return { ...base, lines: ["No source has items."] };
    return {
      ...base,
      lines: [
        `Since you looked ${weekday(w.lastSeen)}, ${first.name} changed most: ${first.changed} of its ${first.items} items${second ? `; then ${second.name}, ${second.changed}` : ""}.`,
      ],
      blocks: [
        {
          kind: "table",
          read: `the change log: items changed since ${weekday(w.lastSeen)}, by source`,
          columns: ["Source", "Changed since you looked", "Items"],
          rows: rows.map((row) => [row.name, row.changed, row.items]),
        },
      ],
      pin: {
        title: "Sources changed most since you looked",
        headline: rows
          .slice(0, 3)
          .map((row) => `${row.name} ${row.changed}`)
          .join(", "),
      },
    };
  }

  if (ws && /\bwho\b|people|person|progress|working/.test(text) && !/why|stall/.test(text)) {
    const rows = inProgress(w, ws);
    const top = rows[0];
    if (!top) return { ...base, lines: [`Nobody has an item in progress in ${ws.name}.`] };
    return {
      ...base,
      lines: [
        `${rows.length} people have items in progress in ${ws.name}. ${top.name} has most: ${top.count}.`,
      ],
      blocks: [
        {
          kind: "table",
          read: `${ws.name}'s members in progress, by assignee`,
          columns: ["Person", "In progress", "Moved since you looked"],
          rows: rows.map((row) => [row.name, row.count, row.moved]),
        },
      ],
      pin: {
        title: `In progress in ${ws.name}`,
        headline: rows
          .slice(0, 3)
          .map((row) => `${row.name} ${row.count}`)
          .join(", "),
      },
    };
  }

  if (ws) {
    const list = lastChanged(w, ws);
    const last = list[0];
    const idle = last ? r.daysAgo(last.updatedAt) : 0;
    const doing = list.filter((x) => x.state === "in-progress");
    const nobody = doing.filter((x) => !x.assignee).length;
    const threads = w.threads.filter((t) => t.workstream === ws.id && t.state === "working");
    return {
      ...base,
      lines: [
        idle >= 14
          ? `Nothing in ${ws.name} has moved in ${idle} days.`
          : `${ws.name} last moved ${idle === 0 ? "today" : `${idle} days ago`}.`,
        last
          ? `The last change was ${last.key} ${last.title}, ${idle} days ago (${last.status ?? "no status"}).`
          : "",
        `${doing.length} of its ${list.length} items are in progress${nobody > 0 ? `, ${nobody} with nobody assigned` : ""}. ${threads.length === 0 ? "No thread is working on it." : `${threads.length} threads are working.`}`,
      ].filter(Boolean),
      blocks: [
        {
          kind: "items",
          read: `${ws.name}'s members, last updated first`,
          rows: list.slice(0, 5).map((x) => ({
            key: x.key,
            title: x.title,
            sub: `${x.status ?? "—"} · ${r.daysAgo(x.updatedAt)}d ago · ${r.person.get(x.assignee ?? "") ?? "nobody"}`,
          })),
        },
      ],
      pin: {
        title: `${ws.name}`,
        headline: last ? `quiet ${idle} days · last ${last.key}` : "no items",
      },
    };
  }

  if (item) {
    const home = r.open.find((x) => x.members.includes(item.id));
    return {
      ...base,
      lines: [
        `${item.key} ${item.title} is ${item.status ?? "without a status"}, ${home ? `in ${home.name}` : "not in a workstream"}. Updated ${r.daysAgo(item.updatedAt)} days ago.`,
      ],
    };
  }

  return {
    ...base,
    lines: [
      "I can't answer that in this prototype. It answers questions like these, from Oriel's reads:",
      ...can,
    ],
  };
}

// A pinned answer reruns on each look; no model, so a pin is free to keep.
export function pinned(w: World, pins: { id: string; q: string; cites: Cite[] }[]): Pinned[] {
  return pins.flatMap((p) => {
    const a = ask(structuredClone(w), p.q, p.cites);
    const first = a.blocks[0];
    const block: Block | null =
      first?.kind === "bars"
        ? {
            ...first,
            bars: first.bars.slice(0, 5),
            more: first.more + Math.max(0, first.bars.length - 5),
          }
        : first?.kind === "table"
          ? { ...first, rows: first.rows.slice(0, 5) }
          : first?.kind === "items"
            ? { ...first, rows: first.rows.slice(0, 5) }
            : null;
    return a.pin ? [{ ...p, ...a.pin, block }] : [];
  });
}

// Questions to start from, computed from the overview: never generated.
export function chat(w: World, pins: { id: string; q: string; cites: Cite[] }[]): ChatData {
  const o = overview(w);
  const moved = o.workstreams.toSorted((a, b) => b.moved - a.moved)[0];
  const quiet = o.workstreams.toSorted((a, b) => a.lastActivity.localeCompare(b.lastActivity))[0];
  return {
    pins: pinned(w, pins),
    suggestions: [
      "Chart what moved since I looked, by workstream",
      "Which sources changed most since I looked?",
      ...(moved ? [`Who has work in progress in ${moved.name}?`] : []),
      ...(quiet ? [`Why is ${quiet.name} stalled?`] : []),
    ],
  };
}

// TASKS2.md's answers. Each lists every answer that ties.
export type AskTruth = {
  a1: { sources: string[]; count: number };
  a2: { workstreams: string[]; count: number; top: string; topCount: number };
  a3: { names: string[]; size: number };
  a5: { workstream: string; keys: string[]; titles: string[]; days: number };
};

export function askTruth(w: World): AskTruth {
  const r = reads(w);
  const rows = movedBy(w);
  const top = rows[0];
  const sources = bySource(w);
  const a1count = sources.find((row) => row.changed < (sources[0]?.changed ?? 0))?.changed ?? 0;
  const secondCount = rows.find((row) => row.moved < (top?.moved ?? 0))?.moved ?? 0;
  // A3: the epic T4 names, by its own rule (truth() in world.ts).
  const o = overview(w);
  const epic = o.candidates.find((c) => c.kind === "cluster" && c.rule.startsWith("An epic"));
  // A5: the stalled workstream (T3), and its member updated last.
  const lastActivity = (ws: WWorkstream) =>
    Math.max(
      ...r.members(ws).map((x) => Date.parse(x.updatedAt)),
      ...w.threads.filter((t) => t.workstream === ws.id).map((t) => Date.parse(t.activityAt)),
    );
  const stalled = r.open.toSorted((a, b) => lastActivity(a) - lastActivity(b))[0];
  const list = stalled ? lastChanged(w, stalled) : [];
  const latest = list[0]?.updatedAt ?? "";
  const lastOnes = list.filter((x) => x.updatedAt === latest);
  return {
    a1: {
      sources: sources.filter((row) => row.changed === a1count).map((row) => row.name),
      count: a1count,
    },
    a2: {
      workstreams: rows.filter((row) => row.moved === secondCount).map((row) => row.ws.name),
      count: secondCount,
      top: top?.ws.name ?? "",
      topCount: top?.moved ?? 0,
    },
    a3: { names: epic ? [epic.label] : [], size: epic?.size ?? 0 },
    a5: {
      workstream: stalled?.name ?? "",
      keys: lastOnes.map((x) => x.key),
      titles: lastOnes.map((x) => x.title),
      days: latest ? r.daysAgo(latest) : 0,
    },
  };
}

if (import.meta.main) {
  const { world } = await import("./world.ts");
  const { truth } = await import("./world.ts");
  for (const scale of ["medium", "large"] as const) {
    const w = world(scale);
    console.log(scale, JSON.stringify(askTruth(w)), JSON.stringify(truth(w).t4));
    const t = askTruth(w);
    for (const q of [
      "Chart what moved since I looked, by workstream",
      "Which sources changed most since I looked?",
      `Why is ${t.a5.workstream} stalled?`,
      "Make a workstream of the top thing not in a workstream",
    ])
      console.log(JSON.stringify(ask(w, q)).slice(0, 600));
  }
}
