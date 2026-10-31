// The composition root: where the adapters' declarations meet the packages
// that use them. It opens the database, syncs Jira and the connected folder
// into the index, and wires groupings, change sets, bindings, the sandbox and
// the agent into the JSON routes. Only this file builds change sets, which
// hold the writers; thread code gets `capture` and nothing else.
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
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
  type Source,
  type SourceKind,
  type Ulid,
  ulid,
  type Validator,
} from "@oriel/core";
import {
  ensureWorkspace,
  firstWorkspace,
  folderStore,
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
import { folderAttrs, type FolderPath, folderSource, resolveFolder } from "@oriel/folder";
import { createSandbox } from "@oriel/sandbox";
import type { FolderView, GroupingId, WindowView } from "@oriel/web/view";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import type { Agent, ServerAgentDeps, AgentLimits } from "./agent.ts";
import { api } from "./api.ts";
import { fixtureIndex } from "./fixture.ts";
import { devPlan, scriptedAgent } from "./scripted-agent.ts";
import type { Reply, Request } from "./site.ts";
import { turns } from "./turns.ts";
import { views } from "./views.ts";
import { groupings, presentations, windowView } from "./window.ts";

// How change sets reach a Jira site to write: writer config, from which
// @oriel/changeset builds the writer. `fetch` is for tests, which answer
// from memory; the global fetch is used without it.
export type JiraWrites = {
  site: string;
  credential: Credential;
  project: string;
  fetch?: typeof fetch;
};

// Where Jira comes from. The fixture is SYN as `fixtures/jira/` freezes it,
// read-only unless tests give it a site to write to that holds the same
// items. Live is a site, read through the API and written to through
// approved change sets.
export type JiraMode = { kind: "fixture"; writeTo?: JiraWrites } | ({ kind: "live" } & JiraWrites);

export type AppOptions = {
  // A SQLite file, or ":memory:".
  db: string;
  jira: JiraMode;
  // Builds the agent from everything but a model provider: @oriel/agent's,
  // with one, or the scripted dev agent, which is the default.
  agent?: (deps: ServerAgentDeps) => Agent;
  // The sandbox runs go to; Deno, started on the first run, when absent.
  sandbox?: Sandbox;
  // Review links are this URL plus a token.
  reviewBase: URL;
  // The agent's caps; the server holds the per-thread ones whatever the
  // agent does. `limits` below when absent.
  limits?: AgentLimits;
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
          transport: readTransport({
            site: mode.site,
            credential: mode.credential,
            ...(mode.fetch ? { fetch: mode.fetch } : {}),
          }),
          site: mode.site,
          projects: [mode.project],
          log,
        })
      : null;
  if (!source) throw new Error("no Jira source");
  // The fixture is frozen as of its last edit, so its window is built for
  // that instant: the "stuck" rules come out the same on every run.
  const asOf = fixture ? fixtureIndex(fixture).now : null;

  // One sync at a time, of any source, through the generic sync worker.
  let syncing: Promise<unknown> = Promise.resolve();
  const syncInto = <K extends SourceKind, A>(
    from: Source<K, A>,
    attrs: Validator<A>,
    full: boolean,
  ): Promise<unknown> => {
    const run = syncing
      .catch(() => {})
      .then(() => syncSource({ source: from, attrs, index, workspaceId, full, clock: now, log }));
    syncing = run;
    return run;
  };
  const sync = (full: boolean) => syncInto(source, jiraAttrs, full);
  // The first sync of a source into this workspace connects it.
  const connected = (kind: SourceKind) => {
    emit({ name: "source.connected", at: now(), workspaceId, source: kind });
  };
  const connecting = index.source(workspaceId, "jira") === null;
  await sync(fixture !== null || connecting);
  if (connecting) connected("jira");
  const caps = options.limits ?? limits;

  // The folder the user connected, read-only (decision 0019). Its stored path
  // is the real path its pick resolved to, which every walk checks again.
  const folders = folderStore(db);
  const folderFrom = (stored: { id: Ulid; path: string }) => ({
    ...stored,
    source: folderSource({ folderId: stored.id, path: stored.path as FolderPath, log }),
  });
  const stored = folders.get(workspaceId);
  let folder = stored && folderFrom(stored);
  // A folder that can't be read now (an unmounted drive) leaves its items as
  // they were, and says so.
  const syncFolder = async (which = folder): Promise<string | null> => {
    if (!which) return "No folder is connected.";
    try {
      await syncInto(which.source, folderAttrs, true);
      return null;
    } catch (error) {
      log("folder sync failed", { error: error instanceof Error ? error.message : String(error) });
      return "Oriel couldn't read the folder just now. Is it still there?";
    }
  };
  if (folder) await syncFolder();

  const records = (): IndexRecord[] => [
    ...index.records(workspaceId, "jira", jiraAttrs),
    ...index.records(workspaceId, "folder", folderAttrs),
  ];
  const folderView = (): FolderView | null =>
    folder && {
      path: folder.path,
      items: index.records(workspaceId, "folder", folderAttrs).length,
      syncedAt: index.source(workspaceId, "folder")?.syncedAt ?? null,
    };
  const connectFolder = async (
    picked: string,
  ): Promise<{ folder: FolderView } | { problem: string }> => {
    const typed = picked.trim();
    const path = typed === "~" || typed.startsWith("~/") ? join(homedir(), typed.slice(1)) : typed;
    if (!isAbsolute(path)) return { problem: "Type the folder's full path, starting with / or ~." };
    let real: FolderPath;
    try {
      real = await resolveFolder(path);
    } catch (error) {
      const file = error instanceof Error && error.message.includes("isn't a directory");
      return {
        problem: file
          ? "That path is a file, not a folder."
          : "There's no folder Oriel can read at that path.",
      };
    }
    const first = index.source(workspaceId, "folder") === null;
    // The same folder keeps its ID, so none of its items' keys change.
    const id = folder && folder.path === real ? folder.id : newId();
    const chosen = folderFrom({ id, path: real });
    // Only a folder that synced is kept; one that can't be listed leaves the
    // one before as it was. A walk that fails throws before the index sees
    // any of it.
    const problem = await syncFolder(chosen);
    if (problem) return { problem };
    folders.connect(workspaceId, { id, path: real }, now());
    folder = chosen;
    if (first) connected("folder");
    const view = folderView();
    return view ? { folder: view } : { problem: "No folder is connected." };
  };
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
      const files = ids.filter(
        (id): id is ItemId<"folder"> => parseItemId(id)?.source === "folder",
      );
      const results: ReadResult[] = [
        ...(jira.length ? await source.read(jira) : []),
        ...(files.length && folder ? await folder.source.read(files) : []),
      ];
      const read = new Map<string, ReadResult>(results.map((result) => [result.id, result]));
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

  const writes: JiraWrites | null =
    mode.kind === "live"
      ? { site: mode.site, credential: mode.credential, project: mode.project, fetch: mode.fetch }
      : (mode.writeTo ?? null);
  const writerConfig: WriterConfig = writes ? { jira: writes } : {};
  const specs = { jira: jiraSpecs };
  const sets = changeSets({
    db,
    writerConfig,
    readers:
      fixture && !writes
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
  const agentDeps: ServerAgentDeps = {
    sandbox,
    bindingsFor: regionBindings,
    changeSets: { capture: (run, mutations) => sets.capture(run, mutations) },
    runs: { record: (run, reads) => runs.record(run, reads) },
    limits: caps,
    now,
    newId,
  };
  const agent = (options.agent ?? ((deps) => scriptedAgent(deps, devPlan)))(agentDeps);
  const conversation = turns({
    threads,
    groups,
    agent,
    emit,
    caps,
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
    changeSets: sets,
    writable: writes !== null,
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
      refresh: async () => {
        const problems: string[] = [];
        if (mode.kind === "live")
          await sync(false).catch((error: unknown) => {
            log("sync failed", { error: String(error) });
            problems.push("Jira didn't answer, so Oriel couldn't look for new items.");
          });
        const folderProblem = folder ? await syncFolder() : null;
        if (folderProblem) problems.push(folderProblem);
        return problems.length > 0 ? problems.join(" ") : null;
      },
      explain: (conflicts) => explainConflicts(conflicts, specs),
      folder: {
        view: folderView,
        connect: connectFolder,
        sync: async () => {
          const problem = await syncFolder();
          const view = folderView();
          return problem || !view
            ? { problem: problem ?? "No folder is connected." }
            : { folder: view };
        },
      },
      log,
    }),
    settled: () => conversation.settled(),
    telemetry: () => telemetry.list(workspaceId),
    // Stops every turn, waits for the last sync, and closes the database.
    // Closing twice does nothing more.
    async close() {
      if (!db.isOpen) return;
      for (const summary of threads.list(workspaceId, now())) conversation.stop(summary.thread.id);
      await conversation.settled();
      await syncing.catch(() => {});
      if (db.isOpen) db.close();
    },
  };
}
