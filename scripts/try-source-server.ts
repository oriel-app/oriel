// A kind through its source server, end to end on the person's own Claude
// Code or Codex, against packages/standin-mcp's stand-in for its server, in
// dev only (OA-276, OA-277, OA-278). The agent's processes get the stand-in on their
// command line, never in the person's configuration. It looks for the
// person's servers, turns the kind on through the stand-in, syncs its
// fixture into the index, and approves one scripted change set, which
// replays through the server's write tools: for Jira a rename of SYN-10,
// for Slack a reply to Amara's question, for Linear ENG-4 planned into
// cycle 14, for Sheets BL-108 moved on, after mapping the Backlog tab of
// packages/sheets-mcp's shipped fixture, which it runs in fixture mode, as
// a local server Claude Code starts by its command. On Claude Code that spends a
// little of the person's plan on its smallest model; on Codex, none. The
// index is in memory.
// Usage: node scripts/try-source-server.ts <claude-code|codex> [jira|slack|linear|sheets]
import { checkCodex } from "../packages/agent/src/index.ts";
import { rowKey } from "../packages/sheets/src/attrs.ts";
import { backlogPicks } from "./record-source-mcp.ts";
import { models as findModels } from "../packages/server/src/model.ts";
import { scriptedAgent } from "../packages/server/src/scripted-agent.ts";
import { memorySettings } from "../packages/server/src/settings.ts";
import { devStandIns } from "../packages/server/src/standins.ts";
import { json, testApp } from "../packages/server/src/testing.ts";
import type { DiffView, ThreadView } from "../packages/web/src/view.ts";

// BL-108 of sheets-mcp's shipped fixture, as Oriel keys it.
const bl108 = `sheets:${rowKey("1q2w3e4r5t6y7u8i9o0pBacklogFixture", 0, "BL-108")}`;

// What each kind tries: its stand-in, the one write it approves, the items
// the workstream that asks for it holds, and the options it's set to first,
// where they're the person's to set through the server, or the pick it
// lists through the server and sets, as Settings does.
const kinds: Record<
  string,
  {
    standIn: string;
    name: string;
    items: readonly string[];
    write: readonly [string, readonly unknown[]];
    options?: Record<string, unknown>;
    pick?: readonly [string, string | string[]];
  }
> = {
  jira: {
    standIn: "atlassian",
    name: "Jira",
    items: ["jira:SYN-10"],
    write: ["jira.setSummary", ["jira:SYN-10", "Renamed through the stand-in"]],
    pick: ["project", "SYN"],
  },
  slack: {
    standIn: "slack",
    name: "Slack",
    items: ["slack:C0FW1WEATHR-1790071200.000100"],
    write: ["slack.reply", ["slack:C0FW1WEATHR-1790071200.000100", "Replied through the stand-in"]],
    pick: ["channels", ["C0FW1WEATHR"]],
  },
  linear: {
    standIn: "linear",
    name: "Linear",
    items: ["linear:ENG-4"],
    write: ["linear.setCycle", ["linear:ENG-4", 14]],
    pick: ["team", "ENG"],
  },
  sheets: {
    standIn: "sheets",
    name: "Google Sheets",
    items: [bl108],
    write: ["sheets.setField", [bl108, "status", "In progress"]],
    options: backlogPicks,
  },
};

const agent = process.argv[2];
const kind = process.argv[3] ?? "jira";
if ((agent !== "claude-code" && agent !== "codex") || !Object.hasOwn(kinds, kind)) {
  console.error(
    "Usage: node scripts/try-source-server.ts <claude-code|codex> [jira|slack|linear|sheets]",
  );
  process.exit(2);
}
const trying = kinds[kind];
if (!trying) throw new Error(`no kind ${kind}`);
const standIns = devStandIns(trying.standIn);
if (!standIns) throw new Error("no stand-in");
const settings = memorySettings({
  providers: [
    { id: "claude-code", kind: "claude-code", name: "Claude Code", on: agent === "claude-code" },
    { id: "codex", kind: "codex", name: "Codex", on: agent === "codex" },
  ],
});
const models = findModels({ key: null, dev: standIns.dev });
await models.look(settings.get());
if (agent === "codex" && !(await checkCodex()).ok) throw new Error("Codex isn't ready");

const quiet: (() => Promise<void>)[] = [];
const it = await testApp(
  { after: (fn) => quiet.push(fn) },
  {
    connect: {},
    models,
    settings,
    knownServers: standIns.known,
    agent: (deps) => scriptedAgent(deps, () => [{ run: "rename" }]),
    scripts: {
      rename: async () => ({
        value: null,
        writes: [[trying.write[0], [...trying.write[1]]]],
      }),
    },
  },
);
const step = (what: string, started: number) =>
  console.log(`${what} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
try {
  let at = Date.now();
  await it.post("/api/servers/look");
  const servers = (await it.connections()).servers;
  const found = servers.found.find((each) => each.kind === kind);
  if (!found)
    throw new Error(
      `${servers.agent ?? "The agent"} listed no server for ${trying.name}: ${servers.problem ?? ""}`,
    );
  step(`${servers.agent} lists ${found.server}, ${found.known}`, at);

  at = Date.now();
  const on = await it.post("/api/actions/source.on", { kind, server: found.server });
  if (on.status !== 200) throw new Error(`${trying.name} didn't turn on: ${on.status}`);
  await it.app.settled();
  if (trying.options) {
    const waiting = await it.connection(kind);
    const set = await it.post(`/api/connections/${waiting?.id ?? ""}/options`, {
      options: trying.options,
    });
    if (set.status !== 200) throw new Error(`${trying.name}'s options didn't set: ${set.status}`);
    await it.app.settled();
  }
  if (trying.pick) {
    const [field, value] = trying.pick;
    const id = (await it.connection(kind))?.id;
    if (!id) {
      const why = (await it.connections()).servers.kinds.find((each) => each.kind === kind);
      throw new Error(`${trying.name} didn't open: ${why?.problem ?? "no reason given"}`);
    }
    const listed = await it.post(`/api/connections/${id}/pick`, { query: "", field });
    const { choices = [] } = json<{ choices?: { value: string }[] }>(listed);
    if (listed.status !== 200 || !choices.some((each) => [value].flat().includes(each.value))) {
      throw new Error(
        `${trying.name}'s ${field} wasn't listed: ${listed.status} ${JSON.stringify(json(listed))}`,
      );
    }
    const set = await it.post(`/api/connections/${id}/options`, { options: { [field]: value } });
    if (set.status !== 200) throw new Error(`${trying.name}'s ${field} didn't set: ${set.status}`);
    await it.app.settled();
    step(
      `${trying.name} listed ${choices.length} for its ${field}, and read ${JSON.stringify(value)}`,
      at,
    );
  }
  const opened = await it.connection(kind);
  if (!opened) {
    const why = (await it.connections()).servers.kinds.find((each) => each.kind === kind);
    throw new Error(`${trying.name} didn't open: ${why?.problem ?? "no reason given"}`);
  }
  step(
    `${trying.name} on: ${opened.about}, ${opened.items} items, problem ${opened.problem ?? "none"}`,
    at,
  );
  const synced = it.app.telemetry().filter((event) => event.name === "source.server-synced");
  console.log("telemetry:", JSON.stringify(synced.map((event) => event.data)));

  at = Date.now();
  const { id: workstreamId } = json<{ id: string }>(
    await it.post("/api/workstreams", { kind: "picked", name: "Tried", items: [...trying.items] }),
  );
  const { id: threadId } = json<{ id: string }>(
    await it.post(`/api/workstreams/${workstreamId}/threads`, { text: "Try one write" }),
  );
  await it.app.settled();
  const thread = json<ThreadView>(await it.get(`/api/threads/${threadId}`));
  const entry = thread.entries.find((each) => each.kind === "change-set");
  if (entry?.kind !== "change-set") throw new Error("no change set");
  const diff = json<DiffView>(await it.post(`/api/change-sets/${entry.changeSetId}/diff`));
  it.advance(1000);
  const approved = await it.post(`/api/change-sets/${entry.changeSetId}/approve`, {
    hash: diff.hash,
  });
  await it.app.settled();
  const report = json<{ report?: unknown; changeSet?: { state?: string } }>(approved);
  console.log("apply:", JSON.stringify({ state: report.changeSet?.state, report: report.report }));
  const after = await it.connection(kind);
  const item = trying.items[0];
  const row = it.app
    .window("epic")
    .clusters.flatMap((cluster) => cluster.list)
    .find((each) => each.id === item);
  step(
    `approved: ${approved.status}; ${item} reads "${row?.title}"; ${after?.items} items, problem ${after?.problem ?? "none"}`,
    at,
  );
} catch (error) {
  // What went wrong inside, as the app logged it: never a source's content.
  const failed = it.logged.filter((each) => /fail|couldn't|stopped|missed/i.test(each.message));
  for (const each of failed)
    console.error(`logged: ${each.message} ${JSON.stringify(each.fields)}`);
  throw error;
} finally {
  for (const fn of quiet) await fn();
}
process.exit(0);
