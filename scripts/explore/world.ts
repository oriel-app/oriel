// Worlds for the window design hill-climb (spike, window-explore): items from
// many sources, workstreams, threads and a change log, at three scales, made
// by a seeded PRNG with no network and no clock. `truth` answers TASKS.md's
// tasks from a world's data alone, never from a design.
import { readFileSync } from "node:fs";
import { fixtureIndex } from "../../packages/server/src/fixture.ts";

export type Scale = "fixtures" | "medium" | "large";
export type State = "todo" | "in-progress" | "done";
export type Shape =
  | "tracker"
  | "chat"
  | "folder"
  | "code"
  | "support"
  | "incidents"
  | "design"
  | "wiki"
  | "feedback";

export type WSource = { id: string; name: string; shape: Shape };
export type WPerson = { id: string; name: string };
export type WItem = {
  id: string;
  source: string;
  key: string;
  title: string;
  kind: string;
  // Absent: the source has no containers. Null: it has, this item has none.
  container?: string | null;
  // For a chat message, its channel.
  channel?: string;
  state?: State;
  status?: string;
  assignee?: string | null;
  estimate?: number | null;
  createdAt: string;
  updatedAt: string;
  replies?: number;
  refs: string[];
  // A source's declared facets: priority, review, checks, severity.
  facets?: Record<string, string>;
  url: string;
};
export type WChange = {
  item: string;
  at: string;
  facet: string;
  before: string | null;
  after: string | null;
};
export type WaitingOn = "agent" | "held" | "review" | "apply" | "reply";
export type ThreadState = "working" | "done" | "handed-off" | "dropped";
export type WWorkstream = {
  id: string;
  name: string;
  members: string[];
  createdAt: string;
  done: string | null;
  // The cluster it was made from, as "epic:<item id>", or null if picked.
  from: string | null;
};
export type WThread = {
  id: string;
  title: string;
  workstream: string;
  state: ThreadState;
  waitingOn: WaitingOn | null;
  doneBy: "applied" | "marked" | null;
  activityAt: string;
};
export type WReviewLink = { thread: string; sentAt: string; opened: boolean };
export type World = {
  scale: Scale;
  now: string;
  lastSeen: string;
  me: string;
  people: WPerson[];
  sources: WSource[];
  items: WItem[];
  changes: WChange[];
  workstreams: WWorkstream[];
  threads: WThread[];
  reviewLinks: WReviewLink[];
  // Which item T5 finds and whose work T6 asks about.
  ask: { find: string; person: string };
};

const day = 86_400_000;

// mulberry32
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T,
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof prng>;

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(rng: Rng): string {
  let out = "01J";
  for (let i = 0; i < 23; i += 1) out += crockford[rng.int(0, 31)];
  return out;
}

const first = [
  "Ada",
  "Bea",
  "Caleb",
  "Dana",
  "Eli",
  "Femi",
  "Gus",
  "Hana",
  "Ivo",
  "Jun",
  "Kai",
  "Lena",
  "Milo",
  "Nia",
  "Omar",
  "Pia",
  "Quinn",
  "Rosa",
  "Sven",
  "Tara",
  "Uma",
  "Vik",
  "Wren",
  "Xia",
  "Yara",
  "Zeke",
  "Arlo",
  "Bo",
  "Cyra",
  "Dev",
  "Esra",
  "Finn",
  "Gia",
  "Hugo",
  "Isla",
  "Jude",
  "Kira",
  "Luca",
  "Mara",
  "Nico",
  "Odette",
  "Pax",
  "Remy",
  "Saoirse",
  "Teo",
  "Ula",
  "Vera",
  "Wim",
  "Yusuf",
  "Zora",
];
const last = [
  "Abara",
  "Brandt",
  "Castell",
  "Dimitrov",
  "Eklund",
  "Farrow",
  "Gallo",
  "Haddon",
  "Ibsen",
  "Jovanovic",
  "Kerrigan",
  "Lindgren",
  "Moreau",
  "Nakamura",
  "Oyelaran",
  "Petrov",
  "Quist",
  "Rahimi",
  "Sato",
  "Torres",
  "Ueda",
  "Varga",
  "Whitfield",
  "Yilmaz",
  "Zelenko",
];
const topics = [
  "Gift cards",
  "Saved cards",
  "Checkout",
  "Refunds",
  "Loyalty points",
  "Seat maps",
  "Rebooking",
  "Offline mode",
  "Accessibility",
  "Pricing rules",
  "Fraud checks",
  "Partner API",
  "Reporting",
  "Data export",
  "Dark mode",
  "Localisation",
  "Invoices",
  "Notifications",
  "Onboarding",
  "Search",
  "Wishlists",
  "Promo codes",
  "Subscriptions",
  "Tax rules",
  "Receipts",
  "Address book",
  "Delivery slots",
  "Returns",
  "Order history",
  "Account deletion",
  "Two-step sign-in",
  "Team accounts",
  "Audit log",
  "Billing portal",
  "Price alerts",
  "Group bookings",
  "Waitlist",
  "Travel credits",
  "Push opt-in",
  "Help centre",
  "Status page",
  "Release train",
  "Feature flags",
  "Error budgets",
  "Data retention",
  "Consent banner",
  "Session timeouts",
  "Image uploads",
  "Bulk edit",
  "CSV import",
  "Calendar sync",
  "Map view",
  "Fare classes",
  "Upgrade offers",
  "Partner payouts",
  "Chargebacks",
  "KYC checks",
  "Store locator",
  "Referral codes",
  "Usage limits",
];
const phases = ["v2", "rollout", "cleanup", "phase 1", "for teams", "pilot", "redesign"];
const verbs = [
  "Show",
  "Let users edit",
  "Validate",
  "Log",
  "Cache",
  "Retry",
  "Explain",
  "Hide",
  "Sort",
  "Filter",
  "Email",
  "Migrate",
  "Remove",
  "Rename",
  "Track",
  "Batch",
  "Paginate",
  "Localise",
];
const objects = [
  "the balance",
  "the error message",
  "the confirmation screen",
  "the receipt",
  "the empty state",
  "the settings page",
  "the webhook",
  "the summary email",
  "the totals",
  "the date picker",
  "the expiry date",
  "the banner",
  "the export file",
  "the admin view",
  "the status badge",
  "the rate limit",
  "the audit entry",
  "the help link",
];
const channels = [
  "payments",
  "mobile",
  "support-escalations",
  "design-crit",
  "eng-announce",
  "launch-room",
  "data",
  "ops",
  "partners",
  "growth",
];

const iso = (ms: number) => new Date(ms).toISOString();
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

type Plan = {
  scale: Exclude<Scale, "fixtures">;
  seed: number;
  people: number;
  epics: Record<string, number>;
  counts: Partial<Record<string, number>>;
  workstreams: number;
  threads: number;
};

const plans: Record<Exclude<Scale, "fixtures">, Plan> = {
  medium: {
    scale: "medium",
    seed: 7,
    people: 18,
    epics: { trk: 16 },
    counts: { trk: 300, chat: 140, docs: 60, code: 60, desk: 40 },
    workstreams: 12,
    threads: 32,
  },
  large: {
    scale: "large",
    seed: 11,
    people: 60,
    epics: { trk: 90, iss: 30 },
    counts: {
      trk: 1400,
      iss: 500,
      chat: 700,
      docs: 200,
      code: 450,
      desk: 350,
      oncall: 60,
      design: 80,
      wiki: 160,
      fb: 100,
    },
    workstreams: 40,
    threads: 124,
  },
};

const sourceList: WSource[] = [
  { id: "trk", name: "Tracker", shape: "tracker" },
  { id: "iss", name: "Issues", shape: "tracker" },
  { id: "chat", name: "Chat", shape: "chat" },
  { id: "docs", name: "Docs folder", shape: "folder" },
  { id: "code", name: "Code host", shape: "code" },
  { id: "desk", name: "Support desk", shape: "support" },
  { id: "oncall", name: "On-call", shape: "incidents" },
  { id: "design", name: "Design files", shape: "design" },
  { id: "wiki", name: "Wiki", shape: "wiki" },
  { id: "fb", name: "Feedback", shape: "feedback" },
];

const trackerStatus: Record<State, string[]> = {
  todo: ["To Do", "Backlog"],
  "in-progress": ["In Progress", "In Review"],
  done: ["Done"],
};

export function generate(scale: Exclude<Scale, "fixtures">): World {
  const plan = plans[scale];
  const rng = prng(plan.seed);
  const nowMs = Date.parse("2026-10-30T16:00:00.000Z");
  const now = iso(nowMs);
  const lastSeen = iso(nowMs - 3 * day);
  const people: WPerson[] = [];
  const names = new Set<string>();
  while (people.length < plan.people) {
    const name = `${rng.pick(first)} ${rng.pick(last)}`;
    if (names.has(name)) continue;
    names.add(name);
    people.push({ id: slug(name), name });
  }
  const me = people[0]?.id ?? "";
  const sources = sourceList.filter((source) => plan.counts[source.id] !== undefined);
  const items: WItem[] = [];
  const add = (item: WItem) => items.push(item);
  // Each topic has a heat: how recently its items move.
  const heat = new Map<string, number>(topics.map((topic) => [topic, rng.next()]));
  const ago = (topic: string, spread = 1) => {
    const h = heat.get(topic) ?? 0.5;
    // Hot topics move within days; cold ones weeks ago.
    const max = 4 + (1 - h) * 60 * spread;
    return Math.floor(rng.next() * max * day);
  };
  // Tracker-shaped sources: epics, then stories under them.
  const epicsOf = new Map<string, WItem[]>();
  for (const sourceId of ["trk", "iss"]) {
    const count = plan.counts[sourceId];
    if (count === undefined) continue;
    const projects = sourceId === "trk" ? ["PAY", "WEB", "OPS"] : ["MOB"];
    const next = new Map(projects.map((project) => [project, 1]));
    const keyOf = (project: string) => {
      const n = next.get(project) ?? 1;
      next.set(project, n + 1);
      return `${project}-${n}`;
    };
    const epics: WItem[] = [];
    const nEpics = plan.epics[sourceId] ?? 0;
    for (let e = 0; e < nEpics; e += 1) {
      const topic = topics[(e + (sourceId === "iss" ? 37 : 0)) % topics.length] ?? "Checkout";
      const project = projects[e % projects.length] ?? "PAY";
      const key = keyOf(project);
      const updated = nowMs - ago(topic);
      const state: State = rng.chance(0.2) ? "done" : rng.chance(0.6) ? "in-progress" : "todo";
      const epic: WItem = {
        id: `${sourceId}:${key}`,
        source: sourceId,
        key,
        title: e < topics.length ? `${topic} ${rng.pick(phases)}` : `${topic} ${phases[e % 7]}`,
        kind: "epic",
        container: null,
        state,
        status: rng.pick(trackerStatus[state]),
        assignee: rng.pick(people).id,
        ...(sourceId === "trk" ? { estimate: null } : {}),
        createdAt: iso(updated - rng.int(20, 200) * day),
        updatedAt: iso(updated),
        refs: [],
        url: `https://tracker.example/${key}`,
        facets: { topic },
      };
      epics.push(epic);
      add(epic);
    }
    epicsOf.set(sourceId, epics);
    for (let i = epics.length; i < count; i += 1) {
      const epic = rng.chance(0.85) ? rng.pick(epics) : null;
      const topic = epic?.facets?.topic ?? rng.pick(topics);
      const project = epic ? (epic.key.split("-")[0] ?? "PAY") : rng.pick(projects);
      const key = keyOf(project);
      const updated = nowMs - ago(topic);
      const r = rng.next();
      const state: State = r < 0.35 ? "done" : r < 0.6 ? "in-progress" : "todo";
      const kind = rng.chance(0.2) ? "bug" : rng.chance(0.2) ? "task" : "story";
      add({
        id: `${sourceId}:${key}`,
        source: sourceId,
        key,
        title: `${rng.pick(verbs)} ${rng.pick(objects)} (${topic.toLowerCase()})`,
        kind,
        container: epic?.id ?? null,
        state,
        status: rng.pick(trackerStatus[state]),
        assignee: rng.chance(0.85) ? rng.pick(people).id : null,
        ...(sourceId === "trk"
          ? { estimate: rng.chance(0.75) ? rng.pick([1, 2, 3, 5, 8]) : null }
          : {}),
        createdAt: iso(updated - rng.int(2, 120) * day),
        updatedAt: iso(updated),
        refs: [],
        url: `https://tracker.example/${key}`,
        facets: { topic },
      });
    }
  }
  const tracked = items.filter((item) => item.kind !== "epic");
  const someTracked = () => rng.pick(tracked);
  // Chat: messages in channels, some naming tracker keys.
  for (let i = 0; i < (plan.counts.chat ?? 0); i += 1) {
    const channel = rng.pick(channels);
    const about = someTracked();
    const topic = about.facets?.topic ?? "Checkout";
    const names = rng.chance(0.4);
    const at = nowMs - Math.floor(rng.next() * 30 * day);
    const text = names
      ? rng.pick([
          `Is ${about.key} still on for this sprint?`,
          `${about.key} is blocked on the ${topic.toLowerCase()} copy`,
          `Can someone pick up ${about.key}?`,
          `Customers keep asking about ${about.key}`,
        ])
      : rng.pick([
          `Notes from the ${topic.toLowerCase()} sync`,
          `Anyone know who owns ${topic.toLowerCase()} now?`,
          `Heads up: ${topic.toLowerCase()} numbers dipped yesterday`,
          `Draft plan for ${topic.toLowerCase()} is up for comments`,
        ]);
    add({
      id: `chat:${channel}-${String(i).padStart(4, "0")}`,
      source: "chat",
      key: `#${channel} ${String(i).padStart(4, "0")}`,
      title: text,
      kind: "message",
      channel,
      createdAt: iso(at),
      updatedAt: iso(at + rng.int(0, 2) * day),
      replies: rng.chance(0.5) ? rng.int(1, 14) : 0,
      refs: names ? [about.id] : [],
      url: `https://chat.example/${channel}/${i}`,
      facets: { topic },
    });
  }
  const simple = (
    sourceId: string,
    make: (i: number) => Omit<WItem, "source" | "createdAt" | "updatedAt" | "url" | "refs"> & {
      refs?: string[];
      topic: string;
    },
  ) => {
    for (let i = 0; i < (plan.counts[sourceId] ?? 0); i += 1) {
      const { topic, refs, ...made } = make(i);
      const updated = nowMs - ago(topic, 1.5);
      add({
        ...made,
        source: sourceId,
        createdAt: iso(updated - rng.int(1, 90) * day),
        updatedAt: iso(updated),
        refs: refs ?? [],
        url: `https://${sourceId}.example/${encodeURIComponent(made.key)}`,
        facets: { ...made.facets, topic },
      });
    }
  };
  simple("docs", (i) => {
    const topic = rng.pick(topics);
    const folder = rng.pick(["plans", "meetings", "research", "specs"]);
    const key = `${folder}/${slug(topic)}-${i}.md`;
    return {
      id: `docs:${key}`,
      key,
      title: `${topic}: ${folder.slice(0, -1)} notes`,
      kind: "doc",
      topic,
    };
  });
  simple("code", (i) => {
    const about = someTracked();
    const topic = about.facets?.topic ?? "Checkout";
    const r = rng.next();
    const state: State = r < 0.55 ? "done" : "in-progress";
    const key = `${rng.pick(["web", "api", "app"])}#${1000 + i}`;
    return {
      id: `code:${key}`,
      key,
      title: `${about.key}: ${rng.pick(verbs).toLowerCase()} ${rng.pick(objects)}`,
      kind: "pr",
      state,
      status: state === "done" ? "Merged" : "Open",
      assignee: rng.pick(people).id,
      refs: [about.id],
      facets: {
        review: rng.pick(["approved", "changes requested", "waiting"]),
        checks: rng.chance(0.8) ? "passing" : "failing",
      },
      topic,
    };
  });
  simple("desk", (i) => {
    const topic = rng.pick(topics);
    const r = rng.next();
    const state: State = r < 0.5 ? "done" : r < 0.75 ? "in-progress" : "todo";
    const key = `T-${10200 + i}`;
    const about = rng.chance(0.3) ? someTracked() : null;
    return {
      id: `desk:${key}`,
      key,
      title: `Customer can't ${rng.pick(["see", "change", "find", "pay with"])} ${topic.toLowerCase()}`,
      kind: "ticket",
      state,
      status: state === "done" ? "Solved" : state === "in-progress" ? "Pending" : "New",
      assignee: rng.chance(0.7) ? rng.pick(people).id : null,
      refs: about ? [about.id] : [],
      facets: { priority: rng.pick(["low", "normal", "normal", "high", "urgent"]) },
      topic,
    };
  });
  simple("oncall", (i) => {
    const topic = rng.pick(topics);
    const state: State = rng.chance(0.85) ? "done" : "in-progress";
    const key = `INC-${200 + i}`;
    return {
      id: `oncall:${key}`,
      key,
      title: `${topic} ${rng.pick(["latency", "errors", "timeouts", "outage"])} in ${rng.pick(["eu", "us", "apac"])}`,
      kind: "incident",
      state,
      status: state === "done" ? "Resolved" : "Investigating",
      assignee: rng.pick(people).id,
      facets: { severity: rng.pick(["sev3", "sev3", "sev2", "sev1"]) },
      topic,
    };
  });
  simple("design", (i) => {
    const topic = rng.pick(topics);
    const key = `DF-${i + 1}`;
    return {
      id: `design:${key}`,
      key,
      title: `${topic} flow, ${rng.pick(["v1", "v2", "v3", "explorations"])}`,
      kind: "board",
      topic,
    };
  });
  simple("wiki", (i) => {
    const topic = rng.pick(topics);
    const key = `${rng.pick(["ENG", "PROD", "OPS"])}-${i + 1}`;
    return {
      id: `wiki:${key}`,
      key,
      title: `${topic}: ${rng.pick(["how it works", "runbook", "FAQ", "decision log"])}`,
      kind: "page",
      container: null,
      topic,
    };
  });
  simple("fb", (i) => {
    const about = someTracked();
    const topic = about.facets?.topic ?? "Checkout";
    const key = `FB-${900 + i}`;
    return {
      id: `fb:${key}`,
      key,
      title: `"${rng.pick(["Wish I could", "Confusing when I", "Love that I can"])} ${rng.pick(verbs).toLowerCase()} ${topic.toLowerCase()}"`,
      kind: "note",
      refs: rng.chance(0.5) ? [about.id] : [],
      topic,
    };
  });

  // Workstreams: most from an epic and its stories, plus some chat, docs and
  // pull requests about it; a few hand-picked.
  const allEpics = [...(epicsOf.get("trk") ?? []), ...(epicsOf.get("iss") ?? [])];
  const byContainer = Map.groupBy(
    items.filter((item) => item.container),
    (item) => item.container ?? "",
  );
  const refsTo = new Map<string, WItem[]>();
  for (const item of items)
    for (const ref of item.refs) refsTo.set(ref, [...(refsTo.get(ref) ?? []), item]);
  // The planted candidate: the biggest epic, kept out of every workstream.
  const sortedEpics = allEpics.toSorted(
    (a, b) => (byContainer.get(b.id)?.length ?? 0) - (byContainer.get(a.id)?.length ?? 0),
  );
  const planted = sortedEpics[0];
  if (!planted) throw new Error("no epics");
  const workstreams: WWorkstream[] = [];
  const usable = sortedEpics.slice(1);
  for (let w = 0; w < plan.workstreams; w += 1) {
    const epic = usable[(w * 2) % usable.length];
    if (!epic) break;
    const stories = byContainer.get(epic.id) ?? [];
    const talk = stories.flatMap((story) => refsTo.get(story.id) ?? []).slice(0, 6);
    const docs = items.filter(
      (item) => item.source === "docs" && item.facets?.topic === epic.facets?.topic,
    );
    const picked = w % 7 === 6;
    const members = [
      ...(picked ? [] : [epic.id]),
      ...stories.slice(0, picked ? 6 : 40).map((story) => story.id),
      ...talk.map((item) => item.id),
      ...docs.slice(0, 2).map((item) => item.id),
    ];
    const created = nowMs - rng.int(5, 80) * day;
    workstreams.push({
      id: ulid(rng),
      name: picked ? `${epic.facets?.topic ?? "Misc"} follow-ups` : epic.title,
      members: [...new Set(members)],
      createdAt: iso(created),
      done: w % 9 === 8 ? iso(nowMs - rng.int(1, 20) * day) : null,
      from: picked ? null : `epic:${epic.id}`,
    });
  }
  const open = workstreams.filter((workstream) => workstream.done === null);
  const itemById = new Map(items.map((item) => [item.id, item]));

  // Threads in every state.
  const threadTitles = [
    "Plan the rollout",
    "Draft release notes",
    "Split the big story",
    "Estimate what's left",
    "Find what's blocking",
    "Write the customer update",
    "Tidy the backlog",
    "Hand over to support",
    "Check the open bugs",
    "Summarise the chat",
  ];
  const threads: WThread[] = [];
  const states: [ThreadState, WaitingOn | null, "applied" | "marked" | null][] = [
    ["working", "agent", null],
    ["working", "review", null],
    ["working", "held", null],
    ["working", "reply", null],
    ["working", "reply", null],
    ["working", "apply", null],
    ["done", null, "applied"],
    ["done", null, "marked"],
    ["handed-off", null, null],
    ["dropped", null, null],
  ];
  for (let t = 0; t < plan.threads; t += 1) {
    const workstream = workstreams[t % workstreams.length];
    if (!workstream) break;
    const [state, waitingOn, doneBy] = states[t % states.length] ?? ["working", "reply", null];
    const live = workstream.done === null;
    const activity =
      state === "dropped" ? nowMs - rng.int(8, 30) * day : nowMs - rng.int(0, 6 * 24) * 3_600_000;
    const base = rng.pick(threadTitles);
    const topicName = workstream.name.split(" ").slice(0, 2).join(" ");
    threads.push({
      id: ulid(rng),
      title: `${base}: ${topicName.toLowerCase()}`,
      workstream: workstream.id,
      state: live ? state : "done",
      waitingOn: live ? waitingOn : null,
      doneBy: live ? doneBy : "marked",
      activityAt: iso(activity),
    });
  }
  const reviewLinks: WReviewLink[] = threads
    .filter((thread) => thread.waitingOn === "review")
    .map((thread, i) => ({ thread: thread.id, sentAt: thread.activityAt, opened: i % 2 === 0 }));

  // Plants, so each task has one clear answer.
  const membersOf = (workstream: WWorkstream) =>
    workstream.members.flatMap((id) => itemById.get(id) ?? []);
  const lastSeenMs = Date.parse(lastSeen);
  // T3: one open workstream that nothing has touched for 26+ days; every
  // other one moved within 14.
  const stalled = open[3];
  if (!stalled) throw new Error("too few workstreams");
  for (const workstream of open) {
    const members = membersOf(workstream);
    if (workstream === stalled) {
      for (const item of members)
        item.updatedAt = iso(Math.min(Date.parse(item.updatedAt), nowMs - rng.int(26, 60) * day));
      for (const thread of threads.filter((each) => each.workstream === workstream.id))
        thread.activityAt = iso(nowMs - rng.int(26, 40) * day);
    } else if (!members.some((item) => Date.parse(item.updatedAt) > nowMs - 14 * day)) {
      const item = members[0];
      if (item) item.updatedAt = iso(nowMs - rng.int(1, 13) * day);
    }
  }
  // Threads of the stalled workstream can't be waiting on anyone recent.
  for (const thread of threads.filter((each) => each.workstream === stalled.id)) {
    if (thread.state === "working") {
      thread.state = "dropped";
      thread.waitingOn = null;
    }
  }
  // T2: one open workstream whose items moved most since last seen.
  const busiest = open[1];
  if (!busiest) throw new Error("too few workstreams");
  const movedSince = (workstream: WWorkstream) =>
    membersOf(workstream).filter((item) => Date.parse(item.updatedAt) > lastSeenMs).length;
  const others = Math.max(...open.filter((w) => w !== busiest).map(movedSince));
  const target = others + (scale === "large" ? 6 : 4);
  const busyMembers = membersOf(busiest).filter((item) => item.kind !== "message");
  for (const item of busyMembers) {
    if (movedSince(busiest) >= target) break;
    if (Date.parse(item.updatedAt) <= lastSeenMs)
      item.updatedAt = iso(lastSeenMs + rng.int(1, 60) * 3_600_000);
  }
  // T4: the planted epic is the most active and the most talked about of
  // everything no workstream holds.
  const plantedStories = byContainer.get(planted.id) ?? [];
  planted.updatedAt = iso(nowMs - 6 * 3_600_000);
  for (const story of plantedStories.slice(0, Math.ceil(plantedStories.length / 2)))
    story.updatedAt = iso(nowMs - rng.int(1, 5 * 24) * 3_600_000);
  // T7: the most-talked-about item is in a workstream (so it isn't a
  // candidate), named by chat messages this week.
  const talked = membersOf(open[0] ?? busiest).find((item) => item.kind === "story");
  if (!talked) throw new Error("no story to talk about");
  const chats = items.filter((item) => item.source === "chat");
  const weekAgo = nowMs - 7 * day;
  const recentRefs = (id: string) =>
    chats.filter((chat) => chat.refs.includes(id) && Date.parse(chat.updatedAt) > weekAgo).length;
  const counts = new Map<string, number>();
  for (const chat of chats)
    if (Date.parse(chat.updatedAt) > weekAgo)
      for (const ref of chat.refs) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());
  const plantedRefs = Math.max(most - 1, 3);
  let n = 0;
  for (const chat of chats) {
    if (recentRefs(talked.id) >= most + (scale === "large" ? 6 : 4)) break;
    if (chat.refs.length > 0) continue;
    chat.refs = [talked.id];
    chat.title = rng.pick([
      `Is ${talked.key} going to make the release?`,
      `${talked.key} broke again on staging`,
      `Who's reviewing ${talked.key}?`,
      `${talked.key}: customers are asking`,
    ]);
    chat.updatedAt = iso(nowMs - rng.int(1, 6 * 24) * 3_600_000);
    n += 1;
  }
  // Some of the chat also names the planted epic's stories, less than T7's.
  for (const story of plantedStories.slice(0, plantedRefs)) {
    const chat = chats.find((each) => each.refs.length === 0);
    if (!chat) break;
    chat.refs = [story.id];
    chat.title = `${story.key} needs a decision before the release`;
    chat.updatedAt = iso(nowMs - rng.int(1, 6 * 24) * 3_600_000);
  }
  void n;
  // T6: a person with a clear set of work in progress, most of it in one
  // workstream.
  const person = people[5] ?? people[1];
  if (!person) throw new Error("too few people");
  for (const item of items)
    if (item.assignee === person.id && item.state === "in-progress")
      item.assignee = people[6]?.id ?? me;
  const home = open[2];
  if (!home) throw new Error("too few workstreams");
  const homeStories = membersOf(home).filter(
    (item) => item.kind === "story" || item.kind === "bug",
  );
  const elsewhere = tracked.filter(
    (item) => !open.some((workstream) => workstream.members.includes(item.id)),
  );
  const mine = [...homeStories.slice(0, 4), ...elsewhere.slice(0, 2)];
  for (const item of mine) {
    item.assignee = person.id;
    item.state = "in-progress";
    item.status = "In Progress";
    item.updatedAt = iso(Math.max(Date.parse(item.updatedAt), nowMs - rng.int(1, 9) * day));
  }
  // The stalled workstream keeps nothing recent, whatever the plants did.
  for (const item of membersOf(stalled))
    if (Date.parse(item.updatedAt) > nowMs - 26 * day) item.updatedAt = iso(nowMs - 27 * day);
  // T1: one waiting thread clearly older than the rest.
  const waiting = threads.filter(isWaiting);
  const oldest = waiting.find((thread) => thread.workstream !== stalled.id);
  if (oldest) oldest.activityAt = iso(nowMs - 9 * day);
  for (const thread of waiting)
    if (thread !== oldest && Date.parse(thread.activityAt) < nowMs - 6 * day)
      thread.activityAt = iso(nowMs - 5 * day);
  // T5: an item in a workstream, found by its key.
  const find = membersOf(open[4] ?? busiest).find(
    (item) => item.kind === "bug" || item.kind === "story",
  );
  if (!find) throw new Error("nothing to find");

  const world: World = {
    scale,
    now,
    lastSeen,
    me,
    people,
    sources,
    items,
    changes: changeLog(items, rng),
    workstreams,
    threads,
    reviewLinks,
    ask: { find: find.id, person: person.id },
  };
  return world;
}

// Each item's history: its state moves, with the last at its update time.
function changeLog(items: readonly WItem[], rng: Rng): WChange[] {
  const out: WChange[] = [];
  for (const item of items) {
    const updated = Date.parse(item.updatedAt);
    const created = Date.parse(item.createdAt);
    if (item.state === undefined) {
      out.push({ item: item.id, at: item.updatedAt, facet: "edited", before: null, after: null });
      continue;
    }
    const path: State[] =
      item.state === "done"
        ? ["todo", "in-progress", "done"]
        : item.state === "in-progress"
          ? ["todo", "in-progress"]
          : ["todo"];
    for (let i = 1; i < path.length; i += 1) {
      const at = i === path.length - 1 ? updated : created + (updated - created) * rng.next();
      out.push({
        item: item.id,
        at: iso(at),
        facet: "state",
        before: path[i - 1] ?? null,
        after: path[i] ?? null,
      });
    }
    if (path.length === 1)
      out.push({
        item: item.id,
        at: item.updatedAt,
        facet: rng.pick(["people", "estimate"]),
        before: null,
        after: "set",
      });
  }
  return out.toSorted((a, b) => a.at.localeCompare(b.at));
}

// The repo's fixtures as they are, with workstreams and threads laid on.
export function fixtures(): World {
  const { records, now } = fixtureIndex();
  const nowMs = Date.parse(now);
  const rng = prng(3);
  const people = new Map<string, WPerson>();
  const items: WItem[] = records.map((record) => {
    const assignee = record.facets.people?.find((person) => person.role === "assignee") ?? null;
    if (assignee) people.set(assignee.id, { id: assignee.id, name: assignee.name });
    const attrs = record.attrs as { status?: string };
    const text = `${record.title}`;
    return {
      id: record.id,
      source: "jira",
      key: record.id.slice(5),
      title: record.title,
      kind: record.facets.kind ?? "story",
      container: record.facets.container?.id ?? null,
      state: record.facets.state ?? "todo",
      status: attrs.status ?? "",
      assignee: assignee?.id ?? null,
      estimate: record.facets.estimate ?? null,
      createdAt: record.updatedAt,
      updatedAt: record.updatedAt,
      refs: [...text.matchAll(/SYN-\d+/g)]
        .map((m) => `jira:${m[0]}`)
        .filter((id) => id !== record.id),
      url: record.location,
    };
  });
  const slack = JSON.parse(
    readFileSync(new URL("../../fixtures/slack/workspace.json", import.meta.url), "utf8"),
  ) as {
    users: { id: string; real_name: string }[];
    channels: {
      id: string;
      name: string;
      messages: {
        ts: string;
        user?: string;
        subtype?: string;
        text: string;
        reply_count?: number;
      }[];
    }[];
  };
  for (const channel of slack.channels) {
    for (const message of channel.messages) {
      if (message.subtype && message.subtype !== "bot_message") continue;
      if (!message.text) continue;
      const at = new Date(Number(message.ts) * 1000).toISOString();
      items.push({
        id: `slack:${channel.id}-${message.ts}`,
        source: "slack",
        key: `#${channel.name}`,
        title: message.text.split("\n")[0]?.slice(0, 120) ?? "",
        kind: "message",
        channel: channel.name,
        createdAt: at,
        updatedAt: at,
        replies: message.reply_count ?? 0,
        refs: [...message.text.matchAll(/SYN-\d+/g)].map((m) => `jira:${m[0]}`),
        url: `https://ferrowick-example.slack.com/archives/${channel.id}/p${message.ts.replace(".", "")}`,
      });
    }
  }
  const tree = JSON.parse(
    readFileSync(new URL("../../fixtures/folder/tree.json", import.meta.url), "utf8"),
  ) as { files: { path: string; mtime: string; text?: string }[] };
  for (const file of tree.files) {
    items.push({
      id: `folder:${file.path}`,
      source: "folder",
      key: file.path,
      title: (file.text ?? "").split("\n")[0]?.replace(/^#\s*/, "") || file.path,
      kind: "doc",
      createdAt: file.mtime,
      updatedAt: file.mtime,
      refs: [...(file.text ?? "").matchAll(/SYN-\d+/g)].map((m) => `jira:${m[0]}`),
      url: `file:///notes/${encodeURIComponent(file.path)}`,
    });
  }
  const byContainer = Map.groupBy(
    items.filter((item) => item.container),
    (item) => item.container ?? "",
  );
  const epics = items.filter((item) => item.kind === "epic");
  const workstreams: WWorkstream[] = epics.slice(0, 4).map((epic, i) => ({
    id: ulid(rng),
    name: epic.title,
    members: [epic.id, ...(byContainer.get(epic.id) ?? []).map((item) => item.id)],
    createdAt: new Date(nowMs - (10 + i) * day).toISOString(),
    done: null,
    from: `epic:${epic.id}`,
  }));
  const pick = (i: number) => workstreams[i % workstreams.length]?.id ?? "";
  const spec: [string, ThreadState, WaitingOn | null, "applied" | "marked" | null, number][] = [
    ["Plan the gift card stories", "working", "review", null, 0.5],
    ["Why is rebooking slipping?", "working", "reply", null, 2],
    ["Rename the checkout epic", "working", "held", null, 1],
    ["Estimate the open bugs", "working", "agent", null, 0.1],
    ["Hand SYN-61 to the team", "handed-off", null, null, 4],
    ["Mark the built stories done", "done", null, "applied", 3],
    ["What changed this week?", "done", null, "marked", 5],
    ["Tidy localisation", "dropped", null, null, 12],
  ];
  const threads: WThread[] = spec.map(([title, state, waitingOn, doneBy, daysAgo], i) => ({
    id: ulid(rng),
    title,
    workstream: pick(i),
    state,
    waitingOn,
    doneBy,
    activityAt: new Date(nowMs - daysAgo * day).toISOString(),
  }));
  const sources: WSource[] = [
    { id: "jira", name: "Jira", shape: "tracker" },
    { id: "slack", name: "Slack", shape: "chat" },
    { id: "folder", name: "Folder", shape: "folder" },
  ];
  const find = items.find((item) => item.key === "SYN-54") ?? items[10];
  const person = [...people.values()][2];
  return {
    scale: "fixtures",
    now,
    lastSeen: new Date(nowMs - 3 * day).toISOString(),
    me: [...people.keys()][0] ?? "",
    people: [...people.values()],
    sources,
    items,
    changes: changeLog(items, rng),
    workstreams,
    threads,
    reviewLinks: threads
      .filter((thread) => thread.waitingOn === "review")
      .map((thread) => ({ thread: thread.id, sentAt: thread.activityAt, opened: false })),
    ask: { find: find?.id ?? "", person: person?.id ?? "" },
  };
}

export function world(scale: Scale): World {
  return scale === "fixtures" ? fixtures() : generate(scale);
}

export const isWaiting = (thread: WThread) =>
  thread.state === "working" &&
  (thread.waitingOn === "held" || thread.waitingOn === "review" || thread.waitingOn === "reply");

// TASKS.md's answers. Each lists every answer that ties, so a tie grades
// any of them right.
export type Truth = {
  t1: { count: number; oldest: string[] };
  t2: { workstreams: string[]; count: number };
  t3: { workstreams: string[]; days: number };
  t4: { names: string[]; key: string; source: string };
  t5: { key: string; status: string; workstream: string | null };
  t6: { person: string; count: number; workstreams: string[] };
  t7: { keys: string[]; titles: string[]; count: number };
};

export function truth(w: World): Truth {
  const nowMs = Date.parse(w.now);
  const lastSeenMs = Date.parse(w.lastSeen);
  const itemById = new Map(w.items.map((item) => [item.id, item]));
  const open = w.workstreams.filter((workstream) => workstream.done === null);
  const held = new Set(open.flatMap((workstream) => workstream.members));
  const argBest = <T>(list: readonly T[], score: (x: T) => number, low = false) => {
    const scored = list.map((x) => [x, score(x)] as const);
    const best = low
      ? Math.min(...scored.map(([, s]) => s))
      : Math.max(...scored.map(([, s]) => s));
    return { best, all: scored.filter(([, s]) => s === best).map(([x]) => x) };
  };
  // T1
  const waiting = w.threads.filter(isWaiting);
  const oldest = argBest(waiting, (t) => Date.parse(t.activityAt), true);
  // T2
  const changedSince = new Set(
    w.changes.filter((change) => Date.parse(change.at) > lastSeenMs).map((change) => change.item),
  );
  const t2 = argBest(open, (ws) => ws.members.filter((id) => changedSince.has(id)).length);
  // T3
  const lastActivity = (ws: WWorkstream) =>
    Math.max(
      ...ws.members.map((id) => Date.parse(itemById.get(id)?.updatedAt ?? "1970-01-01")),
      ...w.threads.filter((t) => t.workstream === ws.id).map((t) => Date.parse(t.activityAt)),
    );
  const t3 = argBest(open, lastActivity, true);
  // T4: by the planted rule, the epic no workstream holds with the most
  // activity this week, its references counted twice.
  const weekAgo = nowMs - 7 * 86_400_000;
  const refsThisWeek = new Map<string, number>();
  for (const item of w.items)
    if (Date.parse(item.updatedAt) > weekAgo)
      for (const ref of item.refs) refsThisWeek.set(ref, (refsThisWeek.get(ref) ?? 0) + 1);
  const childrenOf = Map.groupBy(
    w.items.filter((item) => item.container),
    (item) => item.container ?? "",
  );
  const epics = w.items.filter((item) => item.kind === "epic" && !held.has(item.id));
  const weight = (epic: WItem) => {
    const children = childrenOf.get(epic.id) ?? [];
    const moved = children.filter((child) => Date.parse(child.updatedAt) > weekAgo).length;
    const refs = children.reduce((sum, child) => sum + (refsThisWeek.get(child.id) ?? 0), 0);
    return moved + 2 * refs + children.length / 10;
  };
  const t4 = argBest(epics, weight);
  // T5
  const found = itemById.get(w.ask.find);
  const home = open.find((ws) => ws.members.includes(w.ask.find));
  // T6
  const doing = w.items.filter(
    (item) => item.assignee === w.ask.person && item.state === "in-progress",
  );
  const t6 = argBest(open, (ws) => doing.filter((item) => ws.members.includes(item.id)).length);
  // T7: references from chat messages this week.
  const chatRefs = new Map<string, number>();
  for (const item of w.items)
    if (item.kind === "message" && Date.parse(item.updatedAt) > weekAgo)
      for (const ref of item.refs) chatRefs.set(ref, (chatRefs.get(ref) ?? 0) + 1);
  const t7 = argBest([...chatRefs.keys()], (id) => chatRefs.get(id) ?? 0);
  const t4Item = t4.all[0];
  return {
    t1: { count: waiting.length, oldest: oldest.all.map((t) => t.title) },
    t2: { workstreams: t2.all.map((ws) => ws.name), count: t2.best },
    t3: {
      workstreams: t3.all.map((ws) => ws.name),
      days: Math.floor((nowMs - t3.best) / 86_400_000),
    },
    t4: {
      names: t4.all.map((item) => item.title),
      key: t4Item?.key ?? "",
      source: w.sources.find((source) => source.id === t4Item?.source)?.name ?? "",
    },
    t5: {
      key: found?.key ?? "",
      status: found?.status ?? "",
      workstream: home?.name ?? null,
    },
    t6: {
      person: w.people.find((p) => p.id === w.ask.person)?.name ?? "",
      count: doing.length,
      workstreams: t6.best === 0 ? [] : t6.all.map((ws) => ws.name),
    },
    t7: {
      keys: t7.all.map((id) => itemById.get(id)?.key ?? id),
      titles: t7.all.map((id) => itemById.get(id)?.title ?? id),
      count: t7.best,
    },
  };
}

if (import.meta.main) {
  for (const scale of ["fixtures", "medium", "large"] as const) {
    const w = world(scale);
    console.log(
      scale,
      `${w.items.length} items, ${w.sources.length} sources, ${w.workstreams.length} workstreams, ${w.threads.length} threads, ${w.changes.length} changes`,
    );
    console.log(JSON.stringify(truth(w), null, 1));
  }
}
