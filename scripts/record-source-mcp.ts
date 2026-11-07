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
//   serves it, each cell as it shows, `world.json`: a sync of what the
//   fixture's connection picks, and the previews of the spreadsheets the
//   draft cases wait on, which the eval world reads through the server.
//
// By default it records the kind's stand-in (`@oriel/<kind>/standin`, its
// fixture world in memory), in this process. With `--through codex --server
// <name>` it records the real server as the person's own Codex lists it
// under <name>, through its app server's `mcpServer/tool/call`, with no
// model and only that server's read tools: point it at our test site or
// workspace, never a person's data. People are replaced with numbered
// placeholders, as `pnpm record:jira` does. Nothing is written.
// Usage: node scripts/record-source-mcp.ts <jira|slack|linear|sheets> [--through codex --server <name>] [--channels <a,b>]
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
import { callsDir as sheetsCalls } from "../packages/sheets/src/calls.ts";
import { openSheets } from "../packages/sheets/src/open-connection.ts";
import { sheetsPreview } from "../packages/sheets/src/preview.ts";
import { sheetsMcpMain, sheetsServer } from "../packages/sheets/src/sheets-mcp.ts";
import { recordedReads, scrub as scrubJira } from "./record-jira.ts";
import { stdioCalls } from "./stdio-mcp.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixturePicks } from "../packages/sheets/src/declared-fixture.ts";
import {
  gridOf,
  loadSheetsFixture,
  type SheetsFixture,
  shown,
} from "../packages/sheets/src/fixture.ts";

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
      `From packages/sheets-mcp signed in to Google, through Codex ${version}, on our test account's spreadsheets.`,
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

  if (!kind.preview) return;
  const previewed: RecordedCall[] = [];
  await kind.preview(
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
// cell as it shows, with no notes, comments, merges or hidden rows, which
// its tools don't give.
export function sheetsMcpFixture(fixture: SheetsFixture) {
  return {
    spreadsheets: fixture.spreadsheets.map((spreadsheet) => ({
      id: spreadsheet.id,
      name: spreadsheet.title,
      modifiedTime: spreadsheet.modifiedTime,
      canEdit: spreadsheet.canEdit,
      tabs: spreadsheet.tabs.map((tab) => {
        const grid = gridOf(tab);
        return {
          sheetId: tab.sheetId,
          title: tab.title,
          ...(tab.frozenRows ? { frozenRows: tab.frozenRows } : {}),
          rowCount: grid.rows,
          columnCount: grid.columns,
          rows: tab.rows.map((row) => row.map((cell) => shown(cell))),
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
    kept: false,
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
    secret: null,
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
          "From packages/sheets-mcp in its fixture mode, on fixtures/sheets/ as it serves it (scripts/record-source-mcp.ts): each cell as it shows, with no notes, comments, merges or hidden rows, and each answer's structured content alone.",
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
      "Usage: node scripts/record-source-mcp.ts <jira|slack|linear|sheets> [--through codex --server <name>] [--channels <a,b>]",
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
      await recordCalls(kind, calls.call, kind.realLine(codex.cli.version), true, channels);
    } finally {
      calls.close();
    }
  } else {
    console.error("--through takes codex, with --server naming the server in your Codex");
    process.exitCode = 2;
  }
}
