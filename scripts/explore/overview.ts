// Spike: the overview's data from a world, as 0027 has the server compute it:
// counts, needs-you, a card per workstream, every source's candidates ranked
// together, work in progress by person, and what the chat names most. Pure.
import type {
  Candidate,
  Card,
  Category,
  ListData,
  OverviewData,
  OverviewItem,
  PersonRow,
  Talked,
  Waiting,
} from "../../packages/web/src/explore/data.ts";
import { isWaiting, type WItem, type World, type WWorkstream } from "./world.ts";

const day = 86_400_000;

export function overview(w: World): OverviewData {
  const nowMs = Date.parse(w.now);
  const lastSeenMs = Date.parse(w.lastSeen);
  const weekAgo = nowMs - 7 * day;
  const itemById = new Map(w.items.map((item) => [item.id, item]));
  const sourceName = new Map(w.sources.map((source) => [source.id, source.name]));
  const personName = new Map(w.people.map((person) => [person.id, person.name]));
  const open = w.workstreams.filter((ws) => ws.done === null);
  const held = new Map<string, WWorkstream>();
  for (const ws of open) for (const id of ws.members) if (!held.has(id)) held.set(id, ws);
  const changesBy = Map.groupBy(w.changes, (change) => change.item);
  const since = w.changes.filter((change) => Date.parse(change.at) > lastSeenMs);
  const changedSince = new Set(since.map((change) => change.item));

  const threadsOf = Map.groupBy(w.threads, (thread) => thread.workstream);
  const cards: Card[] = open.map((ws) => {
    const members = ws.members.flatMap((id) => itemById.get(id) ?? []);
    const status: Record<Category, number> = { todo: 0, "in-progress": 0, done: 0 };
    for (const item of members) if (item.state) status[item.state] += 1;
    const bySource = [...Map.groupBy(members, (item) => item.source)].map(([source, list]) => ({
      source: sourceName.get(source) ?? source,
      count: list.length,
    }));
    const moved = members.filter((item) => changedSince.has(item.id));
    const movedDone = moved.filter((item) =>
      (changesBy.get(item.id) ?? []).some(
        (c) => Date.parse(c.at) > lastSeenMs && c.facet === "state" && c.after === "done",
      ),
    );
    const threads = threadsOf.get(ws.id) ?? [];
    const lastActivity = Math.max(
      ...members.map((item) => Date.parse(item.updatedAt)),
      ...threads.map((thread) => Date.parse(thread.activityAt)),
    );
    const activity = Array.from({ length: 14 }, () => 0);
    for (const item of members)
      for (const change of changesBy.get(item.id) ?? []) {
        const back = Math.floor((nowMs - Date.parse(change.at)) / day);
        if (back >= 0 && back < 14) activity[13 - back] = (activity[13 - back] ?? 0) + 1;
      }
    const idleDays = Math.floor((nowMs - lastActivity) / day);
    const signals: Card["signals"] = [];
    if (idleDays >= 14)
      signals.push({
        rule: "No member update and no thread activity in 14 days",
        text: `Nothing moved in ${idleDays} days`,
        tone: "warn",
      });
    const failing = members.filter(
      (item) => item.facets?.checks === "failing" && item.state !== "done",
    );
    if (failing.length > 0)
      signals.push({
        rule: "An open pull request among its members has failing checks",
        text: `${failing.length} PR${failing.length === 1 ? "" : "s"} failing checks`,
        tone: "warn",
      });
    const urgent = members.filter(
      (item) => item.facets?.priority === "urgent" && item.state !== "done",
    );
    if (urgent.length > 0)
      signals.push({
        rule: "An urgent support ticket among its members is open",
        text: `${urgent.length} urgent ticket${urgent.length === 1 ? "" : "s"}`,
        tone: "warn",
      });
    return {
      id: ws.id,
      name: ws.name,
      size: members.length,
      bySource,
      status,
      moved: moved.length,
      movedDone: movedDone.length,
      lastActivity: new Date(lastActivity).toISOString(),
      idleDays,
      activity,
      threads: {
        working: threads.filter((t) => t.state === "working").length,
        waiting: threads.filter(isWaiting).length,
        done: threads.filter((t) => t.state === "done" || t.state === "handed-off").length,
        dropped: threads.filter((t) => t.state === "dropped").length,
      },
      signals,
      movedItems: moved.slice(0, 3).map((item) => ({
        key: item.key,
        title: item.title,
        to: item.status ?? "edited",
      })),
    };
  });

  const wsById = new Map(w.workstreams.map((ws) => [ws.id, ws]));
  const needsYou: Waiting[] = w.threads
    .filter(isWaiting)
    .toSorted((a, b) => a.activityAt.localeCompare(b.activityAt))
    .map((thread) => ({
      thread: { id: thread.id, title: thread.title },
      workstream: { id: thread.workstream, name: wsById.get(thread.workstream)?.name ?? "" },
      waitingOn: thread.waitingOn as Waiting["waitingOn"],
      since: thread.activityAt,
    }));
  const threadById = new Map(w.threads.map((thread) => [thread.id, thread]));
  const unopened = w.reviewLinks
    .filter((link) => !link.opened)
    .map((link) => {
      const thread = threadById.get(link.thread);
      return {
        thread: { id: link.thread, title: thread?.title ?? "" },
        workstream: wsById.get(thread?.workstream ?? "")?.name ?? "",
        sentAt: link.sentAt,
      };
    });

  // Candidates: each source's signals, on one shared weight scale.
  const refsThisWeek = new Map<string, number>();
  const chatRefs = new Map<string, number>();
  for (const item of w.items)
    if (Date.parse(item.updatedAt) > weekAgo)
      for (const ref of item.refs) {
        refsThisWeek.set(ref, (refsThisWeek.get(ref) ?? 0) + 1);
        if (item.kind === "message") chatRefs.set(ref, (chatRefs.get(ref) ?? 0) + 1);
      }
  const childrenOf = Map.groupBy(
    w.items.filter((item) => item.container),
    (item) => item.container ?? "",
  );
  const candidates: Candidate[] = [];
  const src = (item: WItem) => sourceName.get(item.source) ?? item.source;
  for (const item of w.items) {
    if (held.has(item.id)) continue;
    if (item.kind === "epic") {
      const children = childrenOf.get(item.id) ?? [];
      const moved = children.filter((child) => Date.parse(child.updatedAt) > weekAgo).length;
      const refs = children.reduce((sum, child) => sum + (refsThisWeek.get(child.id) ?? 0), 0);
      const weight = moved + 2 * refs + children.length / 10;
      if (weight < 1) continue;
      candidates.push({
        id: item.id,
        kind: "cluster",
        label: item.title,
        key: item.key,
        source: src(item),
        rule: "An epic no workstream holds, by its items' activity this week",
        weight,
        size: children.length + 1,
        detail: [
          `${children.length} items`,
          moved > 0 ? `${moved} moved this week` : null,
          refs > 0 ? `named ${refs}× elsewhere` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        suggested: item.title,
      });
      continue;
    }
    const open = item.state !== undefined && item.state !== "done";
    const idle = Math.floor((nowMs - Date.parse(item.updatedAt)) / day);
    if (
      item.kind === "message" &&
      item.title.includes("?") &&
      (item.replies ?? 0) === 0 &&
      Date.parse(item.updatedAt) > weekAgo
    )
      candidates.push({
        id: item.id,
        kind: "item",
        label: item.title,
        key: item.key,
        source: src(item),
        rule: "A question this week with no reply",
        weight: 3,
        size: 1,
        detail: "no reply",
        suggested: item.title.slice(0, 40),
      });
    else if (item.kind === "pr" && open && item.facets?.checks === "failing")
      candidates.push({
        id: item.id,
        kind: "item",
        label: item.title,
        key: item.key,
        source: src(item),
        rule: "An open pull request with failing checks",
        weight: 4,
        size: 1,
        detail: `checks failing · review ${item.facets.review}`,
        suggested: item.title.slice(0, 40),
      });
    else if (item.kind === "ticket" && open && item.facets?.priority === "urgent")
      candidates.push({
        id: item.id,
        kind: "item",
        label: item.title,
        key: item.key,
        source: src(item),
        rule: "An urgent ticket, still open",
        weight: 6,
        size: 1,
        detail: "urgent",
        suggested: item.title.slice(0, 40),
      });
    else if (item.kind === "incident" && open)
      candidates.push({
        id: item.id,
        kind: "item",
        label: item.title,
        key: item.key,
        source: src(item),
        rule: "An incident still open",
        weight: item.facets?.severity === "sev1" ? 9 : 5,
        size: 1,
        detail: item.facets?.severity ?? "",
        suggested: item.title.slice(0, 40),
      });
    else if (item.state === "in-progress" && idle >= 14 && item.kind !== "pr")
      candidates.push({
        id: item.id,
        kind: "item",
        label: item.title,
        key: item.key,
        source: src(item),
        rule: "In progress, no update in 14 days",
        weight: 1.5,
        size: 1,
        detail: `${idle} days idle`,
        suggested: item.title.slice(0, 40),
      });
  }
  // Linked clusters: an item no workstream holds, named often this week.
  for (const [id, count] of refsThisWeek) {
    const item = itemById.get(id);
    if (!item || held.has(id) || count < 3 || item.kind === "epic") continue;
    candidates.push({
      id,
      kind: "cluster",
      label: item.title,
      key: item.key,
      source: src(item),
      rule: "An item named 3 or more times this week, and what names it",
      weight: 2 * count,
      size: count + 1,
      detail: `named ${count}× this week`,
      suggested: item.title.slice(0, 40),
    });
  }
  candidates.sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));

  const people: PersonRow[] = [
    ...Map.groupBy(
      w.items.filter(
        (item) => item.state === "in-progress" && item.assignee && item.kind !== "epic",
      ),
      (item) => item.assignee ?? "",
    ),
  ]
    .map(([id, list]) => {
      const byWs = Map.groupBy(list, (item) => held.get(item.id)?.name ?? "");
      return {
        id,
        name: personName.get(id) ?? id,
        inProgress: list.length,
        workstreams: [...byWs]
          .filter(([name]) => name !== "")
          .map(([name, items]) => ({ name, count: items.length }))
          .toSorted((a, b) => b.count - a.count),
        items: list.slice(0, 8).map((item) => ({
          key: item.key,
          title: item.title,
          workstream: held.get(item.id)?.name ?? null,
        })),
      };
    })
    .toSorted((a, b) => b.inProgress - a.inProgress || a.name.localeCompare(b.name));

  const talked: Talked[] = [...chatRefs]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 10)
    .flatMap(([id, refs]) => {
      const item = itemById.get(id);
      return item
        ? [
            {
              id,
              key: item.key,
              title: item.title,
              source: src(item),
              refs,
              workstream: held.get(id)?.name ?? null,
            },
          ]
        : [];
    });

  return {
    now: w.now,
    lastSeen: w.lastSeen,
    me: personName.get(w.me) ?? w.me,
    counts: {
      changed: changedSince.size,
      workstreamsMoved: cards.filter((card) => card.moved > 0).length,
      needsYou: needsYou.length,
      unopened: unopened.length,
      candidates: candidates.length,
      items: w.items.length,
      sources: w.sources.length,
    },
    needsYou,
    unopened,
    workstreams: cards,
    candidates,
    people,
    talked,
    sources: w.sources.map((source) => {
      const mine = w.items.filter((item) => item.source === source.id);
      return {
        name: source.name,
        shape: source.shape,
        items: mine.length,
        changed: mine.filter((item) => changedSince.has(item.id)).length,
      };
    }),
  };
}

export function itemOf(w: World, item: WItem): OverviewItem {
  return {
    id: item.id,
    key: item.key,
    title: item.title,
    source: w.sources.find((source) => source.id === item.source)?.name ?? item.source,
    kind: item.kind,
    status: item.status ?? null,
    category: item.state ?? null,
    assignee: w.people.find((person) => person.id === item.assignee)?.name ?? null,
    updatedAt: item.updatedAt,
    url: item.url,
  };
}

// Browse, filtered: items matching a query, a source or a person, 50 at a time.
export function list(
  w: World,
  filter: { q?: string; source?: string; person?: string; changed?: boolean; workstream?: string },
  page = 0,
): ListData {
  const q = filter.q?.trim().toLowerCase() ?? "";
  const open = w.workstreams.filter((ws) => ws.done === null);
  const held = new Map<string, string>();
  for (const ws of open) for (const id of ws.members) if (!held.has(id)) held.set(id, ws.name);
  const lastSeenMs = Date.parse(w.lastSeen);
  const person = filter.person ? w.people.find((p) => p.name === filter.person)?.id : undefined;
  const wsMembers = filter.workstream
    ? new Set(w.workstreams.find((ws) => ws.name === filter.workstream)?.members ?? [])
    : null;
  const matched = w.items.filter(
    (item) =>
      (q === "" || item.key.toLowerCase().includes(q) || item.title.toLowerCase().includes(q)) &&
      (!filter.source || w.sources.find((s) => s.id === item.source)?.name === filter.source) &&
      (!person || (item.assignee === person && item.state === "in-progress")) &&
      (!filter.changed || Date.parse(item.updatedAt) > lastSeenMs) &&
      (!wsMembers || wsMembers.has(item.id)),
  );
  // An exact key first.
  matched.sort(
    (a, b) =>
      Number(b.key.toLowerCase() === q) - Number(a.key.toLowerCase() === q) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  return {
    total: matched.length,
    items: matched.slice(page * 50, page * 50 + 50).map((item) => ({
      ...itemOf(w, item),
      workstream: held.get(item.id) ?? null,
    })),
  };
}
