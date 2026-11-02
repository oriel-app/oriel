// Spike (window-explore): what the prototype overview's route returns. Types
// only, so the server and the browser both import it. Every number is
// computed from the index, the change log and Oriel's own data; nothing is
// generated.

export type Category = "todo" | "in-progress" | "done";

export type OverviewItem = {
  id: string;
  key: string;
  title: string;
  source: string;
  kind: string;
  status: string | null;
  category: Category | null;
  assignee: string | null;
  updatedAt: string;
  url: string;
};

export type Signal = { rule: string; text: string; tone: "warn" | "info" };

export type Card = {
  id: string;
  name: string;
  size: number;
  bySource: { source: string; count: number }[];
  status: Record<Category, number>;
  // Members changed since the user last looked, and how many moved to done.
  moved: number;
  movedDone: number;
  // The latest member update or thread activity.
  lastActivity: string;
  idleDays: number;
  // Member changes per day, the last 14 days, oldest first.
  activity: number[];
  threads: { working: number; waiting: number; done: number; dropped: number };
  signals: Signal[];
  // A few of what moved since the user last looked.
  movedItems: { key: string; title: string; to: string }[];
};

export type Waiting = {
  thread: { id: string; title: string };
  workstream: { id: string; name: string };
  waitingOn: "held" | "review" | "reply";
  since: string;
};

export type Candidate = {
  id: string;
  kind: "cluster" | "item";
  label: string;
  key: string;
  source: string;
  rule: string;
  weight: number;
  size: number;
  // What it shows as a reason: "12 moved this week · 4 chat mentions".
  detail: string;
  suggested: string;
};

export type PersonRow = {
  id: string;
  name: string;
  inProgress: number;
  workstreams: { name: string; count: number }[];
  items: { key: string; title: string; workstream: string | null }[];
};

export type Talked = {
  id: string;
  key: string;
  title: string;
  source: string;
  refs: number;
  workstream: string | null;
};

export type OverviewData = {
  now: string;
  lastSeen: string;
  me: string;
  counts: {
    changed: number;
    workstreamsMoved: number;
    needsYou: number;
    unopened: number;
    candidates: number;
    items: number;
    sources: number;
  };
  needsYou: Waiting[];
  unopened: { thread: { id: string; title: string }; workstream: string; sentAt: string }[];
  workstreams: Card[];
  candidates: Candidate[];
  people: PersonRow[];
  talked: Talked[];
  sources: { name: string; shape: string; items: number; changed: number }[];
  // Rounds 10 to 14: pinned answers, rerun on each look, and asks to start from.
  chat?: ChatData;
};

export type ListData = { total: number; items: (OverviewItem & { workstream: string | null })[] };

// Rounds 10 to 14: the window chat, mocked. A block is built from a read's
// result, never from the agent's words; `read` names that read.
export type Block =
  | { kind: "table"; read: string; columns: string[]; rows: (string | number)[][] }
  | {
      kind: "bars";
      read: string;
      title: string;
      unit: string;
      bars: { label: string; value: number }[];
      more: number;
    }
  | { kind: "items"; read: string; rows: { key: string; title: string; sub: string }[] };

export type Cite = { kind: "workstream" | "item"; id: string; label: string };

export type Answer = {
  q: string;
  cites: Cite[];
  lines: string[];
  blocks: Block[];
  // One line that reruns on each look, for an answer that can be pinned.
  pin: { title: string; headline: string } | null;
  made: { id: string; name: string; size: number } | null;
};

export type Pinned = {
  id: string;
  q: string;
  cites: Cite[];
  title: string;
  headline: string;
  // Round 12 on: the answer's first block, its top five, so a pin keeps its form.
  block: Block | null;
};

export type ChatData = { pins: Pinned[]; suggestions: string[] };
