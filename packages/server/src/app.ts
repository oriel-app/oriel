// The composition root: where the connectors' declarations meet the packages
// that use them. It opens the database and each connection, through its
// connector's declaration, and syncs, reads, recognizes and builds
// namespaces and writers for every one the same way, with no branch per
// source (decision 0049). It wires groupings, change sets, bindings, the
// sandbox and the agent into the JSON routes. Only this file builds change
// sets, which hold the writers; thread code gets `capture` and nothing else.
import { bindingsFor } from "@oriel/bindings";
import { ChangeSetError, changeSets, explainConflicts } from "@oriel/changeset";
import {
  type ChangeSet,
  type Cluster,
  clusterMembers,
  type FieldReader,
  type IndexRecord,
  type Instant,
  instant,
  isItemId,
  type ItemId,
  type Log,
  maxItems,
  type Opened,
  type OpenVia,
  parseItemId,
  prefixOf,
  type Reader,
  type ReadResult,
  type Region,
  type Shown,
  type Sketch,
  type Sandbox,
  type SourceKind,
  syncSource,
  type ToOpen,
  type Ulid,
  ulid,
  unknown,
} from "@oriel/core";
import {
  type Connection,
  ensureWorkspace,
  firstWorkspace,
  workstreamStore,
  indexStore,
  loadMigrations,
  lastSeen,
  markSeen,
  migrate,
  open,
  prefixesOf,
  runStore,
  type StoredEvent,
  telemetryStore,
  threadStore,
} from "@oriel/db";
import { createSandbox } from "@oriel/sandbox";
import {
  byItemId,
  declarationOf,
  itemDocs,
  namespacesOf,
  recognizerOf,
  sourceKinds,
  sources,
  specs,
} from "@oriel/sources";
import type { GroupingId, JiraView, OverviewView, SourceView, WindowView } from "@oriel/web/view";
import type { KeyCheck, Titler } from "@oriel/agent";
import type { KeyStore } from "./api-key.ts";
import { defaultTheme } from "@oriel/web/themes";
import { type Agent, agentEvent, type ServerAgentDeps, type AgentLimits } from "./agent.ts";
import { ActionError, blankWorkstreamName, dispatcher } from "./actions.ts";
import { api } from "./api.ts";
import { memorySecrets, type Secrets } from "./connection.ts";
import { connectionsOf } from "./connections.ts";
import { flagged, type JiraMode, type SlackMode } from "./modes.ts";
import { followAnchors, nameOf } from "./names.ts";
import { intentsOf, lineUndo } from "./intents.ts";
import { orielReads } from "./oriel-reads.ts";
import { heldBy, overviewItems, overviewView } from "./overview.ts";
import { itemPanels } from "./panel.ts";
import type { Models } from "./model.ts";
import { devPlan, scriptedAgent } from "./scripted-agent.ts";
import {
  memorySettings,
  type SettingsService,
  settingsService,
  type SettingsStore,
} from "./settings.ts";
import { type Notify, notifier } from "./notify.ts";
import { quitGuard, type Working, workingThreads } from "./working.ts";
import { type Setup, type SetupOptions, setupService } from "./setup/setup.ts";
import type { Reply, Request } from "./site.ts";
import { turns } from "./turns.ts";
import { inOverview } from "./window-chat.ts";
import { views } from "./views.ts";
import { browseView, clusterPage, groupings, keepOf, windowView } from "./window.ts";
import { type Opening, windowSources } from "./window-sources.ts";

export type { JiraMode, SlackMode } from "./modes.ts";

export type AppOptions = {
  // A SQLite file, or ":memory:".
  db: string;
  // Holds SQLite's exclusive lock on the file while the app runs, so no
  // second server can open it (decision 0036).
  exclusive?: boolean;
  jira: JiraMode;
  // Where connections keep their secrets, each under the name made from its
  // ID (decision 0049); kept only while the server runs when absent.
  secrets?: Secrets;
  // No Slack when absent.
  slack?: SlackMode;
  // Builds the agent from everything but a model provider: @oriel/agent's,
  // with one, or the scripted dev agent, which is the default.
  agent?: (deps: ServerAgentDeps) => Agent;
  // Writes each thread's title from its first message. Without one, a
  // thread's title is that message, clipped.
  titler?: Titler;
  // The providers Settings picks among, which run the agent and titles when
  // `agent` and `titler` are absent (decision 0041).
  models?: Models;
  // The person's settings; in memory, the defaults, when absent.
  settings?: SettingsStore;
  // The themes window.css has, the default first.
  themes?: readonly string[];
  // Whether the page may set where a CLI is: only behind the desktop app's
  // launch secret, since a path set is a program the server runs.
  cliPaths?: boolean;
  // Where the page may keep an API key: the desktop app's OS secret store.
  keys?: { store: KeyStore; check?: (key: string) => Promise<KeyCheck> };
  // The desktop app's notifications, through its shell (OA-184).
  notify?: Notify;
  // Tells the desktop app's shell how many threads Oriel is working on, so
  // it asks before quitting (decision 0045).
  working?: Working;
  // The system's folder picker, through the desktop app's shell: the
  // folder picked, or null if the person cancelled.
  pickFolder?: (prompt: string) => Promise<string | null>;
  // The desktop app's first run and its commands for the person's CLI
  // (decision 0038). None under `pnpm dev`.
  setup?: SetupOptions;
  // The sandbox runs go to; Deno, started on the first run, when absent.
  sandbox?: Sandbox;
  // Review links are this URL plus a token.
  reviewBase: URL;
  // Sketches are framed from this URL plus `<thread>/<sketch>`, on the
  // sketch origin (decision 0033).
  sketchBase: URL;
  // The agent's caps; the server holds the per-thread ones whatever the
  // agent does. `limits` below when absent.
  limits?: AgentLimits;
  now?: () => Instant;
  log?: Log;
};

export type App = {
  window(grouping: GroupingId): WindowView;
  // The first run, which the desktop app opens on until it has finished.
  setup: Setup;
  // A sketch as its thread stored it, for the sketch origin to serve; null
  // when the thread is gone or never showed it (decision 0033).
  sketch(threadId: Ulid, sketchId: Ulid): Sketch | null;
  // Jira as the window shows it: what's connected, and whether it can be.
  jira(): JiraView;
  api(request: Request, url: URL): Promise<Reply | null>;
  settings: SettingsService;
  workspaceId: Ulid;
  // Resolves once no turn is running, no title is being written and no
  // notification is being looked for.
  settled(): Promise<void>;
  // The pilot telemetry stored so far, oldest first.
  telemetry(): StoredEvent[];
  // Revokes every live review link, and says how many there were.
  revokeReviewLinks(): Promise<number>;
  close(): Promise<void>;
};

// How a change set reads a connection that is live but not open, as one its
// source turned away at the start: it can't be shown until it's connected
// again.
const disconnected = (name: string): FieldReader => ({
  current: async () => {
    throw new ChangeSetError(
      "read-only",
      `${name} isn't connected now, so Oriel can't show this change. Connect ${name} in the window.`,
    );
  },
  name: async () => null,
});

export const limits: AgentLimits = {
  maxTurnsPerThread: 100,
  maxTokensPerThread: 2_000_000,
  run: {
    wallMs: 30_000,
    maxScriptBytes: 16_384,
    maxReads: 50,
    maxMutations: 20,
    maxIntents: 20,
    maxResultBytes: 65_536,
    maxConsoleBytes: 16_384,
  },
  maxMutationsPerChangeSet: 20,
};

export async function createApp(options: AppOptions): Promise<App> {
  const now = options.now ?? (() => instant(new Date()));
  const newId = () => ulid(Date.parse(now()));
  const log: Log = options.log ?? (() => {});
  const db = open(options.db, { exclusive: options.exclusive ?? false });
  migrate(db, loadMigrations(), now());
  const workspaceId =
    firstWorkspace(db) ??
    (() => {
      const id = newId();
      ensureWorkspace(db, { id, name: "Oriel" }, now());
      return id;
    })();
  const index = indexStore(db);
  const workstreams = workstreamStore(db);
  const threads = threadStore(db);
  const runs = runStore(db);
  const telemetry = telemetryStore(db);
  const emit = (event: Parameters<typeof telemetry.record>[0]) => telemetry.record(event, newId());
  const connections = connectionsOf({
    db,
    index,
    secrets: options.secrets ?? memorySecrets(),
    workspaceId,
    now,
    newId,
    log,
  });

  // Every open connection, by its prefix, with what its connector's `open`
  // gave it. The server opens each kind's first live connection, for now:
  // the one a flag makes at start, or one the window made (decision 0049).
  type Open = { connection: Connection; opened: Opened };
  const byPrefix = new Map<string, Open>();
  // In declared order, as the window and a region's module list them.
  const opens = (): Open[] =>
    sourceKinds.flatMap((kind) =>
      [...byPrefix.values()].filter((each) => each.connection.kind === kind),
    );
  const openedOf = (kind: SourceKind): Open | null =>
    [...byPrefix.values()].find((each) => each.connection.kind === kind) ?? null;
  const declared = (kind: SourceKind) => {
    const declaration = declarationOf(kind);
    if (!declaration) throw new Error(`no source declares ${kind}`);
    return declaration;
  };
  // Opens a connection through its connector's declaration, or its
  // fixture's. A source that keeps no prefix of its own reads its items under
  // its kind, so it opens only its kind's first connection.
  const openOne = async (
    kind: SourceKind,
    connection: ToOpen,
    how: { fixture: boolean; kept: boolean; fetch?: typeof fetch | undefined },
  ): Promise<Opened> => {
    const declaration = declared(kind);
    const via: OpenVia = { kept: how.kept, log, now, ...(how.fetch ? { fetch: how.fetch } : {}) };
    const opened = await (how.fixture
      ? declaration.fixture.open(connection, via)
      : declaration.open(connection, via));
    if ((opened.source.prefix ?? opened.source.kind) !== connection.prefix) {
      opened.close?.();
      throw new Error(`${kind} opens only its first connection for now`);
    }
    return opened;
  };

  const flags = flagged(options.jira, options.slack);
  // The window's routes for each source, which reach connections through
  // this loop, made below, once a person asks.
  const windows = windowSources({
    jira: options.jira,
    opening: {
      connections,
      opened: (kind) => openedOf(kind),
      synced: (prefix) => synced(prefix),
      connect: (kind, made, how) => connect(kind, made, how),
      sync: (kind) => syncAsked(kind),
    },
    log,
  });
  await windows.beforeOpen();
  // Kept connections that didn't open, as one whose account its source
  // turned away: what the index has of them still shows, but nothing reads
  // or writes them until a person signs in again.
  const shut = new Map<string, Connection>();
  for (const kind of sourceKinds) {
    // A flag's connection is its kind's first, made at every start, and
    // follows what the flag names. One that can't open stops the start.
    const flag = flags.find((each) => each.kind === kind);
    if (flag) {
      const first = connections.first(kind);
      const opened = await openOne(
        kind,
        {
          id: first?.id ?? newId(),
          number: 1,
          prefix: kind,
          identity: flag.identity,
          options: flag.options,
          secret: flag.secret,
        },
        { fixture: flag.fixture, kept: false, fetch: flag.fetch },
      );
      const connection = connections.flagged(kind, opened.identity ?? flag.identity, flag.options);
      byPrefix.set(connection.prefix, { connection, opened });
      continue;
    }
    // One the window made, with its secret, if the window connects its kind.
    // One that can't open is left shut, so the window asks for it again.
    const connection = windows.kept(kind) ? connections.first(kind) : null;
    if (!connection) continue;
    const secret = await connections.secret(connection);
    if (!(await windows.vet(connection, secret))) {
      shut.set(connection.prefix, connection);
      continue;
    }
    try {
      const opened = await openOne(
        kind,
        { ...connection, secret },
        { fixture: false, kept: true, fetch: windows.fetch(kind) },
      );
      byPrefix.set(connection.prefix, { connection, opened });
    } catch (error) {
      shut.set(connection.prefix, connection);
      log("connections: one couldn't open", {
        kind,
        number: connection.number,
        error: error instanceof Error ? error.message : "",
      });
    }
  }
  // A fixture is frozen as of its last change, so the window is built for
  // that instant: the "stuck" rules come out the same on every run.
  const asOf = opens().find((each) => each.opened.frozen)?.opened.frozen ?? null;

  const recordsOf = ({ connection, opened }: Open) =>
    index.records(workspaceId, connection.prefix, opened.attrs);
  // Open and shut connections' prefixes, in declared order. A server
  // started without a connection a flag made keeps what an earlier one
  // indexed, which nothing can read now, out of the window.
  const indexed = (): string[] =>
    sourceKinds.flatMap((kind) =>
      [...opens(), ...[...shut.values()].map((connection) => ({ connection }))]
        .filter((each) => each.connection.kind === kind)
        .map((each) => each.connection.prefix),
    );
  const records = (): IndexRecord[] =>
    indexed().flatMap((prefix) => {
      const each = byPrefix.get(prefix);
      return each ? recordsOf(each) : index.records(workspaceId, prefix, unknown);
    });
  const synced = (prefix: string) => {
    const each = byPrefix.get(prefix);
    return {
      items: each ? recordsOf(each).length : 0,
      syncedAt: index.source(workspaceId, prefix)?.syncedAt ?? null,
    };
  };

  // Every open connection's recognizer, in its scope, for what each sync
  // hands it. A message synced before Jira connects names nothing in Jira
  // until Slack syncs again.
  const recognize = () =>
    recognizerOf(opens().map(({ connection, opened }) => ({ kind: connection.kind, opened })));

  // One sync at a time, of any connection, through the generic sync worker.
  // Once each ends, every page watching the workspace hears, as even one
  // that failed may have kept pages it read; nobody is watching before the
  // turns start.
  let syncing: Promise<unknown> = Promise.resolve();
  let told = (): void => {};
  // Workstreams following their anchors, as a sync renames them through the
  // dispatcher, made below: the syncs before it catch up once it is.
  let follow = async (): Promise<void> => {};
  // The first sync of a connection into this workspace connects it,
  // whenever that sync is. `announced` counts them, so connecting from the
  // window can tell whether it was counted so.
  let announced = 0;
  const connected = (connection: Pick<Connection, "kind" | "number">) => {
    announced += 1;
    emit({
      name: "source.connected",
      at: now(),
      workspaceId,
      source: connection.kind,
      later: connection.number > 1,
    });
  };
  // Syncs a connection, and says whether it was its first. A first one
  // that worked is announced, unless the caller does that once it keeps the
  // connection.
  const syncInto = (
    connection: Pick<Connection, "kind" | "number" | "prefix">,
    opened: Opened,
    full: boolean,
    how: {
      items?: readonly { id: ItemId; stableId: string }[];
      source?: Opened["source"];
      announce?: boolean;
    } = {},
  ): Promise<boolean> => {
    const declaration = declared(connection.kind);
    let first = false;
    const run = syncing
      .catch(() => {})
      .then(async () => {
        first = index.source(workspaceId, connection.prefix) === null;
        await syncSource({
          source: how.source ?? opened.source,
          attrs: opened.attrs,
          facets: declaration.facets,
          key: declaration.key,
          recognize: recognize(),
          index,
          workspaceId,
          full,
          items: how.items ?? [],
          clock: now,
          log,
        });
      })
      .then(async () => {
        // A workstream that can't follow its epic is no reason to call the
        // sync failed.
        try {
          await follow();
        } catch (error) {
          log("following epics failed", { error: String(error) });
        }
      })
      .finally(() => told());
    syncing = run;
    return run.then(() => {
      if (first && how.announce !== false) connected(connection);
      return first;
    });
  };
  // What applies wrote lately to a connection whose listing lags, by its
  // prefix and the item's stable ID, read by key on every sync until its
  // listing has surely caught up: until then it may list an item as it was
  // before the write, or list one a revert deleted, and a listed record comes
  // back to life in the index.
  const written = new Map<string, Map<string, { id: ItemId; stableId: string; at: Instant }>>();
  const lagging = ({ connection, opened }: Open) => {
    const kept = written.get(connection.prefix);
    if (!kept || opened.lagMs === undefined) return [];
    const since = Date.parse(now()) - opened.lagMs;
    for (const [stableId, { at }] of kept) if (Date.parse(at) < since) kept.delete(stableId);
    return [...kept.values()];
  };
  // A sync of an open connection: null, or what went wrong in the person's
  // words. One that fails leaves the index as it was, apart from pages it
  // had read, as they're what the source said.
  const syncOpen = async (each: Open, full: boolean): Promise<string | null> => {
    try {
      await syncInto(each.connection, each.opened, full, { items: lagging(each) });
      return null;
    } catch (error) {
      log("connections: a sync failed", {
        source: each.connection.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      return each.opened.problem(error);
    }
  };
  // Each open connection syncs as the server starts; one that can't leaves
  // the index as it was, and the server starts anyway.
  for (const each of opens()) await syncOpen(each, !each.opened.incremental);

  // A kind's connects and the syncs asked of it take turns, so a sync asked
  // for while another connection takes a kind's place reads whichever is
  // open once that ends, never the one it replaced.
  const kindTurns = new Map<SourceKind, Promise<unknown>>();
  const inTurn = <T>(kind: SourceKind, work: () => Promise<T>): Promise<T> => {
    const turn = (kindTurns.get(kind) ?? Promise.resolve()).then(work);
    kindTurns.set(
      kind,
      turn.catch(() => {}),
    );
    return turn;
  };
  // The Sync a person asks for: a full sweep, as only one finds what was
  // deleted in the source. Syncs run one at a time; one asked for while
  // another of its kind waits to start joins it, as it would list the same.
  const waiting = new Map<SourceKind, Promise<string | null>>();
  const syncAsked = (kind: SourceKind): Promise<string | null> => {
    const joined = waiting.get(kind);
    if (joined) return joined;
    const run = inTurn(kind, async () => {
      await syncing.catch(() => {});
      waiting.delete(kind);
      const each = openedOf(kind);
      return each ? syncOpen(each, true) : `${declared(kind).name} isn't connected to this window.`;
    });
    waiting.set(kind, run);
    return run;
  };
  // A sync between the Syncs a person asks for, in its kind's turn.
  const syncKind = (kind: SourceKind): Promise<string | null> =>
    inTurn(kind, async () => {
      const each = openedOf(kind);
      return each ? syncOpen(each, !each.opened.incremental) : null;
    });
  // Work done between syncs, as forgetting a connection's items must be: a
  // sync running then would take the snapshot version it takes.
  const betweenSyncs = <T>(work: () => Promise<T>): Promise<T> => {
    const run = syncing
      .catch(() => {})
      .then(work)
      .finally(() => told());
    syncing = run;
    return run;
  };
  // A source that tells `heard` how many records each page it lists holds.
  const counting = (source: Opened["source"], heard: (records: number) => void) => ({
    ...source,
    async *sync(cursor: string | null) {
      for await (const page of source.sync(cursor)) {
        heard(page.records.length);
        yield page;
      }
    },
  });

  // Connects what a person made in the window, in its kind's turn: opened,
  // synced in full, and kept only once both worked, so one that can't be
  // read leaves the one before as it was. A walk or a listing that fails
  // throws before the index sees any of it. Signing in to a live one again
  // keeps it, its number and its items; one disconnected before comes back
  // under its ID and number; anything else is new, with the next number.
  const connect: Opening["connect"] = (kind, made, how = {}) =>
    inTurn(kind, async () => {
      const current = openedOf(kind);
      // The same thing again keeps its connection, so none of its items' IDs
      // change.
      if (current?.connection.identity === made.identity) {
        const problem = await syncOpen(current, true);
        return problem
          ? { failed: "sync" as const, error: new Error(problem) }
          : { connection: current.connection };
      }
      const plan = connections.planned(kind, made.identity);
      const was = "live" in plan ? plan.live : "revives" in plan ? plan.revives : null;
      const number = was?.number ?? ("number" in plan ? plan.number : 1);
      const toOpen: ToOpen = {
        id: was?.id ?? newId(),
        number,
        prefix: prefixOf(kind, number),
        identity: made.identity,
        options: made.options,
        secret: made.secret ?? null,
      };
      let opened: Opened;
      try {
        opened = await openOne(kind, toOpen, {
          fixture: false,
          kept: true,
          fetch: windows.fetch(kind),
        });
      } catch (error) {
        return { failed: "open" as const, error };
      }
      let first: boolean;
      try {
        first = await syncInto({ kind, number, prefix: toOpen.prefix }, opened, true, {
          announce: false,
          ...(how.counting ? { source: counting(opened.source, how.counting) } : {}),
        });
      } catch (error) {
        opened.close?.();
        return { failed: "sync" as const, error };
      }
      try {
        const connection = await betweenSyncs(async () => {
          if (how.replaces && current) {
            await connections.disconnect(current.connection);
            byPrefix.delete(current.connection.prefix);
            current.opened.close?.();
          }
          if ("live" in plan) {
            await connections.signIn(plan.live, {
              options: made.options,
              secret: made.secret ?? "",
            });
            return { ...plan.live, options: made.options };
          }
          const kept = await connections.connect({
            id: toOpen.id,
            kind,
            identity: made.identity,
            options: made.options,
            ...(made.secret === undefined ? {} : { secret: made.secret }),
          });
          if ("taken" in kept) throw new Error(`that ${kind} connection is live already`);
          return kept.connection;
        });
        byPrefix.set(connection.prefix, { connection, opened });
        shut.delete(connection.prefix);
        sets.rewire(wiring());
        if (first) connected(connection);
        return { connection };
      } catch (error) {
        opened.close?.();
        return { failed: "keep" as const, error };
      }
    });
  const caps = options.limits ?? limits;

  const people = () => {
    const names = new Map<string, string>();
    for (const record of records())
      for (const person of record.facets.people ?? []) names.set(person.id, person.name);
    return names;
  };

  // Reads go to each item's own connection; search to the index (the escape
  // hatch).
  const reader: Reader = {
    async read(ids) {
      const read = new Map<string, ReadResult>();
      for (const [prefix, of] of Map.groupBy(ids, (id) => parseItemId(id)?.prefix ?? "")) {
        const each = byPrefix.get(prefix);
        if (each)
          for (const result of await each.opened.source.read(of)) read.set(result.id, result);
      }
      return ids.map((id) => read.get(id) ?? { id, status: "gone", reason: "forbidden" as const });
    },
    async search(query, limit) {
      // The connections open or shut now, by their prefixes.
      return index.search(workspaceId, query, limit, indexed()).map((record) => ({
        id: record.id,
        title: record.title,
        location: record.location,
        updatedAt: record.updatedAt,
      }));
    },
  };
  // Oriel's own data, read one way for the agent's namespaces and the
  // window's search (decision 0024, OA-108). What a change set wrote is named
  // from the index: people by their facets, and what each connection's
  // records name besides, such as Slack's channels and authors.
  const reads = orielReads({
    workspaceId,
    workstreams,
    threads,
    changeSets: {
      ofThread: (id) => sets.ofThread(id),
      changes: (set, known) => sets.changes(set, known),
    },
    title: (id) => viewer.title(id),
    known: () => {
      const all = records();
      const titles = new Map<string, string>(all.map((record) => [record.id, record.title]));
      const names = people();
      for (const each of opens())
        for (const [id, name] of each.opened.names?.(recordsOf(each)) ?? []) names.set(id, name);
      return { name: (id) => names.get(id) ?? null, title: (id) => titles.get(id) ?? null };
    },
    now,
  });
  const regionBindings = (region: Region, thread?: Ulid, shown?: Shown) =>
    bindingsFor(region, {
      reader,
      namespaces: namespacesOf(
        records(),
        opens().map(({ connection, opened }) => ({ kind: connection.kind, opened })),
      ),
      items: itemDocs,
      oriel: reads,
      ...(thread ? { thread } : {}),
      ...(shown ? { shown } : {}),
      // The window chat reads the overview, as the page shows it.
      ...(thread && threads.isWindowChat(thread) ? { overview: windowOverview } : {}),
    });

  const wiring = () => {
    const writable = opens().flatMap(({ connection, opened }) =>
      opened.writes === undefined
        ? []
        : [{ prefix: connection.prefix, kind: connection.kind, writes: opened.writes }],
    );
    // How change sets read a connection with no writer: its own fields, as
    // a fixture's, or, for one live but not open, a refusal that says to
    // connect it again.
    const readers = Object.fromEntries([
      ...connections
        .list()
        .filter(
          (each) =>
            each.disconnectedAt === null &&
            !byPrefix.has(each.prefix) &&
            declarationOf(each.kind)?.specs !== undefined,
        )
        .map((each) => [each.prefix, disconnected(declared(each.kind).name)] as const),
      ...opens().flatMap(({ connection, opened }) =>
        opened.writes === undefined && opened.fields
          ? [[connection.prefix, opened.fields] as const]
          : [],
      ),
    ]);
    return {
      writerConfig: writable,
      readers,
      names: Object.fromEntries(
        writable.map(({ prefix }) => [prefix, async (id: string) => people().get(id) ?? null]),
      ),
    };
  };
  // The writers are built with the change sets. Connecting from the window
  // builds them again, in place, so everything holding the change sets
  // writes through the connection from then on, and an apply running then
  // keeps its writer.
  const sets = changeSets({
    db,
    ...wiring(),
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
  // The agent's intents apply through the dispatcher, made below, as the
  // turn that recorded them ends.
  let intents: ReturnType<typeof intentsOf> | null = null;
  const agentDeps: ServerAgentDeps = {
    sandbox,
    bindingsFor: regionBindings,
    changeSets: { capture: (run, mutations) => sets.capture(run, mutations) },
    actions: {
      apply: (turn, recorded) => {
        if (!intents) throw new Error("Oriel's actions aren't ready yet");
        return intents.apply(turn, recorded);
      },
    },
    runs: { record: (run, reads) => runs.record(run, reads) },
    limits: caps,
    now,
    newId,
  };
  const store = options.settings ?? memorySettings();
  const { models } = options;
  const agent = options.agent
    ? options.agent(agentDeps)
    : models
      ? models.agent(store.get, agentDeps)
      : scriptedAgent(agentDeps, devPlan);
  const settings = settingsService({
    store,
    models: models ?? null,
    themes: options.themes ?? [defaultTheme],
    cliPaths: options.cliPaths ?? false,
    ...(options.keys ? { keys: options.keys } : {}),
    notifies: options.notify !== undefined,
    asksBeforeQuitting: options.working !== undefined,
    saved: () => guarding?.changed(),
    picked: (theme) => emit({ name: "theme.picked", at: now(), workspaceId, theme }),
  });
  const conversation = turns({
    threads,
    workstreams,
    agent,
    titler: options.titler ?? (models && !options.agent ? models.titler(store.get) : null),
    emit,
    caps,
    snapshot: () => index.snapshot(workspaceId),
    chips: (ids, threadId) => viewer.chips(ids, threadId),
    // Only items in the index: an answer may name any key, and the check
    // mustn't answer for an item nobody synced.
    read: (ids) => {
      const indexed = new Set<string>(records().map((record) => record.id));
      return reader.read(ids.filter((id) => indexed.has(id)));
    },
    now,
    newId,
    log,
  });
  told = () => conversation.synced();
  const viewer = views({
    workstreams,
    threads,
    records,
    presentations: sources,
    asOf: () => asOf ?? now(),
    now,
    running: conversation.running,
    changeSets: sets,
    sketchBase: options.sketchBase,
    get writable() {
      return opens().some((each) => each.opened.writes !== undefined);
    },
  });
  // The desktop app notifies when a thread newly needs the person.
  const notifying = options.notify
    ? await notifier({
        threads: () => viewer.threads(workspaceId),
        on: () => store.get().notify,
        notify: options.notify,
        log,
      })
    : null;
  const unwatchNotifying = notifying ? conversation.watchAny(() => notifying.changed()) : () => {};
  // And asks before quitting while Oriel works on a thread.
  const guarding = options.working
    ? quitGuard({
        working: () =>
          workingThreads({
            threads: threads.list(workspaceId, now()).map(({ thread }) => thread),
            running: conversation.running,
            changeSets: (threadId) => sets.ofThread(threadId),
            applying: (changeSetId) => sets.applying(changeSetId),
          }),
        on: () => store.get().askBeforeQuitting,
        tell: options.working,
        log,
      })
    : null;
  const unwatchGuarding = guarding ? conversation.watchAny(() => guarding.changed()) : () => {};

  // The items a change set names, as targets or, by each op's catalogue,
  // among its arguments; never a new item's ref.
  const namedBy = (set: ChangeSet): ItemId[] => {
    const refs = (op: string, args: unknown) =>
      Object.values(specs).flatMap((catalogue) => {
        const spec = catalogue?.ops[op];
        if (!spec) return [];
        try {
          return spec.refs(args);
        } catch {
          return [];
        }
      });
    const named = set.mutations.flatMap((m) => [
      ...(m.target !== null && isItemId(m.target) ? [m.target] : []),
      ...refs(m.op, m.args).filter(isItemId),
    ]);
    return [...new Set(named)];
  };

  // Oriel's own actions, through one dispatcher (decision 0024). Each call
  // publishes once to the window's streams: a workstream's working threads
  // follow it, with markers; a thread's pages hear it changed; and every
  // page hears that something did.
  const created = (set: ChangeSet) =>
    set.mutations.flatMap((m) => (m.target === null && m.applied ? [m.applied.item] : []));
  const dispatch = dispatcher({
    workspaceId,
    workstreams,
    threads,
    records,
    clusters: (grouping) => groupings[grouping].group(records(), asOf ?? now(), byItemId),
    created: async (id) => {
      const set = await sets.get(id);
      return set ? created(set) : [];
    },
    emit,
    markSeen: (at, seq) => markSeen(db, workspaceId, at, seq),
    turns: conversation,
    changeSets: sets,
    applied: (set) => applied(set),
    sources: {
      connect: async (input) => {
        const before = announced;
        const outcome = await windows.connect(input);
        return { outcome, counted: announced > before };
      },
      sync: async (kind) => {
        if (!openedOf(kind))
          throw new ActionError(
            "conflict",
            `${declared(kind).name} isn't connected to this window.`,
          );
        const problem = await syncAsked(kind);
        return problem ? { problem } : windows.synced(kind);
      },
    },
    running: conversation.running,
    unsettled: async (threadId) =>
      Promise.all(
        (await sets.ofThread(threadId))
          .filter((set) => set.decision?.kind !== "rejected" && set.completedAt === null)
          .map(async (set) => ({
            // As Needs you has it: a step for the user, or an apply stalled.
            waits:
              sets.stalled(set.id) ||
              (await sets.nextSteps(set.id)).some((step) => step.kind !== "revert"),
            names: namedBy(set),
          })),
      ),
    later: (ms, then) => {
      const timer = setTimeout(then, ms);
      return () => clearTimeout(timer);
    },
    publish: (changed) => {
      if ("changeSet" in changed)
        return conversation.changeSet(changed.thread, changed.changeSet, changed.applying);
      if ("deleted" in changed) {
        // Every page watching a thread that went with its workstream says so.
        if ("thread" in changed) return conversation.deleted(changed.thread);
        for (const thread of changed.deleted) conversation.deleted(thread);
        return conversation.acted({ thread: null, workstream: null, moves: [] });
      }
      conversation.acted(
        "thread" in changed
          ? {
              thread: changed.thread,
              chat: changed.chat === true,
              workstream: null,
              moves: changed.moved ? [changed.moved] : [],
            }
          : {
              thread: null,
              workstream: changed.workstream,
              moves: changed.members ? threads.follow(changed.workstream, now(), newId) : [],
            },
      );
    },
    now,
    newId,
  });

  follow = () =>
    followAnchors(workstreams, workspaceId, records(), (workstream, name, source) =>
      dispatch("workstream.rename", { workstream, name }, { kind: "sync", source }),
    );
  await follow().catch((error: unknown) => log("following epics failed", { error: String(error) }));

  intents = intentsOf({
    dispatch,
    workstreams,
    title: viewer.title,
    startedBy: conversation.startedBy,
  });
  const undoLine = lineUndo({
    dispatch,
    threads,
    workspaceId,
    rewritten: (thread, own) => {
      const moved = own ? threads.catchUp(thread, now(), newId()) : null;
      conversation.acted({ thread, chat: true, workstream: null, moves: moved ? [moved] : [] });
    },
    now,
  });

  // What a change set created joins its thread's workstream, so later turns can
  // work on it (decision 0018); the workstream's working threads follow. A workstream
  // made for a thread from nothing takes the name of the first epic created
  // in it, unless the user has named it. Both are actions the change set
  // takes.
  const applied = async (set: ChangeSet) => {
    const thread = threads.get(set.threadId, now());
    if (thread) {
      const by = { kind: "change-set", changeSetId: set.id } as const;
      const workstream = workstreams.get(thread.workstreamId);
      const epic = set.mutations.find((m) => m.op === "createEpic" && m.applied);
      const summary = (epic?.args as { summary?: unknown } | undefined)?.summary;
      const name = typeof summary === "string" ? nameOf(summary) : "";
      const blank =
        workstream?.origin.kind === "thread" &&
        workstream.name === blankWorkstreamName &&
        workstreams.region(workstream.id, workstream.version)?.items.length === 0;
      if (blank && name !== "")
        await dispatch("workstream.rename", { workstream: thread.workstreamId, name }, by);
      const items = created(set).map((member) => member.id);
      if (items.length)
        await dispatch("workstream.add", { workstream: thread.workstreamId, items }, by);
    }
    // Each open connection it wrote to syncs again, so what landed shows at
    // once and what it deleted goes. One whose listing lags reads what was
    // written by key until it has surely caught up. A frozen fixture doesn't.
    const wrote = new Set<string>();
    for (const { applied: write } of set.mutations) {
      const prefix = write && parseItemId(write.item.id)?.prefix;
      const each = prefix ? byPrefix.get(prefix) : undefined;
      if (!write || !prefix || !each || each.opened.frozen) continue;
      wrote.add(prefix);
      if (each.opened.lagMs === undefined) continue;
      const kept = written.get(prefix) ?? new Map();
      written.set(prefix, kept);
      kept.set(write.item.stableId, {
        id: write.item.id,
        stableId: write.item.stableId,
        at: write.at,
      });
    }
    for (const prefix of wrote) {
      const each = byPrefix.get(prefix);
      if (each) await syncOpen(each, !each.opened.incremental);
    }
  };

  // Every open connection, in declared order, as the sidebar lists them,
  // with what its last sync changed.
  const sourcesView = (): SourceView[] =>
    opens().map(({ connection, opened }) => ({
      kind: connection.kind,
      name: declared(connection.kind).name,
      about: opened.about,
      ...synced(connection.prefix),
      lastSync: index.source(workspaceId, connection.prefix)?.lastSync ?? {
        new: 0,
        changed: 0,
        removed: 0,
      },
    }));

  // The overview, computed now from the index, the change log, workstreams,
  // threads and review links: what the page shows and the window chat's
  // `window.overview()` reads (decision 0027).
  // The open workstreams and their members now.
  const openWorkstreams = () =>
    viewer
      .workstreams(workspaceId)
      .filter((summary) => summary.done === null && inOverview(summary))
      .map((summary) => ({
        id: summary.id,
        name: summary.name,
        createdAt: summary.createdAt as Instant,
        members: workstreams.region(summary.id as Ulid, summary.version)?.items ?? [],
      }));
  const overview = async (): Promise<OverviewView> => {
    const all = records();
    const at = asOf ?? now();
    const grouped = new Map<GroupingId, Cluster[]>();
    return overviewView({
      records: all,
      changes: index.changes(workspaceId),
      seen: lastSeen(db, workspaceId),
      workstreams: openWorkstreams(),
      threads: await viewer.threads(workspaceId),
      unopened: await sets.unopenedLinks(workspaceId),
      clusters: (grouping) => {
        const found = grouped.get(grouping) ?? groupings[grouping].group(all, at, byItemId);
        grouped.set(grouping, found);
        return found;
      },
      now: at,
    });
  };

  // The overview as the window chat's agent reads it, with the items it
  // shows as the index has them: what reached outside the region, which
  // shows as the escape-hatch block and which an action may add (decision
  // 0027).
  const windowOverview = async () => {
    const view = await overview();
    const all = records();
    const byId = new Map(all.map((record) => [record.id as string, record]));
    // Each cluster candidate's items, by ID, so the agent can make a
    // workstream of it, as Make a workstream does on the page (decision
    // 0038). The page itself never needs them.
    const at = asOf ?? now();
    const membersOf = (grouping: GroupingId, key: string) => {
      const cluster = groupings[grouping].group(all, at, byItemId).find((each) => each.key === key);
      return cluster ? clusterMembers(cluster).slice(0, maxItems) : [];
    };
    const rows = view.candidates.rows.map((row) =>
      row.subject.kind === "cluster"
        ? {
            ...row,
            subject: { ...row.subject, items: membersOf(row.subject.grouping, row.subject.key) },
          }
        : row,
    );
    const items = overviewItems(view).flatMap((id) => {
      const record = byId.get(id);
      return record
        ? [
            {
              id: record.id,
              title: record.title,
              location: record.location,
              updatedAt: record.updatedAt,
            },
          ]
        : [];
    });
    return {
      view: { ...view, candidates: { ...view.candidates, rows } },
      items,
      reachable: rows.flatMap((row) => ("items" in row.subject ? row.subject.items : [])),
    };
  };

  const window = (grouping: GroupingId) =>
    windowView(grouping, groupings[grouping], records(), asOf ?? now(), asOf !== null);

  // The desktop app's first run, and the commands for the person's CLI that
  // Settings shares with it (decision 0038).
  const setup = setupService({
    options: options.setup ?? null,
    models: models ?? null,
    settings,
    store,
    made: () => openWorkstreams().length > 0,
    reading: windows.reading,
    workspaceId,
    emit,
    now,
    log,
  });

  return {
    workspaceId,
    window,
    setup,
    jira: windows.jira,
    settings,
    api: api({
      workspaceId,
      settings,
      workstreams,
      threads,
      records,
      dispatch,
      undoLine,
      changeSets: sets,
      turns: conversation,
      views: viewer,
      reads,
      items: itemPanels({ reader, records, sources, now }),
      emit,
      now,
      // A frozen fixture doesn't change outside Oriel.
      refresh: async () => {
        const problems: string[] = [];
        for (const { connection, opened } of opens()) {
          if (opened.frozen) continue;
          const problem = await syncKind(connection.kind);
          if (problem) problems.push(problem);
        }
        return problems.length > 0 ? problems.join(" ") : null;
      },
      explain: (conflicts) => {
        const titles = new Map(records().map((record) => [record.id, record.title]));
        return explainConflicts(conflicts, specs, (id) => titles.get(id) ?? null);
      },
      browse: {
        rows: (grouping, filter) =>
          browseView(
            grouping,
            groupings[grouping],
            records(),
            asOf ?? now(),
            asOf !== null,
            keepOf(filter, () => heldBy(openWorkstreams()), prefixesOf(records())),
          ),
        page: (grouping, cluster, from, filter) =>
          clusterPage(
            grouping,
            groupings[grouping],
            records(),
            asOf ?? now(),
            cluster,
            from,
            keepOf(filter, () => heldBy(openWorkstreams()), prefixesOf(records())),
          ),
      },
      overview,
      jira: windows.jira,
      jiraProjects: windows.jiraProjects,
      folder: windows.folder,
      ...(options.pickFolder ? { pickFolder: options.pickFolder } : {}),
      sources: sourcesView,
      setup,
      log,
    }),
    sketch: (threadId, sketchId) => {
      if (!threads.get(threadId, now())) return null;
      for (const message of threads.messages(threadId)) {
        if (message.role !== "agent") continue;
        const event = agentEvent(message.event);
        if (event.ok && event.value.kind === "sketch" && event.value.sketch.id === sketchId)
          return event.value.sketch;
      }
      return null;
    },
    settled: async () => {
      await conversation.settled();
      await notifying?.idle();
      await guarding?.idle();
      await setup.idle();
    },
    telemetry: () => telemetry.list(workspaceId),
    revokeReviewLinks: () => sets.revokeAllReviewLinks(workspaceId),
    // Stops every turn, waits for the last sync, and closes the database.
    // Closing twice does nothing more.
    async close() {
      if (!db.isOpen) return;
      for (const summary of threads.list(workspaceId, now())) conversation.stop(summary.thread.id);
      conversation.stopTitles();
      await conversation.settled();
      unwatchNotifying();
      await notifying?.stop();
      unwatchGuarding();
      await guarding?.stop();
      setup.close();
      await setup.idle();
      await Promise.all(waiting.values());
      await syncing.catch(() => {});
      for (const each of byPrefix.values()) each.opened.close?.();
      if (db.isOpen) db.close();
    },
  };
}
