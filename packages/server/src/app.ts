// The composition root: where the adapters' declarations meet the packages
// that use them. It opens the database, syncs Jira into the index, and wires
// groupings, change sets, bindings, the sandbox and the agent into the JSON
// routes. Only this file builds change sets, which hold the writers; thread
// code gets `capture` and nothing else.
import { bindingsFor } from "@oriel/bindings";
import { changeSets, explainConflicts, type WriterConfig } from "@oriel/changeset";
import {
  type ChangeSet,
  type Credential,
  type IndexRecord,
  type Instant,
  instant,
  type ItemId,
  type Log,
  parseItemId,
  type Reader,
  type ReadResult,
  type Region,
  type Sandbox,
  type Ulid,
  ulid,
} from "@oriel/core";
import {
  ensureWorkspace,
  firstWorkspace,
  groupStore,
  indexStore,
  loadMigrations,
  migrate,
  open,
  runStore,
  type StoredEvent,
  telemetryStore,
  threadStore,
} from "@oriel/db";
import {
  fixtureFields,
  fixtureSource,
  jiraAttrs,
  jiraNamespace,
  jiraSource,
  jiraSpecs,
  readTransport,
  syncSource,
} from "@oriel/jira";
import { createSandbox } from "@oriel/sandbox";
import type { GroupingId, WindowView } from "@oriel/web/view";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import type { Agent, AgentDeps, AgentLimits } from "./agent.ts";
import { api } from "./api.ts";
import { fixtureIndex } from "./fixture.ts";
import { devPlan, scriptedAgent } from "./scripted-agent.ts";
import type { Reply, Request } from "./site.ts";
import { turns } from "./turns.ts";
import { views } from "./views.ts";
import { groupings, presentations, windowView } from "./window.ts";

// Where Jira comes from. The fixture is SYN as `fixtures/jira/` freezes it,
// read-only. Live is a site, read through the API and written to through
// approved change sets.
export type JiraMode =
  | { kind: "fixture" }
  | { kind: "live"; site: string; credential: Credential; project: string };

export type AppOptions = {
  // A SQLite file, or ":memory:".
  db: string;
  jira: JiraMode;
  // Builds the agent; the scripted dev agent when absent. The model key, from
  // `.env`, is for the model-backed agent's provider; it is never printed.
  agent?: (deps: AgentDeps, modelKey: string | null) => Agent;
  modelKey?: string | null;
  // The sandbox runs go to; Deno, started on the first run, when absent.
  sandbox?: Sandbox;
  // Review links are this URL plus a token.
  reviewBase: URL;
  now?: () => Instant;
  log?: Log;
};

export type App = {
  window(grouping: GroupingId): WindowView;
  api(request: Request, url: URL): Promise<Reply | null>;
  workspaceId: Ulid;
  // Resolves once no turn is running.
  settled(): Promise<void>;
  // The pilot telemetry stored so far, oldest first.
  telemetry(): StoredEvent[];
  close(): Promise<void>;
};

export const limits: AgentLimits = {
  maxTurnsPerThread: 100,
  maxTokensPerThread: 2_000_000,
  run: {
    wallMs: 30_000,
    maxScriptBytes: 16_384,
    maxReads: 50,
    maxMutations: 20,
    maxResultBytes: 65_536,
    maxConsoleBytes: 16_384,
  },
  maxMutationsPerChangeSet: 20,
};

const site = "https://oriel.atlassian.net";

export async function createApp(options: AppOptions): Promise<App> {
  const now = options.now ?? (() => instant(new Date()));
  const newId = () => ulid(Date.parse(now()));
  const log: Log = options.log ?? (() => {});
  const db = open(options.db);
  migrate(db, loadMigrations(), now());
  const workspaceId =
    firstWorkspace(db) ??
    (() => {
      const id = newId();
      ensureWorkspace(db, { id, name: "Oriel" }, now());
      return id;
    })();
  const index = indexStore(db);
  const groups = groupStore(db);
  const threads = threadStore(db);
  const runs = runStore(db);
  const telemetry = telemetryStore(db);
  const emit = (event: Parameters<typeof telemetry.record>[0]) => telemetry.record(event, newId());

  const mode = options.jira;
  const fixture = mode.kind === "fixture" ? loadJiraFixture() : null;
  const source = fixture
    ? fixtureSource(fixture, { site, edited: fixture.edits.length })
    : mode.kind === "live"
      ? jiraSource({
          transport: readTransport({ site: mode.site, credential: mode.credential }),
          site: mode.site,
          projects: [mode.project],
          log,
        })
      : null;
  if (!source) throw new Error("no Jira source");
  // The fixture is frozen as of its last edit, so its window is built for
  // that instant: the "stuck" rules come out the same on every run.
  const asOf = fixture ? fixtureIndex(fixture).now : null;

  // One sync at a time.
  let syncing: Promise<unknown> = Promise.resolve();
  const sync = (full: boolean) => {
    syncing = syncing
      .catch(() => {})
      .then(() =>
        syncSource({ source, attrs: jiraAttrs, index, workspaceId, full, clock: now, log }),
      );
    return syncing;
  };
  await sync(fixture !== null || index.source(workspaceId, "jira") === null);

  const records = (): IndexRecord[] => index.records(workspaceId, "jira", jiraAttrs);
  const people = () => {
    const names = new Map<string, string>();
    for (const record of records())
      for (const person of record.facets.people ?? []) names.set(person.id, person.name);
    return names;
  };

  // Reads go to each item's own source; search to the index (the escape hatch).
  const reader: Reader = {
    async read(ids) {
      const jira = ids.filter((id): id is ItemId<"jira"> => parseItemId(id)?.source === "jira");
      const read = new Map<string, ReadResult>(
        (await source.read(jira)).map((result) => [result.id, result]),
      );
      return ids.map((id) => read.get(id) ?? { id, status: "gone", reason: "forbidden" as const });
    },
    async search(query, limit) {
      return index.search(workspaceId, query, limit).map((record) => ({
        id: record.id,
        title: record.title,
        location: record.location,
        updatedAt: record.updatedAt,
      }));
    },
  };
  const regionBindings = (region: Region) => {
    const kinds = new Map(records().map((record) => [record.id, record.facets.kind]));
    return bindingsFor(region, { reader, namespaces: { jira: jiraNamespace(kinds) } });
  };

  const writerConfig: WriterConfig =
    mode.kind === "live"
      ? { jira: { site: mode.site, credential: mode.credential, project: mode.project } }
      : {};
  const specs = { jira: jiraSpecs };
  const sets = changeSets({
    db,
    writerConfig,
    readers: fixture
      ? { jira: fixtureFields(fixture, { site, edited: fixture.edits.length }) }
      : {},
    people: { jira: async (id) => people().get(id) ?? null },
    specs,
    reviewBase: options.reviewBase,
    now,
    emit,
    log,
  });

  let deno: Sandbox | null = null;
  const sandbox: Sandbox = options.sandbox ?? {
    run: (script, bindings, runOptions) => {
      deno ??= createSandbox();
      return deno.run(script, bindings, runOptions);
    },
  };
  const agentDeps: AgentDeps = {
    sandbox,
    bindingsFor: regionBindings,
    changeSets: { capture: (run, mutations) => sets.capture(run, mutations) },
    runs: { record: (run, reads) => runs.record(run, reads) },
    limits,

    now,
    newId,
  };
  const agent = (options.agent ?? ((deps) => scriptedAgent(deps, devPlan)))(
    agentDeps,
    options.modelKey ?? null,
  );
  const conversation = turns({
    threads,
    groups,
    agent,
    emit,
    snapshot: () => index.snapshot(workspaceId),
    now,
    newId,
    log,
  });
  const viewer = views({
    groups,
    threads,
    records,
    presentations,
    asOf: () => asOf ?? now(),
    now,
    running: conversation.running,
    writable: mode.kind === "live",
  });

  // What a change set created joins its thread's group, so later turns can
  // work on it (decision 0018); the group's working threads follow. A live
  // index syncs, so the window shows what landed.
  const applied = async (set: ChangeSet) => {
    const thread = threads.get(set.threadId, now());
    if (thread) {
      const created = set.mutations.flatMap((m) =>
        m.target === null && m.applied ? [m.applied.item] : [],
      );
      const at = now();
      const change = created.length
        ? groups.add(thread.groupId, created, { kind: "change-set", changeSetId: set.id }, at)
        : null;
      for (const member of change?.added ?? [])
        emit({
          name: "group.item-added",
          at,
          workspaceId,
          groupId: thread.groupId,
          source: parseItemId(member.id)?.source ?? "jira",
          cause: "change-set",
        });
      if (change) conversation.moved(threads.follow(thread.groupId, at, newId));
    }
    if (mode.kind === "live")
      await sync(false).catch((error: unknown) => log("sync failed", { error: String(error) }));
  };

  const window = (grouping: GroupingId) =>
    windowView(grouping, groupings[grouping], records(), asOf ?? now(), fixture !== null);

  return {
    workspaceId,
    window,
    api: api({
      workspaceId,
      groups,
      threads,
      records,
      clusters: (grouping) => groupings[grouping].group(records(), asOf ?? now()),
      changeSets: sets,
      turns: conversation,
      views: viewer,
      emit,
      now,
      newId,
      applied,
      explain: (conflicts) => explainConflicts(conflicts, specs),
      log,
    }),
    settled: () => conversation.settled(),
    telemetry: () => telemetry.list(workspaceId),
    async close() {
      for (const summary of threads.list(workspaceId, now())) conversation.stop(summary.thread.id);
      await conversation.settled();
      await syncing.catch(() => {});
      db.close();
    },
  };
}
