// A reply as the user reads it, with each chip (decision 0032) drawn as the
// window draws it, from the case's world: a Jira item by its key and title
// as the index holds them once the case's edits are in, a file by its
// title, a Slack message by its author, a thread or change set as a link to
// it in the window, a workstream by its name. Every grader reads what the
// user reads, so a reply that names things by ID is graded as fairly as
// one that writes names.
//
// It also counts what didn't resolve: a chip nothing in the world has, which
// the window draws as "unknown reference", and a link the agent wrote itself
// to a thread or change set the workspace doesn't have (a miscopied,
// look-alike ID). Either fails the `refs` grade.
import { fixtureSnapshot, type JiraFixture } from "@oriel/jira";
import type { SlackFixture } from "@oriel/slack";
import { chipIds } from "@oriel/web/markdown";
import { fileTitle, type FolderFixture } from "../../../scripts/fixtures/folder.ts";
import type { OrielWorkspace } from "./case.ts";
import type { Grade } from "./graders.ts";
import { evalSite, fileId } from "./world.ts";

export type World = {
  fixture: JiraFixture;
  // How many of the fixture's Jira edits the case's index has.
  edited: number;
  folder: FolderFixture | null;
  slack: SlackFixture | null;
  oriel: OrielWorkspace | undefined;
};

// Quotes in a title would pair with the reply's own; graders read pairs.
const plain = (title: string) => title.replace(/["“”]/g, "");

// What each ID the world holds reads as, drawn.
export function resolver(world: World): (id: string) => string | null {
  const names = new Map<string, string>();
  for (const record of fixtureSnapshot(world.fixture, evalSite, world.edited).records)
    names.set(record.id, `${record.id.slice("jira:".length)} ${plain(record.title)}`);
  for (const file of world.folder?.files ?? [])
    names.set(fileId(file.path), plain(fileTitle(file.path)));
  for (const channel of world.slack?.channels ?? [])
    for (const message of channel.messages) {
      const person = world.slack?.users.find((user) => user.id === message.user);
      const who = person?.real_name ?? message.username ?? "someone";
      names.set(`slack:${channel.id}-${message.ts}`, `${who}'s message`);
    }
  const threads = new Map((world.oriel?.threads ?? []).map((thread) => [thread.id, thread]));
  for (const thread of threads.values()) {
    names.set(thread.id, `[${thread.name}](/threads/${thread.id})`);
    names.set(thread.workstream.id, thread.workstream.name);
  }
  for (const set of world.oriel?.changeSets ?? []) {
    const name = threads.get(set.thread)?.name ?? "change set";
    names.set(set.id, `[${name}](/threads/${set.thread}?changeSet=${set.id})`);
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
