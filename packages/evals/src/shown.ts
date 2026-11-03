// Spike (reply-elements): a reply as the user would read it, with each
// `[[id]]` reference drawn as Oriel would draw it, from the case's world:
// an item by its key and title, a file by its title, a Slack message by its
// author, a thread or change set as the window's link to it, a workstream by
// its name. Every grader then reads what the user reads, so an arm that
// references by ID is graded as fairly as one that writes names.
//
// Also counts what didn't resolve: a `[[id]]` nothing in the world has, and a
// `/threads/…` link to a thread or change set the case's workspace doesn't
// have (a miscopied, look-alike ID). Either fails the `refs` grade.
import { changeSetLink, threadLink } from "@oriel/core";
import type { JiraFixture } from "@oriel/jira";
import type { SlackFixture } from "@oriel/slack";
import { fileTitle, type FolderFixture } from "../../../scripts/fixtures/folder.ts";
import type { OrielWorkspace } from "./case.ts";
import { fileId } from "./world.ts";

export type Shown = { text: string; refs: number; unresolved: string[] };

export type World = {
  fixture: JiraFixture;
  folder: FolderFixture | null;
  slack: SlackFixture | null;
  oriel: OrielWorkspace | undefined;
};

// Quotes in a title would pair with the reply's own; the grader reads pairs.
const plain = (title: string) => title.replaceAll('"', "").replaceAll("“", "").replaceAll("”", "");

export function resolver(world: World): (id: string) => string | null {
  const names = new Map<string, string>();
  for (const issue of world.fixture.issues)
    names.set(`jira:${issue.key}`, `${issue.key} ${plain(issue.summary)}`);
  for (const file of world.folder?.files ?? [])
    names.set(fileId(file.path), plain(fileTitle(file.path)));
  for (const channel of world.slack?.channels ?? [])
    for (const message of channel.messages) {
      const person = world.slack?.users.find((user) => user.id === message.user);
      const who = person?.real_name ?? message.username ?? "someone";
      names.set(`slack:${channel.id}-${message.ts}`, `${who}'s message`);
    }
  const threads = new Map((world.oriel?.threads ?? []).map((t) => [t.id, t]));
  for (const thread of threads.values()) {
    names.set(thread.id, `[${thread.name}](${threadLink(thread.id)})`);
    names.set(thread.workstream.id, thread.workstream.name);
  }
  for (const set of world.oriel?.changeSets ?? [])
    names.set(
      set.id,
      `[${threads.get(set.thread)?.name ?? "change set"}](${changeSetLink(set.thread, set.id)})`,
    );
  return (id) => names.get(id) ?? null;
}

const reference = /\[\[\s*([^\][\s]+)\s*\]\]/g;
const threadAddress = /\/threads\/([0-9A-Za-z]+)(?:\?changeSet=([0-9A-Za-z]+))?/g;

export function shown(reply: string, resolve: (id: string) => string | null): Shown {
  const unresolved: string[] = [];
  let refs = 0;
  const text = reply.replace(reference, (_, id: string) => {
    refs++;
    const name = resolve(id);
    if (name === null) unresolved.push(id);
    return name ?? `[[?${id}]]`;
  });
  // Links the agent wrote itself, as today's prompt teaches.
  for (const [, thread, set] of reply.matchAll(threadAddress)) {
    refs++;
    for (const id of [thread, set])
      if (id !== undefined && resolve(id) === null) unresolved.push(id);
  }
  return { text, refs, unresolved };
}
