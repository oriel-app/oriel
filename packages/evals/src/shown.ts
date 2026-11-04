// A reply as the user reads it, with each chip (decision 0032) drawn as the
// window draws it, from the case's world: an item as its fixture draws its
// chip once the case's edits are in, such as a Jira item by its key and
// title, a file by its title or a Slack message by its author; an item the
// region holds that is gone from the index by its key, if its source shows
// keys; a thread or change set as a link to it in the window and where it
// stands; a workstream by its name and whether it is done. An item's status,
// which its chip also shows, is left out: it is the source's fact, which the
// agent didn't state, and a judge would hold the agent to it. Every grader
// reads what the user reads, so a reply that names things by ID is graded as
// fairly as one that writes names.
//
// It also counts what didn't resolve: a chip nothing in the world has, which
// the window draws as "unknown reference", and a link the agent wrote itself
// to a thread or change set the workspace doesn't have (a miscopied,
// look-alike ID). Either fails the `refs` grade.
import { type Instant, parseItemId } from "@oriel/core";
import { chipStateName } from "@oriel/web/chip";
import { chipIds } from "@oriel/web/markdown";
import type { ChipView } from "@oriel/web/view";
import type { OrielWorkspace } from "./case.ts";
import { fixtureOf, type Fixtures } from "./fixtures.ts";
import type { Grade } from "./graders.ts";
import { windowWorkstreamId } from "./world.ts";

export type World = {
  fixtures: Fixtures;
  // How many of each fixture's edits the case's index has, by kind.
  edited: Readonly<Partial<Record<string, number>>>;
  oriel: OrielWorkspace | undefined;
  // The items the case's region holds, by ID.
  held: readonly string[];
  // A window chat case's workstreams, by name, and when it asks.
  window: { workstreams: readonly { name: string }[]; now: Instant } | null;
};

// Quotes in a title would pair with the reply's own; graders read pairs.
const plain = (title: string) => title.replace(/["“”]/g, "");

// A name, with where it stands as its chip says it.
const standing = (name: string, chip: ChipView) => {
  const state = chipStateName(chip);
  return state ? `${name} (${state})` : name;
};

// What each ID the world holds reads as, drawn.
export function resolver(world: World): (id: string) => string | null {
  const names = new Map<string, string>();
  for (const [kind, { loaded }] of world.fixtures)
    for (const [id, chip] of loaded.chips(world.edited[kind] ?? 0)) names.set(id, plain(chip));
  const workstream = (name: string) => standing(name, { kind: "workstream", name, done: false });
  const { window } = world;
  window?.workstreams.forEach(({ name }, i) =>
    names.set(windowWorkstreamId(window.now, i), workstream(name)),
  );
  const threads = new Map((world.oriel?.threads ?? []).map((thread) => [thread.id, thread]));
  for (const thread of threads.values()) {
    const { id, name, workstream: of } = thread;
    // No turn runs in a case's workspace, so a working thread waits on the
    // user, and its chip says so.
    const state = thread.state === "working" ? "needs-you" : thread.state;
    names.set(id, standing(`[${name}](/threads/${id})`, { kind: "thread", name, state }));
    names.set(of.id, workstream(of.name));
  }
  for (const set of world.oriel?.changeSets ?? []) {
    const name = threads.get(set.thread)?.name ?? "change set";
    const link = `[${name}](/threads/${set.thread}?changeSet=${set.id})`;
    const chip: ChipView = { kind: "change-set", thread: set.thread, name, state: set.state };
    names.set(set.id, standing(link, chip));
  }
  // A source whose items a reply calls by their key shows the key.
  for (const id of world.held)
    if (!names.has(id)) {
      const keyed = fixtureOf(world.fixtures, id)?.called === undefined;
      const key = parseItemId(id)?.key;
      names.set(id, `${keyed && key ? `${key} ` : ""}Not in the index`);
    }
  return (id) => names.get(id) ?? null;
}

export type Shown = { text: string; refs: number; unresolved: string[] };

const threadAddress = /\/threads\/([0-9A-Za-z]+)(?:\?changeSet=([0-9A-Za-z]+))?/g;

export function shown(reply: string, resolve: (id: string) => string | null): Shown {
  const ids = new Set(chipIds(reply));
  const unresolved = [...ids].filter((id) => resolve(id) === null);
  let refs = 0;
  const text = reply.replace(/\[\[\s*([^\][\s]+)\s*\]\]/g, (typed, id: string) => {
    if (!ids.has(id)) return typed;
    refs++;
    return resolve(id) ?? "unknown reference";
  });
  // Links the agent wrote itself, which no read gives it any more.
  for (const [, thread, set] of reply.matchAll(threadAddress)) {
    refs++;
    for (const id of [thread, set])
      if (id !== undefined && resolve(id) === null) unresolved.push(id);
  }
  return { text, refs, unresolved };
}

// Every chip, and every link to a thread or change set, names something the
// workspace has. Null when the reply names nothing that way.
export function gradeRefs(seen: Shown): Grade | null {
  if (seen.refs === 0) return null;
  const pass = seen.unresolved.length === 0;
  const detail = `${seen.refs} named by ID, unresolved: ${seen.unresolved.join(", ") || "none"}`;
  return { grader: "refs", pass, detail };
}
