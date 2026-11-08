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
// - sheets: packages/sheets-mcp, our own server, in its fixture mode on its
//   shipped `fixture/backlog.json`, as a process of its own, since Oriel
//   never imports it; the sync reads the Backlog tab, the reads are every
//   item it listed, and `preview.json` is a preview with nothing picked.
//   Then, on the evals' Sheets fixture (fixtures/sheets/) as sheets-mcp
//   serves it, each cell as it shows with its note, the rows and columns
//   hidden by hand and the comments, `world.json`: a sync of what the
//   fixture's connection picks, and the previews of the spreadsheets the
//   draft cases wait on, which the eval world reads through the server.
//
// By default it records the kind's stand-in (`@oriel/<kind>/standin`, its
// fixture world in memory), in this process. With `--through codex --server
// <name>` it records the real server as the person's own Codex lists it
// under <name>, through its app server's `mcpServer/tool/call`, with no
// model and only that server's read tools; with `--through claude-code`,
// as their Claude Code lists it, a turn of its smallest model a call. Point
// it at our test site or workspace, never a person's data: Jira reads SYN.
// A real server's recordings are `real-sync.json` and `real-read.json`,
// beside the stand-in's. People are replaced with numbered placeholders
// (packages/jira/src/recorded.ts). Nothing is written.
// Usage: node scripts/record-source-mcp.ts <jira|slack|linear|sheets> [--through <codex|claude-code> --server <name>] [--channels <a,b>]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  checkClaudeCode,
  checkCodex,
  claudeCodeServerCalls,
  claudeCodeServers,
  codexServerCalls,
} from "../packages/agent/src/index.ts";
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
import {
  standInCaller as atlassianCaller,
  standInCloudId,
} from "../packages/jira/src/atlassian-standin.ts";
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
import { callsDir as sheetsCalls } from "../packages/sheets/src/calls.ts";
import { openSheets } from "../packages/sheets/src/open-connection.ts";
import { sheetsPreview } from "../packages/sheets/src/preview.ts";
import { sheetsMcpMain, sheetsServer } from "../packages/sheets/src/sheets-mcp.ts";
import { recordedReads, scrub as scrubJira } from "../packages/jira/src/recorded.ts";
import { stdioCalls } from "./stdio-mcp.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { columnLetters } from "../packages/sheets/src/a1.ts";
import { fixturePicks } from "../packages/sheets/src/declared-fixture.ts";
import {
  gridOf,
  loadSheetsFixture,
  type SheetsFixture,
  shown,
} from "../packages/sheets/src/fixture.ts";

// An Atlassian answer scrubbed as Jira's are, with the site's cloud ID as
// the stand-in's, and without the call's context the server adds to its
// structured content, which names the account.
export function scrubAtlassian(value: unknown, people = new Map<string, string>()): unknown {
  const cloud = (each: unknown): unknown =>
    typeof each === "string"
      ? each.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (id) =>
          id === standInCloudId ? id : standInCloudId,
        )
      : Array.isArray(each)
        ? each.map(cloud)
        : typeof each === "object" && each !== null
          ? Object.fromEntries(
              Object.entries(each)
                .filter(([key]) => key !== "context")
                .map(([key, item]) => [key, cloud(item)]),
            )
          : each;
  return scrubJira(cloud(value), people);
}

// A Slack answer with its people as numbered placeholders, their IDs and
// the names and contact details of their profiles, and the workspace's
// address as a placeholder's: none of our test workspace is in the repo.
export function scrubSlack(value: unknown, people = new Map<string, string>()): unknown {
  const placeholder = (key: string, make: (n: number) => string) => {
    const made = people.get(key) ?? make(people.size + 1);
    people.set(key, made);
    return made;
  };
  if (typeof value === "string") {
    // Slack's server answers in Markdown: a person's name stands beside their
    // ID, as "Name <email> (U0…)", "<@U0…|Name>" or a profile's lines, so
    // each name it gives is replaced wherever it appears, longest first.
    const names = new Set<string>();
    for (const [, name] of value.matchAll(
      /(?:Message from |From: )(.+?)(?: <[^>\n]*>)? \([UWB][A-Z0-9]{2,}\)/g,
    ))
      if (name) names.add(name);
    for (const [, name] of value.matchAll(/<@[UW][A-Z0-9]+\|([^>]+)>/g)) if (name) names.add(name);
    for (const [, name] of value.matchAll(/^Creator: (.+?) \(<@/gm)) if (name) names.add(name);
    for (const [, name] of value.matchAll(/^(?:Display Name|Real Name|Username): (.+)$/gm))
      if (name?.trim()) names.add(name.trim());
    // Each name earlier answers gave, and each word of one, as a message
    // may name someone by their first name alone.
    for (const key of people.keys()) if (key.startsWith("name:")) names.add(key.slice(5));
    let scrubbed = value.replace(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g,
      "person@example.com",
    );
    for (const name of [...names].toSorted((a, b) => b.length - a.length))
      scrubbed = scrubbed.replaceAll(
        name,
        placeholder(`name:${name}`, (n) => `Person ${n}`),
      );
    for (const name of names)
      for (const word of name.split(/\s+/))
        if (word.length >= 3 && !/^(Person|[0-9]+)$/.test(word))
          scrubbed = scrubbed.replace(
            new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
            "Person",
          );
    return scrubbed
      .replace(/^(Organization Name|Phone|Timezone|Title|Pronouns): .*$/gm, "$1: ")
      .replace(/\b[UW][A-Z0-9]{8,}\b/g, (id) =>
        placeholder(id, (n) => `U0PERSON${String(n).padStart(3, "0")}`),
      )
      .replace(/https:\/\/[a-z0-9-]+(\.enterprise)?\.slack\.com/g, "https://oriel-test.slack.com")
      .replace(/https:\\\/\\\/[a-z0-9-]+\.slack\.com/g, "https:\\/\\/oriel-test.slack.com");
  }
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
      // A person as an object: its name and contact, whatever beside them.
      if (
        ["assignee", "lead", "creator", "createdBy"].includes(key) &&
        typeof each === "object" &&
        each !== null &&
        !Array.isArray(each)
      )
        return [
          key,
          Object.fromEntries(
            Object.entries(each).map(([field, value]) =>
              ["name", "displayName"].includes(field) && typeof value === "string"
                ? [field, placeholder(`name:${value}`)]
                : field === "email"
                  ? [field, ""]
                  : [field, scrubLinear(value, people)],
            ),
          ),
        ];
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
  // In this process, or a process of its own, which is stopped once done.
  standIn: () => ToolCaller | Promise<{ call: ToolCaller; close(): void }>;
  standInLine: string;
  realLine: (version: string) => string;
  scrub: (value: unknown, people: Map<string, string>) => unknown;
  // Where its parser reads only an answer's text: its structured content,
  // which some agents pass on, isn't kept.
  textOnly?: true;
  // Through the real server, where `real`.
  connection: (
    channels: readonly string[] | null,
    real: boolean,
  ) => Omit<ToOpen, "id" | "number" | "secret">;
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
  // What `preview.json` previews, where the kind previews its source for
  // the options the person sets through it.
  preview?: (connection: ToOpen, via: OpenVia) => Promise<unknown>;
};

// The Backlog tab of sheets-mcp's shipped fixture, as a person maps it.
export const backlogPicks = {
  spreadsheets: [
    {
      id: "1q2w3e4r5t6y7u8i9o0pBacklogFixture",
      tabs: [
        {
          sheetId: 0,
          header: 1,
          end: "blank",
          hidden: false,
          key: "Key",
          title: "Title",
          status: "Status",
          states: { todo: ["To do"], "in-progress": ["In progress"], done: ["Done"] },
          assignee: "Owner",
          estimate: "Estimate",
        },
      ],
    },
  ],
};

const kinds: Record<string, Kind> = {
  jira: {
    server: atlassianServer,
    dir: jiraCalls,
    standIn: () => atlassianCaller(),
    standInLine:
      "From the stand-in (@oriel/jira/standin, SYN in memory), not Atlassian's server: re-record with --through codex.",
    realLine: (version) =>
      `From Atlassian's Rovo MCP server, through ${version}, on our test site's SYN.`,
    scrub: scrubAtlassian,
    textOnly: true,
    // The real site's SYN, which scripts/seed-jira.ts seeds from the
    // fixture: never another project there.
    connection: (_, real) => ({
      prefix: "jira",
      identity: "",
      options: real ? { project: "SYN" } : {},
    }),
    open: openJira as Kind["open"],
    reads: () => recordedReads(loadJiraFixture()),
  },
  slack: {
    server: slackServer,
    dir: slackCalls,
    standIn: () => slackCaller(),
    standInLine:
      "From the stand-in (@oriel/slack/standin, Ferrowick in memory), not Slack's server: re-record with --through codex.",
    realLine: (version) => `From Slack's MCP server, through ${version}, in our test workspace.`,
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
    realLine: (version) => `From Linear's MCP server, through ${version}, in our test workspace.`,
    scrub: scrubLinear,
    connection: () => ({ prefix: "linear", identity: "", options: {} }),
    open: openLinear as Kind["open"],
    reads: (listed) => listed.map((record) => record.id),
  },
  sheets: {
    server: sheetsServer,
    dir: sheetsCalls,
    standIn: () =>
      stdioCalls("node", [
        sheetsMcpMain,
        "--fixture",
        new URL("../packages/sheets-mcp/fixture/backlog.json", import.meta.url).pathname,
      ]),
    standInLine:
      "From packages/sheets-mcp in its fixture mode, on its shipped fixture/backlog.json: no Google account. Re-record with --through codex.",
    realLine: (version) =>
      `From packages/sheets-mcp signed in to Google, through ${version}, on our test account's spreadsheets.`,
    // Our own server's answers hold nothing of a person but cell text,
    // which the test account's spreadsheets make up.
    scrub: (value) => value,
    connection: () => ({ prefix: "sheets", identity: "", options: backlogPicks }),
    open: openSheets as Kind["open"],
    reads: (listed) => listed.map((record) => record.id),
    preview: (connection, via) => sheetsPreview({ ...connection, options: {} }, via),
  },
};

// A tool's answer scrubbed, in its JSON text.
function scrubbed(answer: ToolAnswer, kind: Kind, people: Map<string, string>): ToolAnswer {
  const { structuredContent, ...rest } = answer;
  return {
    ...rest,
    content: answer.content.map((block) => {
      if (typeof block !== "object" || block === null || !("text" in block)) return block;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(block.text));
      } catch {
        // Prose can't be scrubbed by its fields: check it by hand.
        throw new Error("an answer isn't JSON, so Oriel can't scrub it: nothing was written");
      }
      return { ...block, text: JSON.stringify(kind.scrub(parsed, people)) };
    }),
    ...(structuredContent === undefined || kind.textOnly
      ? {}
      : { structuredContent: kind.scrub(structuredContent, people) }),
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
            answer: scrubbed(answer as ToolAnswer, kind, people),
          }))
        : calls,
    };
    // A real server's recording sits beside the stand-in's, which the
    // tests compare with the fixture.
    const named = scrubbing ? `real-${name}` : name;
    writeFileSync(new URL(named, kind.dir), `${JSON.stringify(file, null, 2)}\n`);
    console.log(`${named}: ${calls.length} calls`);
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
        ...kind.connection(channels, scrubbing),
      },
      {
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

  if (!kind.preview) return;
  const previewed: RecordedCall[] = [];
  await kind.preview(
    {
      id: "01JRECORDING00000000000000" as never,
      number: 1,
      ...kind.connection(channels, scrubbing),
    },
    {
      log: () => {},
      now: () => "2026-11-07T00:00:00.000Z" as never,
      server: {
        known: server,
        found: {
          name: server.reports,
          status: "connected",
          reports: server.reports,
          url: null,
          command: null,
          tools: [...server.reads, ...server.writes],
        },
        read: recordingCalls(read, previewed),
        write: refuse,
      },
    },
  );
  save("preview.json", previewed);
}

// The evals' Sheets fixture as sheets-mcp's fixture mode reads it: each
// cell as it shows, with its note, the rows and columns hidden by hand, and
// the comments, each resolved when its last reply's action resolved it. No
// merges or filters, which its tools don't give.
export function sheetsMcpFixture(fixture: SheetsFixture) {
  return {
    spreadsheets: fixture.spreadsheets.map((spreadsheet) => ({
      id: spreadsheet.id,
      name: spreadsheet.title,
      modifiedTime: spreadsheet.modifiedTime,
      canEdit: spreadsheet.canEdit,
      tabs: spreadsheet.tabs.map((tab) => {
        const grid = gridOf(tab);
        const notes = Object.fromEntries(
          tab.rows.flatMap((row, r) =>
            row.flatMap((cell, c) =>
              cell !== null && typeof cell === "object" && cell.note !== undefined
                ? [[`${columnLetters(c)}${r + 1}`, cell.note]]
                : [],
            ),
          ),
        );
        return {
          sheetId: tab.sheetId,
          title: tab.title,
          ...(tab.frozenRows ? { frozenRows: tab.frozenRows } : {}),
          rowCount: grid.rows,
          columnCount: grid.columns,
          rows: tab.rows.map((row) => row.map((cell) => shown(cell))),
          ...(Object.keys(notes).length ? { notes } : {}),
          ...(tab.hiddenRows?.length ? { hiddenRows: tab.hiddenRows } : {}),
          ...(tab.hiddenColumns?.length ? { hiddenColumns: tab.hiddenColumns } : {}),
        };
      }),
      comments: spreadsheet.comments.map((comment) => {
        const actions = (comment.replies ?? []).flatMap((r) => (r.action ? [r.action] : []));
        return {
          author: comment.author,
          content: comment.content,
          createdTime: comment.createdTime,
          ...(comment.deleted ? { deleted: true } : {}),
          resolved: actions.at(-1) === "resolve",
          ...(comment.quoted ? { quoted: comment.quoted } : {}),
          replies: (comment.replies ?? []).map((reply) => ({
            author: reply.author,
            content: reply.content,
            createdTime: reply.createdTime,
          })),
        };
      }),
    })),
  };
}

// The draft cases' spreadsheets, each waiting with nothing mapped.
export const draftWaits = [
  "1FwTrackerFixture000000000000000000000000000",
  "1FwRaidFixture000000000000000000000000000000",
];

async function recordSheetsWorld() {
  const fixture = loadSheetsFixture();
  const file = join(mkdtempSync(join(tmpdir(), "oriel-sheets-world-")), "world.json");
  writeFileSync(file, JSON.stringify(sheetsMcpFixture(fixture)));
  const server = await stdioCalls("node", [sheetsMcpMain, "--fixture", file]);
  const calls: RecordedCall[] = [];
  const via = (read: ToolCaller): OpenVia => ({
    log: () => {},
    now: () => "2026-11-07T00:00:00.000Z" as never,
    server: {
      known: sheetsServer,
      found: {
        name: "sheets-mcp",
        status: "connected",
        reports: "sheets-mcp",
        url: null,
        command: null,
        tools: [...sheetsServer.reads, ...sheetsServer.writes],
      },
      read,
      write: async () => {
        throw new Error("the recording writes nothing");
      },
    },
  });
  const connection = (options: Record<string, unknown>): ToOpen => ({
    id: "01JRECORDING00000000000000" as never,
    number: 1,
    prefix: "sheets",
    identity: "",
    options,
  });
  try {
    const read = recordingCalls(server.call, calls);
    const opened = await openSheets(connection(fixturePicks(fixture)), via(read));
    for await (const _ of opened.source.sync(null));
    for (const id of draftWaits)
      await sheetsPreview(connection({ spreadsheets: [{ id, tabs: [] }] }), via(read));
  } finally {
    server.close();
  }
  writeFileSync(
    new URL("world.json", sheetsCalls),
    `${JSON.stringify(
      {
        recorded:
          "From packages/sheets-mcp in its fixture mode, on fixtures/sheets/ as it serves it (scripts/record-source-mcp.ts): each cell as it shows, with its note, the rows and columns hidden by hand and the comments, no merges, and each answer's structured content alone.",
        // Each answer's structured content alone, which the parser reads
        // first, so the cells aren't kept twice.
        calls: calls.map(({ call, answer }) => {
          const { structuredContent } = answer as ToolAnswer;
          return structuredContent === undefined
            ? { call, answer }
            : { call, answer: { ...(answer as ToolAnswer), content: [], structuredContent } };
        }),
      },
      null,
      1,
    )}\n`,
  );
  console.log(`world.json: ${calls.length} calls`);
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
      "Usage: node scripts/record-source-mcp.ts <jira|slack|linear|sheets> [--through <codex|claude-code> --server <name>] [--channels <a,b>]",
    );
    process.exitCode = 2;
  } else if (values.through === undefined) {
    mkdirSync(kind.dir, { recursive: true });
    const standIn = await kind.standIn();
    try {
      await recordCalls(
        kind,
        typeof standIn === "function" ? standIn : standIn.call,
        kind.standInLine,
        false,
      );
    } finally {
      if (typeof standIn !== "function") standIn.close();
    }
    if (kind === kinds.sheets) await recordSheetsWorld();
  } else if (values.through === "codex" && values.server) {
    mkdirSync(kind.dir, { recursive: true });
    const codex = await checkCodex();
    if (!codex.ok) throw new Error(codex.problem.message);
    const at = kind.server.at;
    const calls = codexServerCalls(codex.cli, {
      // A remote one by its URL; a local one by its name in the person's
      // Codex, which starts it as they configured it.
      server:
        at && "url" in at
          ? { name: values.server, url: at.url, transport: "http" }
          : { name: values.server },
      tools: kind.server.reads,
      others: [],
      log: () => {},
    });
    try {
      await recordCalls(
        kind,
        calls.call,
        kind.realLine(`Codex ${codex.cli.version}`),
        true,
        channels,
      );
    } finally {
      calls.close();
    }
  } else if (values.through === "claude-code" && values.server) {
    // The same, through the person's Claude Code, which has no tool call of
    // its own: each call is a turn on its smallest model, allowed only that
    // call (packages/agent/src/server-calls.ts), so it spends a little of
    // their plan. A remote server only.
    mkdirSync(kind.dir, { recursive: true });
    const claude = await checkClaudeCode();
    if (!claude.ok) throw new Error(claude.problem.message);
    const at = kind.server.at;
    if (!at || !("url" in at)) throw new Error("Claude Code records a remote server only");
    const found = (await claudeCodeServers(claude.cli)).find((each) => each.name === values.server);
    if (!found) throw new Error(`Claude Code lists no server named ${values.server}`);
    const calls = claudeCodeServerCalls(claude.cli, {
      server: { name: values.server, url: at.url, transport: found.transport ?? "http" },
      tools: kind.server.reads,
      others: found.tools.filter((tool) => !kind.server.reads.includes(tool)),
      log: () => {},
    });
    try {
      await recordCalls(
        kind,
        calls.call,
        kind.realLine(`Claude Code ${claude.cli.version}`),
        true,
        channels,
      );
    } finally {
      calls.close();
    }
  } else {
    console.error(
      "--through takes codex or claude-code, with --server naming the server in that agent",
    );
    process.exitCode = 2;
  }
}
