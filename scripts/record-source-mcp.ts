// Records what Oriel's sync and reads of one kind call of its source server,
// and the server's answers, into fixtures/<kind>-mcp/, which the parser's
// tests replay (OA-276, OA-277): `sync.json` opens a connection and lists it
// in full, and `read.json` reads its items one by one.
//
// - jira: Atlassian's server, on SYN; the reads are every frozen region's
//   items.
// - slack: Slack's server, in the channels the fixture picked, or, through
//   the real server, those `--channels` names; the reads are every message
//   the sync listed.
// - linear: Linear's server, on the first team it lists, ENG in the
//   fixture; the reads are every item the sync listed.
//
// By default it records the kind's stand-in (`@oriel/<kind>/standin`, its
// fixture world in memory), in this process. With `--through codex --server
// <name>` it records the real server as the person's own Codex lists it
// under <name>, through its app server's `mcpServer/tool/call`, with no
// model and only that server's read tools: point it at our test site or
// workspace, never a person's data. People are replaced with numbered
// placeholders, as `pnpm record:jira` does. Nothing is written.
// Usage: node scripts/record-source-mcp.ts <jira|slack|linear> [--through codex --server <name>] [--channels <a,b>]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkCodex, codexServerCalls } from "../packages/agent/src/index.ts";
import {
  type IndexRecord,
  type RecordedCall,
  recordingCalls,
  type SourceServer,
  type ToolAnswer,
  type ToolCaller,
  type ToOpen,
  type OpenVia,
} from "../packages/core/src/index.ts";
import { atlassianServer } from "../packages/jira/src/atlassian.ts";
import { standInCaller as atlassianCaller } from "../packages/jira/src/atlassian-standin.ts";
import { callsDir as jiraCalls } from "../packages/jira/src/calls-cassette.ts";
import { loadJiraFixture } from "../packages/jira/src/fixture.ts";
import { callsDir as linearCalls } from "../packages/linear/src/calls.ts";
import { linearServer } from "../packages/linear/src/linear-mcp.ts";
import { standInCaller as linearCaller } from "../packages/linear/src/linear-standin.ts";
import { openLinear } from "../packages/linear/src/open-connection.ts";
import { openJira } from "../packages/jira/src/open-connection.ts";
import { callsDir as slackCalls } from "../packages/slack/src/calls-cassette.ts";
import { loadSlackFixture } from "../packages/slack/src/fixture.ts";
import { openSlack } from "../packages/slack/src/open-connection.ts";
import { slackServer } from "../packages/slack/src/slack-mcp.ts";
import { standInCaller as slackCaller } from "../packages/slack/src/slack-standin.ts";
import { recordedReads, scrub as scrubJira } from "./record-jira.ts";

// A Slack answer with its people as numbered placeholders, their IDs and
// the names and contact details of their profiles, and the workspace's
// address as a placeholder's: none of our test workspace is in the repo.
export function scrubSlack(value: unknown, people = new Map<string, string>()): unknown {
  const placeholder = (key: string, make: (n: number) => string) => {
    const made = people.get(key) ?? make(people.size + 1);
    people.set(key, made);
    return made;
  };
  if (typeof value === "string")
    return value
      .replace(/\b[UW][A-Z0-9]{8,}\b/g, (id) =>
        placeholder(id, (n) => `U0PERSON${String(n).padStart(3, "0")}`),
      )
      .replace(/https:\/\/[a-z0-9-]+(\.enterprise)?\.slack\.com/g, "https://oriel-test.slack.com");
  if (Array.isArray(value)) return value.map((item) => scrubSlack(item, people));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => {
      if (/^(real|display)_name(_normalized)?$/.test(key) && typeof each === "string")
        return [key, placeholder(`name:${each}`, (n) => `Person ${n}`)];
      if (["email", "phone", "skype"].includes(key) || key.startsWith("image_")) return [key, ""];
      return [key, scrubSlack(each, people)];
    }),
  );
}

// A Linear answer with its people as numbered placeholders, by their names
// and email addresses wherever they appear, and its workspace's address as
// a placeholder's: none of our test workspace is in the repo.
export function scrubLinear(value: unknown, people = new Map<string, string>()): unknown {
  const placeholder = (key: string) => {
    const made = people.get(key) ?? `Person ${people.size + 1}`;
    people.set(key, made);
    return made;
  };
  if (typeof value === "string")
    return value.replace(/https:\/\/linear\.app\/[a-z0-9-]+/g, "https://linear.app/oriel-test");
  if (Array.isArray(value)) return value.map((item) => scrubLinear(item, people));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => {
      if (["assignee", "lead", "creator", "createdBy", "name", "displayName"].includes(key)) {
        // A person's name, where the object or the field is a person's.
        const person =
          key !== "name" ||
          ("email" in value && typeof (value as Record<string, unknown>).email === "string");
        if (typeof each === "string" && person) return [key, placeholder(`name:${each}`)];
      }
      if (key === "email" && typeof each === "string") return [key, ""];
      return [key, scrubLinear(each, people)];
    }),
  );
}

type Kind = {
  server: SourceServer;
  dir: URL;
  standIn: () => ToolCaller;
  standInLine: string;
  realLine: (version: string) => string;
  scrub: (value: unknown, people: Map<string, string>) => unknown;
  connection: (channels: readonly string[] | null) => Omit<ToOpen, "id" | "number" | "secret">;
  open: (
    connection: ToOpen,
    via: OpenVia,
  ) => Promise<{
    source: {
      sync(cursor: null): AsyncIterable<{ records: readonly IndexRecord[] }>;
      read(ids: never[]): Promise<unknown>;
    };
  }>;
  // What `read.json` reads, given what the sync listed.
  reads: (listed: readonly IndexRecord[]) => readonly string[];
};

const kinds: Record<string, Kind> = {
  jira: {
    server: atlassianServer,
    dir: jiraCalls,
    standIn: () => atlassianCaller(),
    standInLine:
      "From the stand-in (@oriel/jira/standin, SYN in memory), not Atlassian's server: re-record with --through codex.",
    realLine: (version) =>
      `From Atlassian's Rovo MCP server, through Codex ${version}, on our test site.`,
    scrub: scrubJira,
    connection: () => ({ prefix: "jira", identity: "", options: {} }),
    open: openJira as Kind["open"],
    reads: () => recordedReads(loadJiraFixture()),
  },
  slack: {
    server: slackServer,
    dir: slackCalls,
    standIn: () => slackCaller(),
    standInLine:
      "From the stand-in (@oriel/slack/standin, Ferrowick in memory), not Slack's server: re-record with --through codex.",
    realLine: (version) =>
      `From Slack's MCP server, through Codex ${version}, in our test workspace.`,
    scrub: scrubSlack,
    connection: (channels) => {
      const fixture = loadSlackFixture();
      return {
        prefix: "slack",
        identity: channels ? "" : fixture.team.url,
        options: { channels: channels ?? fixture.picked },
      };
    },
    open: openSlack as Kind["open"],
    reads: (listed) => listed.map((record) => record.id),
  },
  linear: {
    server: linearServer,
    dir: linearCalls,
    standIn: () => linearCaller(),
    standInLine:
      "From the stand-in (@oriel/linear/standin, Ferrowick's Linear in memory), not Linear's server: re-record with --through codex.",
    realLine: (version) =>
      `From Linear's MCP server, through Codex ${version}, in our test workspace.`,
    scrub: scrubLinear,
    connection: () => ({ prefix: "linear", identity: "", options: {} }),
    open: openLinear as Kind["open"],
    reads: (listed) => listed.map((record) => record.id),
  },
};

// A tool's answer scrubbed, in its JSON text.
function scrubbed(
  answer: ToolAnswer,
  scrub: Kind["scrub"],
  people: Map<string, string>,
): ToolAnswer {
  return {
    ...answer,
    content: answer.content.map((block) => {
      if (typeof block !== "object" || block === null || !("text" in block)) return block;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(block.text));
      } catch {
        // Prose can't be scrubbed by its fields: check it by hand.
        throw new Error("an answer isn't JSON, so Oriel can't scrub it: nothing was written");
      }
      return { ...block, text: JSON.stringify(scrub(parsed, people)) };
    }),
    ...(answer.structuredContent === undefined
      ? {}
      : { structuredContent: scrub(answer.structuredContent, people) }),
  };
}

export async function recordCalls(
  kind: Kind,
  read: ToolCaller,
  recorded: string,
  scrubbing: boolean,
  channels: readonly string[] | null = null,
) {
  const people = new Map<string, string>();
  const save = (name: string, calls: RecordedCall[]) => {
    const file = {
      recorded,
      calls: scrubbing
        ? calls.map(({ call, answer }) => ({
            call: { tool: call.tool, args: kind.scrub(call.args, people) as typeof call.args },
            answer: scrubbed(answer as ToolAnswer, kind.scrub, people),
          }))
        : calls,
    };
    writeFileSync(new URL(name, kind.dir), `${JSON.stringify(file, null, 2)}\n`);
    console.log(`${name}: ${calls.length} calls`);
  };
  const refuse: ToolCaller = async () => {
    throw new Error("the recording writes nothing");
  };
  const { server } = kind;
  const open = (into: RecordedCall[]) =>
    kind.open(
      {
        id: "01JRECORDING00000000000000" as never,
        number: 1,
        secret: null,
        ...kind.connection(channels),
      },
      {
        kept: false,
        log: () => {},
        now: () => "2026-11-07T00:00:00.000Z" as never,
        server: {
          known: server,
          found: {
            name: server.reports,
            status: "connected",
            reports: server.reports,
            url: server.at && "url" in server.at ? server.at.url : null,
            command: null,
            tools: [...server.reads, ...server.writes],
          },
          read: recordingCalls(read, into),
          write: refuse,
        },
      },
    );
  const listing: RecordedCall[] = [];
  const opened = await open(listing);
  const records: IndexRecord[] = [];
  for await (const page of opened.source.sync(null)) records.push(...page.records);
  if (records.length === 0) throw new Error("the sync listed nothing to record");
  save("sync.json", listing);

  const reads: RecordedCall[] = [];
  await (await open(reads)).source.read(kind.reads(records) as never[]);
  save("read.json", reads);
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      through: { type: "string" },
      server: { type: "string" },
      channels: { type: "string" },
    },
  });
  const kind = kinds[positionals[0] ?? ""];
  const channels = values.channels ? values.channels.split(",").map((name) => name.trim()) : null;
  if (!kind) {
    console.error(
      "Usage: node scripts/record-source-mcp.ts <jira|slack|linear> [--through codex --server <name>] [--channels <a,b>]",
    );
    process.exitCode = 2;
  } else if (values.through === undefined) {
    mkdirSync(kind.dir, { recursive: true });
    await recordCalls(kind, kind.standIn(), kind.standInLine, false);
  } else if (values.through === "codex" && values.server) {
    mkdirSync(kind.dir, { recursive: true });
    const codex = await checkCodex();
    if (!codex.ok) throw new Error(codex.problem.message);
    const calls = codexServerCalls(codex.cli, {
      server: {
        name: values.server,
        url: kind.server.at && "url" in kind.server.at ? kind.server.at.url : "",
        transport: "http",
      },
      tools: kind.server.reads,
      others: [],
      log: () => {},
    });
    try {
      await recordCalls(kind, calls.call, kind.realLine(codex.cli.version), true, channels);
    } finally {
      calls.close();
    }
  } else {
    console.error("--through takes codex, with --server naming the server in your Codex");
    process.exitCode = 2;
  }
}
