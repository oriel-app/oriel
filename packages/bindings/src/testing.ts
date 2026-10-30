// Test helpers: regions, issue types and a reader built from the frozen SYN
// fixtures, and a small guest host that runs the shim under Node and speaks
// the guest protocol, as the sandbox will under Deno.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import {
  type Bindings,
  type CapturedMutation,
  guestMessage,
  type IndexRecord,
  instant,
  type Region,
  type ReadResult,
  type ItemId,
  type Ulid,
  ulid,
} from "@oriel/core";
import { type FixtureSnapshot, fixtureSnapshot, type JiraContent } from "@oriel/jira";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import type { IssueTypes, Reader } from "./describe.ts";
import { guestStart } from "./shim.ts";

export const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";

// Every fixture item's issue type, as the index would give it.
export const issueTypes: IssueTypes = new Map(
  fixture.issues.map((issue) => [`jira:${issue.key}`, issue.issueType]),
);

// The source as the base state left it (0) or after the first `edited` source
// edits.
export const snapshotAfter = (edited: number): FixtureSnapshot =>
  fixtureSnapshot(fixture, site, edited);

const fixedId: Ulid = ulid(0, new Uint8Array(10));

export function fixtureRegion(name: string): Region {
  const frozen = fixture.regions.find((region) => region.name === name);
  if (!frozen) throw new RangeError(`no fixture region ${name}`);
  const stableIds = new Map(fixture.issues.map((issue) => [`jira:${issue.key}`, issue.id]));
  return {
    id: fixedId,
    workspaceId: fixedId,
    items: frozen.items.map((id) => ({ id, stableId: stableIds.get(id) ?? "" })),
    origin: frozen.origin,
    snapshot: 1,
    createdAt: instant(new Date("2026-10-01T00:00:00.000Z")),
  };
}

// The picked fixture region plus one epic, SYN-1, picked by hand: a region
// with an epic but no anchor.
export function pickedWithEpic(): Region {
  const region = fixtureRegion("picked");
  return { ...region, items: [...region.items, { id: "jira:SYN-1", stableId: "10001" }] };
}

// Every term must appear in the item's key or title.
export function fixtureReader(snapshot: FixtureSnapshot): Reader {
  return {
    read: async (ids) =>
      ids.map((id): ReadResult<"jira", JiraContent> => {
        const content = snapshot.content.get(id);
        return content ? { id, status: "ok", content } : { id, status: "gone", reason: "deleted" };
      }),
    search: async (query, limit) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const found: IndexRecord[] = snapshot.records.filter((record) => {
        const haystack = `${record.id} ${record.title}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
      return found.slice(0, limit);
    },
  };
}

// The fixtures never move an item between projects, so this reader does: it
// reports `from` as moved to `to`, and reads `to` as what `from` was.
export function movingReader(reader: Reader, from: ItemId<"jira">, to: ItemId<"jira">): Reader {
  return {
    read: async (ids) => {
      const results = await reader.read(ids.map((id) => (id === to ? from : id)));
      const byId = new Map(results.map((result) => [result.id, result]));
      return ids.map((id): ReadResult<"jira", JiraContent> => {
        if (id === from) return { id, status: "moved", to };
        const result = byId.get(id === to ? from : id);
        if (!result) throw new Error(`no result for ${id}`);
        return { ...result, id };
      });
    },
    search: reader.search,
  };
}

export type GuestRun = {
  mutations: CapturedMutation[];
  // Capture errors, one per rejected write.
  rejected: string[];
  reads: { fn: string; args: unknown[]; outsideRegion: boolean }[];
  logs: string[];
  outcome: { kind: "done"; value: unknown } | { kind: "threw"; message: string } | null;
  stderr: string;
};

// Runs the shim in a Node child with an empty environment, sends the script
// as reply 0, answers reads with `bindings.read` and captures writes with
// `bindings.capture`. A script `guestStart` refuses never starts a child.
export async function runGuest(bindings: Bindings, script: string): Promise<GuestRun> {
  const start = guestStart(script);
  if (!start.ok) throw new Error(start.error.message);
  const child = spawn(
    process.execPath,
    ["--input-type=module-typescript", "--eval", bindings.shim],
    {
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const exited = once(child, "close");
  const run: GuestRun = {
    mutations: [],
    rejected: [],
    reads: [],
    logs: [],
    outcome: null,
    stderr: "",
  };
  child.stderr.setEncoding("utf8").on("data", (text: string) => (run.stderr += text));
  // A reply can lose the race with the guest's exit; that is not a failure.
  child.stdin.on("error", () => {});
  const reply = (line: object) => child.stdin.write(`${JSON.stringify(line)}\n`);
  reply(start.reply);
  const replies: Promise<unknown>[] = [];
  for await (const line of createInterface({ input: child.stdout })) {
    const parsed = guestMessage(JSON.parse(line));
    if (!parsed.ok) throw new Error(`bad guest line: ${line}`);
    const message = parsed.value;
    if (message.kind === "read") {
      const { id, fn, args } = message;
      const answered = bindings.read(fn, args).then(
        ({ value, outsideRegion }) => {
          run.reads.push({ fn, args, outsideRegion });
          reply({ id, ok: true, value });
        },
        (error: Error) => reply({ id, ok: false, error: error.message }),
      );
      replies.push(answered);
      continue;
    }
    if (message.kind === "write") {
      try {
        run.mutations.push(bindings.capture(message.fn, message.args, message.ref));
      } catch (error) {
        run.rejected.push(error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    if (message.kind === "log") run.logs.push(message.text);
    else run.outcome = message;
  }
  await Promise.all(replies);
  await exited;
  return run;
}
