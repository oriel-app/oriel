// Records what Oriel's Jira sync and reads call of Atlassian's MCP server,
// and its answers, into fixtures/jira-mcp/, which the parser's tests replay
// (OA-276): `sync.json` opens a connection and lists SYN in full, and
// `read.json` reads every frozen region's items.
//
// By default it records the stand-in (`@oriel/jira/standin`, SYN in memory),
// in this process. With `--through codex --server <name>` it records the
// real server as the person's own Codex lists it under <name>, through its
// app server's `mcpServer/tool/call`, with no model and only that server's
// read tools: point it at our test site, never a person's data. People are
// replaced with numbered placeholders and times moved to UTC, as
// `pnpm record:jira` does. Nothing is written to the site.
// Usage: node scripts/record-jira-mcp.ts [--through codex --server <name>]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkCodex, codexServerCalls } from "../packages/agent/src/index.ts";
import type { ToolAnswer, ToolCaller } from "../packages/core/src/index.ts";
import { atlassianServer } from "../packages/jira/src/atlassian.ts";
import { standInCaller } from "../packages/jira/src/atlassian-standin.ts";
import {
  callsDir,
  type RecordedCall,
  recordingCalls,
} from "../packages/jira/src/calls-cassette.ts";
import { loadJiraFixture } from "../packages/jira/src/fixture.ts";
import { openJira } from "../packages/jira/src/open-connection.ts";
import { recordedReads, scrub } from "./record-jira.ts";

// A tool's answer with its people and times scrubbed, in its JSON text.
function scrubbed(answer: ToolAnswer, people: Map<string, string>): ToolAnswer {
  return {
    ...answer,
    content: answer.content.map((block) => {
      if (typeof block !== "object" || block === null || !("text" in block)) return block;
      try {
        return { ...block, text: JSON.stringify(scrub(JSON.parse(String(block.text)), people)) };
      } catch {
        return block;
      }
    }),
    ...(answer.structuredContent === undefined
      ? {}
      : { structuredContent: scrub(answer.structuredContent, people) }),
  };
}

export async function recordCalls(read: ToolCaller, recorded: string, scrubbing: boolean) {
  const people = new Map<string, string>();
  const save = (name: string, calls: RecordedCall[]) => {
    const file = {
      recorded,
      calls: scrubbing
        ? calls.map(({ call, answer }) => ({
            call,
            answer: scrubbed(answer as ToolAnswer, people),
          }))
        : calls,
    };
    writeFileSync(new URL(name, callsDir), `${JSON.stringify(file, null, 2)}\n`);
    console.log(`${name}: ${calls.length} calls`);
  };
  const refuse: ToolCaller = async () => {
    throw new Error("the recording writes nothing");
  };
  const open = (into: RecordedCall[]) =>
    openJira(
      {
        id: "01JRECORDING00000000000000" as never,
        number: 1,
        prefix: "jira",
        identity: "",
        options: {},
        secret: null,
      },
      {
        kept: false,
        log: () => {},
        now: () => "2026-11-07T00:00:00.000Z" as never,
        server: {
          known: atlassianServer,
          found: {
            name: "atlassian",
            status: "connected",
            reports: atlassianServer.reports,
            url: atlassianServer.at && "url" in atlassianServer.at ? atlassianServer.at.url : null,
            command: null,
            tools: [...atlassianServer.reads, ...atlassianServer.writes],
          },
          read: recordingCalls(read, into),
          write: refuse,
        },
      },
    );
  const listing: RecordedCall[] = [];
  const opened = await open(listing);
  let records = 0;
  for await (const page of opened.source.sync(null)) records += page.records.length;
  if (records === 0) throw new Error("SYN has no issues: run pnpm seed:jira first");
  save("sync.json", listing);

  const reads: RecordedCall[] = [];
  await (await open(reads)).source.read(recordedReads(loadJiraFixture()));
  save("read.json", reads);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { through: { type: "string" }, server: { type: "string" } },
  });
  mkdirSync(callsDir, { recursive: true });
  if (values.through === undefined) {
    await recordCalls(
      standInCaller(),
      "From the stand-in (@oriel/jira/standin, SYN in memory), not Atlassian's server: re-record with --through codex.",
      false,
    );
  } else if (values.through === "codex" && values.server) {
    const codex = await checkCodex();
    if (!codex.ok) throw new Error(codex.problem.message);
    const calls = codexServerCalls(codex.cli, {
      server: {
        name: values.server,
        url: atlassianServer.at && "url" in atlassianServer.at ? atlassianServer.at.url : "",
        transport: "http",
      },
      tools: atlassianServer.reads,
      others: [],
      log: () => {},
    });
    try {
      await recordCalls(
        calls.call,
        `From Atlassian's Rovo MCP server, through Codex ${codex.cli.version}, on our test site.`,
        true,
      );
    } finally {
      calls.close();
    }
  } else {
    console.error("Usage: node scripts/record-jira-mcp.ts [--through codex --server <name>]");
    process.exitCode = 2;
  }
}
