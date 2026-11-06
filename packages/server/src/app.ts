// The composition root: where the connectors' declarations meet the packages
// that use them. It opens the database and each connection, through its
// connector's declaration, and syncs, reads, recognizes and builds
// namespaces and writers for every one the same way, with no branch per
// source (decision 0049). It wires groupings, change sets, bindings, the
// sandbox and the agent into the JSON routes. Only this file builds change
// sets, which hold the writers; thread code gets `capture` and nothing else.
import { bindingsFor, type Waiting, waitingOf } from "@oriel/bindings";
import { ChangeSetError, changeSets, explainConflicts } from "@oriel/changeset";
import {
  type ChallengeRun,
  type ChangeSet,
  type Cluster,
  clusterMembers,
  connectionSettings,
  type ConnectionSettings,
  type Draft,
  type FieldReader,
  noOptionsYet,
  type PreviewTable,
  readsNow,
  type ReviewEdit,
  type ReviewTable,
  type IndexRecord,
  type Instant,
  type Known,
  instant,
  isItemId,
  isUlid,
  type ItemId,
  kindOf,
  type Log,
  maxItems,
  type Opened,
  type OpenVia,
  OptionsUnfit,
  parseItemId,
  prefixOf,
  type Reader,
  readOnlyOf,
  record,
  type ReadResult,
  type Region,
  searchedOf,
  settingNames,
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
  runStore,
  challengeStore,
  outsideToolStore,
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
import type {
  ConnectionView,
  GroupingId,
  OverviewView,
  OptionsReviewView,
  ReviewRedrawn,
  WindowView,
} from "@oriel/web/view";
import type { KeyCheck, Provider, Titler } from "@oriel/agent";
import type { KeyStore } from "./api-key.ts";
import { defaultTheme } from "@oriel/web/themes";
import { type Agent, agentEvent, type ServerAgentDeps, type AgentLimits } from "./agent.ts";
import {
  ActionError,
  blankWorkstreamName,
  type Changed,
  dispatcher,
  liveChangeSet,
} from "./actions.ts";
import type { Outside } from "./mcp/door.ts";
import { outsideTools } from "./mcp/tokens.ts";
import { api } from "./api.ts";
import { type LegacyJira, memorySecrets, type Secrets } from "./connection.ts";
import { connectionsOf } from "./connections.ts";
import { connecting, moveLegacy } from "./connecting.ts";
import { historyRead } from "./history.ts";
import { flagged, inWindow, type SourceModes } from "./modes.ts";
import { followAnchors, nameOf } from "./names.ts";
import { intentsOf, lineUndo } from "./intents.ts";
import { orielReads } from "./oriel-reads.ts";
import { heldBy, overviewItems, overviewView } from "./overview.ts";
import { itemPanels } from "./panel.ts";
import type { Models } from "./model.ts";
import { devPlan, scriptedAgent } from "./scripted-agent.ts";
import { type Challenger, challenger } from "./challenger.ts";
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
import { spent, turns } from "./turns.ts";
import { inOverview } from "./window-chat.ts";
import { views } from "./views.ts";
import { noticedService } from "./noticed.ts";
import { estimateKey } from "./signals.ts";
import { browseView, clusterPage, groupings, keepOf, windowView } from "./window.ts";

export type { SourceMode, SourceModes } from "./modes.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The MCP door for outside tools (decision 0058): open where it listens, or
// closed and why, as when its kept port is taken.
export type Door = { url: string; port: number } | { closed: string };

export type AppOptions = {
  // A SQLite file, or ":memory:".
  db: string;
  // Where the MCP door listens, which `serve()` opens; none in a test.
  door?: Door;
  // Holds SQLite's exclusive lock on the file while the app runs, so no
  // second server can open it (decision 0036).
  exclusive?: boolean;
  // How each connector's connections are made: by a flag at start, as its
  // fixture or live, or in the window (decision 0049). A kind left out is
  // made in the window when its connector declares how, and not otherwise.
  sources?: SourceModes;
  // Any account or site may be connected in the window, as on the desktop
  // app (decision 0038); otherwise only those Oriel's own tests use.
  anywhere?: boolean;
  // Oriel's own clients of sources, by kind, as each connector's `client`
  // names them, such as Google's from `.env` under `pnpm dev`. A connector
  // that names one isn't connected in the window without it.
  clients?: Readonly<Partial<Record<SourceKind, Readonly<Record<string, string>>>>>;
  // Jira's saved connection from before connections, which the first start
  // moves into one (decision 0049).
  legacyJira?: LegacyJira;
  // Where connections keep their secrets, each under the name made from its
  // ID (decision 0049); kept only while the server runs when absent.
  secrets?: Secrets;
  // Builds the agent from everything but a model provider: @oriel/agent's,
  // with one, or the scripted dev agent, which is the default.
  agent?: (deps: ServerAgentDeps) => Agent;
  // Builds the agent that takes a second look at a change set when the
  // person asks (decision 0054). Absent, the thread's own agent does when
  // Settings' models run it; the scripted dev agent takes none.
  challenger?: (deps: ServerAgentDeps) => Agent;
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
  // Calls `then` every `ms`, until the call it gives back stops it, for a
  // connection that syncs every few minutes; setInterval when absent.
  every?: (ms: number, then: () => void) => () => void;
  // The system's folder picker, through the desktop app's shell: the
  // folder picked, or null if the person cancelled.
  pickFolder?: (prompt: string) => Promise<string | null>;
  // The desktop app's first run and its commands for the person's CLI
  // (decision 0038). None under `pnpm dev`.
  setup?: SetupOptions;
  // The sandbox runs go to; Deno, started on the first run, when absent.
  sandbox?: Sandbox;
  // What Noticed's pass runs on, for tests and screenshots; Settings'
  // choice, through `models`, when absent (decision 0052).
  noticer?: () => Promise<{ provider: Provider; model: string } | null>;
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
  // Every connection, as the window shows them.
  connections(): ConnectionView[];
  api(request: Request, url: URL): Promise<Reply | null>;
  settings: SettingsService;
  workspaceId: Ulid;
  // Resolves once no turn is running, no title is being written, no
  // notification is being looked for and no Noticed pass is running.
  settled(): Promise<void>;
  // The pilot telemetry stored so far, oldest first.
  telemetry(): StoredEvent[];
  // Revokes every live review link, and says how many there were.
  revokeReviewLinks(): Promise<number>;
  // What the MCP door reaches (decision 0058).
  outside: Outside;
  close(): Promise<void>;
};

// How a change set reads a connection that is live but not open, as one its
// source turned away at the start: it can't be shown until it's connected
// again.
// How a change set reads a connection the person made read-only since it was
// proposed: it can't apply, so it isn't shown as if it could.
const readOnly = (name: string): FieldReader => ({
  current: async () => {
    throw new ChangeSetError(
      "read-only",
      `${name} is read-only in Settings, so Oriel can't make this change. Let ${name} propose changes in Settings first.`,
    );
  },
  name: async () => null,
});

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
  const looks = challengeStore(db);
  // A second look left running when Oriel last stopped never finishes.
  looks.abandonRunning(now());
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
  // What a connection is opened or read with: how requests reach its
  // source, Oriel's client of it, and, for one the window made, where a
  // refreshed token is kept for its next start.
  const openVia = (
    kind: SourceKind,
    id: Ulid,
    how: { kept: boolean; fetch?: typeof fetch | undefined },
  ): OpenVia => {
    const client = options.clients?.[kind];
    return {
      kept: how.kept,
      log,
      now,
      ...(how.fetch ? { fetch: how.fetch } : {}),
      ...(client ? { client } : {}),
      ...(how.kept ? { keep: (secret: string) => connections.rekey(id, secret) } : {}),
    };
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
    const via = openVia(kind, connection.id, how);
    const opened = await (how.fixture
      ? declaration.fixture.open(connection, via)
      : declaration.open(connection, via));
    if ((opened.source.prefix ?? opened.source.kind) !== connection.prefix) {
      opened.close?.();
      throw new Error(`${kind} opens only its first connection for now`);
    }
    return opened;
  };

  const modes = options.sources ?? {};
  const flags = flagged(modes);
  // The connections flags make, by ID: made again at every start, so the
  // window neither configures nor disconnects them.
  const byFlag = new Set<Ulid>();
  // What the person connects in the window, through each connector's steps,
  // which reach connections through this loop, made below, once they ask.
  const windows = connecting({
    modes,
    anywhere: options.anywhere ?? false,
    ...(options.clients ? { clients: options.clients } : {}),
    now,
    opening: {
      connections,
      // One signed out since it opened may be signed in to again.
      open: (kind) => {
        const open = openedOf(kind);
        return open !== null && !open.opened.signedOut?.();
      },
      connect: (kind, made, how) => connect(kind, made, how),
    },
    log,
  });
  // Before any connection opens: Jira's saved connection from before
  // connections moves into one.
  if (options.legacyJira && inWindow(modes, "jira"))
    await moveLegacy(connections, options.legacyJira, log);
  // Kept connections that didn't open, as one whose account its source
  // turned away: what the index has of them still shows, but nothing reads
  // or writes them until a person signs in again.
  const shut = new Map<string, Connection>();
  // Shut ones whose options no longer fit their source, by prefix, with why
  // (decision 0051): they wait for their options, which opens them again.
  const unfit = new Map<string, string>();
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
      byFlag.add(connection.id);
      continue;
    }
    // One the window made, with its secret, if the window connects its kind.
    // One that can't open is left shut, so the window asks for it again.
    const connection = inWindow(modes, kind) ? connections.first(kind) : null;
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
        { fixture: false, kept: true, fetch: windows.viaFor(kind).fetch },
      );
      byPrefix.set(connection.prefix, { connection, opened });
    } catch (error) {
      shut.set(connection.prefix, connection);
      if (error instanceof OptionsUnfit) unfit.set(connection.prefix, error.message);
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
      items: (each ? recordsOf(each) : index.records(workspaceId, prefix, unknown)).length,
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
  // Noticed's pass, made below, looks again at each sync's end (decision
  // 0052): the syncs before it catch up once it is.
  let notice = (): void => {};
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
        // Whether its options still fit its source, as this sync found.
        const why = opened.unfit?.() ?? null;
        if (why === null) unfit.delete(connection.prefix);
        else unfit.set(connection.prefix, why);
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
      .finally(() => {
        told();
        notice();
      });
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
  // Why each connection's last sync didn't work, by its ID, until one does.
  const problems = new Map<Ulid, string>();
  const syncOpen = async (each: Open, full: boolean): Promise<string | null> => {
    try {
      await syncInto(each.connection, each.opened, full, { items: lagging(each) });
      problems.delete(each.connection.id);
      return null;
    } catch (error) {
      log("connections: a sync failed", {
        source: each.connection.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      const problem = each.opened.problem(error);
      problems.set(each.connection.id, problem);
      return problem;
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
  // The Sync a person asks for of a connection: a full sweep, as only one
  // finds what was deleted in the source. Syncs run one at a time; one asked
  // for while another of it waits to start joins it, as it would list the
  // same.
  const waiting = new Map<Ulid, Promise<string | null>>();
  const syncAsked = (connection: Connection): Promise<string | null> => {
    const joined = waiting.get(connection.id);
    if (joined) return joined;
    const run = inTurn(connection.kind, async () => {
      await syncing.catch(() => {});
      waiting.delete(connection.id);
      // One another took the place of since it was asked for isn't synced:
      // the window shows the one open now.
      const each = byPrefix.get(connection.prefix);
      if (each?.connection.id !== connection.id)
        throw new ActionError(
          "conflict",
          `${declared(connection.kind).name} isn't connected to this window.`,
        );
      return syncOpen(each, true);
    });
    waiting.set(connection.id, run);
    return run;
  };
  // A sync between the Syncs a person asks for, in its kind's turn.
  const syncKind = (kind: SourceKind): Promise<string | null> =>
    inTurn(kind, async () => {
      const each = openedOf(kind);
      return each ? syncOpen(each, !each.opened.incremental) : null;
    });
  // A connection that syncs every few minutes while Oriel is open (decision
  // 0049), in its kind's turn, as whatever is open then: one another took
  // the place of, or disconnected, isn't synced. A frozen fixture isn't.
  const every =
    options.every ??
    ((ms: number, then: () => void) => {
      const timer = setInterval(then, ms);
      timer.unref();
      return () => clearInterval(timer);
    });
  const timers = new Map<Ulid, () => void>();
  const unarm = (id: Ulid) => {
    timers.get(id)?.();
    timers.delete(id);
  };
  const arm = (connection: Connection) => {
    unarm(connection.id);
    if (connection.every === null || connection.disconnectedAt !== null) return;
    const tick = () =>
      void inTurn(connection.kind, async () => {
        const each = byPrefix.get(connection.prefix);
        if (each?.connection.id !== connection.id || each.opened.frozen) return;
        await syncOpen(each, !each.opened.incremental);
      });
    timers.set(connection.id, every(connection.every * 60_000, tick));
  };
  for (const each of opens()) arm(each.connection);

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
  const connect = (
    kind: SourceKind,
    made: { identity: string; options: Record<string, unknown>; secret?: string; name?: string },
    how: { replaces?: boolean; counting?: (records: number) => void } = {},
  ): Promise<
    | { connection: Connection; signedIn: boolean }
    | { failed: "open" | "sync" | "keep"; error: unknown }
  > =>
    inTurn(kind, async () => {
      const current = openedOf(kind);
      // The same thing again keeps its connection, so none of its items' IDs
      // change.
      // One signed out since it opened is opened again with what was given.
      if (current?.connection.identity === made.identity && !current.opened.signedOut?.()) {
        const problem = await syncOpen(current, true);
        return problem
          ? { failed: "sync" as const, error: new Error(problem) }
          : { connection: current.connection, signedIn: false };
      }
      const plan = connections.planned(kind, made.identity);
      const was = "live" in plan ? plan.live : "revives" in plan ? plan.revives : null;
      const number = was?.number ?? ("number" in plan ? plan.number : 1);
      // Signed in again, it keeps what was set on it, such as read-only,
      // under what its steps gave.
      const again = declared(kind).connect?.again;
      const options =
        "live" in plan
          ? (again?.(plan.live.options, made.options) ?? { ...plan.live.options, ...made.options })
          : made.options;
      const toOpen: ToOpen = {
        id: was?.id ?? newId(),
        number,
        prefix: prefixOf(kind, number),
        identity: made.identity,
        options,
        secret: made.secret ?? null,
      };
      let opened: Opened;
      try {
        opened = await openOne(kind, toOpen, {
          fixture: false,
          kept: true,
          fetch: windows.viaFor(kind).fetch,
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
            unarm(current.connection.id);
            byPrefix.delete(current.connection.prefix);
            current.opened.close?.();
          }
          if ("live" in plan) {
            if (current?.connection.id === plan.live.id) current.opened.close?.();
            await connections.signIn(plan.live, { options, secret: made.secret ?? "" });
            return { ...plan.live, options };
          }
          const kept = await connections.connect({
            id: toOpen.id,
            kind,
            identity: made.identity,
            options: made.options,
            ...(made.secret === undefined ? {} : { secret: made.secret }),
          });
          if ("taken" in kept) throw new Error(`that ${kind} connection is live already`);
          // Named as its source says, such as by its account's email, unless
          // the person named it before.
          if (made.name === undefined || kept.connection.name !== null) return kept.connection;
          const named = { name: made.name, every: kept.connection.every };
          connections.settle(kept.connection, named);
          return { ...kept.connection, ...named };
        });
        byPrefix.set(connection.prefix, { connection, opened });
        shut.delete(connection.prefix);
        // Its first sync just worked: what the last one said is past.
        problems.delete(connection.id);
        sets.rewire(wiring());
        arm(connection);
        if (first) connected(connection);
        return { connection, signedIn: "live" in plan };
      } catch (error) {
        opened.close?.();
        return { failed: "keep" as const, error };
      }
    });
  // A connection by its ID, live, open or shut: one the page names.
  const live = (id: Ulid): Connection => {
    const found = connections.get(id);
    if (!found || found.disconnectedAt !== null)
      throw new ActionError("not-found", "no such connection");
    return found;
  };
  // One a flag makes is made again at every start, from its flag.
  const unflagged = (connection: Connection, what: string) => {
    if (byFlag.has(connection.id))
      throw new ActionError(
        "conflict",
        `A flag of pnpm dev makes this connection at every start, so the window can't ${what} it.`,
      );
  };
  // Sets a live connection's options, merged over the ones it has, in its
  // kind's turn, with what every connection has beside them: its name and
  // how often it syncs. They apply at once, as Settings' do (decision
  // 0049): new options open the connection with them and sync it in full,
  // so what they no longer pick goes, and a sync that fails says why, as any
  // sync does; the rest needs no sync. What changed is named, never its
  // value; `replaced` is what its Undo puts back. One shut because its
  // options no longer fit its source opens with new ones, and options that
  // don't fit shut it so, waiting for others (decision 0051).
  const configure = (
    id: Ulid,
    given: unknown,
  ): Promise<
    | {
        connection: Connection;
        changed: string[];
        replaced: Record<string, unknown>;
        problem: string | null;
      }
    | { problem: string }
  > => {
    const connection = live(id);
    unflagged(connection, "set");
    const declaration = declared(connection.kind);
    const invalid = (issues: readonly { path: string; message: string }[]) =>
      new ActionError(
        "invalid",
        issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
      );
    const asRecord = record(unknown)(given);
    if (!asRecord.ok) throw invalid(asRecord.issues);
    const raw = asRecord.value;
    const isSetting = (key: string) => (settingNames as readonly string[]).includes(key);
    const setting = connectionSettings(
      Object.fromEntries(Object.entries(raw).filter(([key]) => isSetting(key))),
    );
    if (!setting.ok) throw invalid(setting.issues);
    return inTurn(connection.kind, async () => {
      const waits = unfit.has(connection.prefix) ? shut.get(connection.prefix) : undefined;
      const current =
        byPrefix.get(connection.prefix) ?? (waits ? { connection: waits, opened: null } : null);
      if (!current || current.connection.id !== id)
        throw new ActionError(
          "conflict",
          `${declaration.name} is signed out. Connect it again in the window first.`,
        );
      const before = current.connection;
      // Merged over the options it has now, in its turn, so a change made
      // just before isn't undone. A connector's option given as null goes,
      // as an Undo takes away one that wasn't set before.
      const decoded = declaration.options(
        Object.fromEntries(
          Object.entries({
            ...before.options,
            ...Object.fromEntries(Object.entries(raw).filter(([key]) => !isSetting(key))),
          }).filter(([, value]) => value !== null),
        ),
      );
      if (!decoded.ok) throw invalid(decoded.issues);
      const next = decoded.value;
      const settled: ConnectionSettings = {
        name: setting.value.name === undefined ? before.name : setting.value.name,
        every: setting.value.every === undefined ? before.every : setting.value.every,
      };
      const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
      const options = [...new Set([...Object.keys(before.options), ...Object.keys(next)])].filter(
        (key) => differs(before.options[key], next[key]),
      );
      const settings = settingNames.filter((name) => differs(before[name], settled[name]));
      const changed = [...options, ...settings];
      // Its options, with null for one it didn't have, and of the rest only
      // what changed.
      const replaced = {
        ...before.options,
        ...Object.fromEntries(
          options.filter((key) => before.options[key] === undefined).map((key) => [key, null]),
        ),
        ...Object.fromEntries(settings.map((name) => [name, before[name]])),
      };
      if (changed.length === 0) return { connection: before, changed, replaced, problem: null };
      let opened = current.opened;
      if (options.length > 0) {
        const secret = await connections.secret(before);
        try {
          opened = await openOne(
            connection.kind,
            { ...before, options: next, secret },
            { fixture: false, kept: true, fetch: windows.viaFor(connection.kind).fetch },
          );
        } catch (error) {
          log("connections: one couldn't open with its options", {
            kind: connection.kind,
            error: String(error),
          });
          if (!(error instanceof OptionsUnfit))
            return { problem: `${declaration.name} couldn't be read that way. Nothing changed.` };
          // Options that don't fit its source are still the person's, as an
          // Undo puts back the ones a draft replaced: it keeps them, shut,
          // and waits for options that fit (decision 0051).
          const waits = await betweenSyncs(async () => {
            connections.configure(before, next);
            connections.settle(before, settled);
            written.delete(connection.prefix);
            const updated = { ...before, options: next, ...settled };
            byPrefix.delete(updated.prefix);
            shut.set(updated.prefix, updated);
            unfit.set(updated.prefix, error.message);
            unarm(updated.id);
            current.opened?.close?.();
            sets.rewire(wiring());
            return updated;
          });
          return { connection: waits, changed, replaced, problem: error.message };
        }
      }
      // Waiting for options that fit, and given none: what else was set is
      // kept, and it waits still.
      if (opened === null) {
        connections.settle(before, settled);
        const updated = { ...before, ...settled };
        shut.set(updated.prefix, updated);
        return {
          connection: updated,
          changed,
          replaced,
          problem: unfit.get(updated.prefix) ?? null,
        };
      }
      const reopened = opened;
      const kept = await betweenSyncs(async () => {
        if (options.length > 0) {
          connections.configure(before, next);
          // What applies wrote lately was in what the old options read.
          written.delete(connection.prefix);
        }
        connections.settle(before, settled);
        const updated = { ...before, options: next, ...settled };
        byPrefix.set(updated.prefix, { connection: updated, opened: reopened });
        shut.delete(updated.prefix);
        unfit.delete(updated.prefix);
        if (reopened !== current.opened) current.opened?.close?.();
        sets.rewire(wiring());
        return { connection: updated, opened: reopened };
      });
      arm(kept.connection);
      const problem = options.length > 0 ? await syncOpen(kept, true) : null;
      return { connection: kept.connection, changed, replaced, problem };
    });
  };
  // Disconnects a live connection, open or shut, between syncs: its secret,
  // its options, its items, their change log and the references they made
  // go, and a tombstone stays, so connecting the same thing again revives it.
  const disconnect = (id: Ulid) => {
    const connection = live(id);
    unflagged(connection, "disconnect");
    return inTurn(connection.kind, () =>
      betweenSyncs(async () => {
        const open = byPrefix.get(connection.prefix);
        await connections.disconnect(connection);
        unarm(connection.id);
        problems.delete(connection.id);
        byPrefix.delete(connection.prefix);
        shut.delete(connection.prefix);
        written.delete(connection.prefix);
        open?.opened.close?.();
        sets.rewire(wiring());
        return connection;
      }),
    );
  };
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
      return index.search(workspaceId, query, limit, indexed()).map(searchedOf);
    },
  };
  const known = (): Known => {
    const all = records();
    const titles = new Map<string, string>(all.map((record) => [record.id, record.title]));
    const names = people();
    for (const each of opens())
      for (const [id, name] of each.opened.names?.(recordsOf(each)) ?? []) names.set(id, name);
    return { name: (id) => names.get(id) ?? null, title: (id) => titles.get(id) ?? null };
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
    known,
    now,
  });
  // The connections that wait for their options (decision 0051): ones of a
  // connector that declares a preview, made in the window, that have none
  // yet or whose options no longer fit their source; each with why.
  const whyWaits = (connection: Connection): string | null => {
    if (connection.disconnectedAt !== null || byFlag.has(connection.id)) return null;
    const declaration = declared(connection.kind);
    if (!declaration.preview) return null;
    return (
      unfit.get(connection.prefix) ??
      (declaration.options(connection.options).ok && !declaration.review?.waits(connection.options)
        ? null
        : noOptionsYet)
    );
  };
  const waitingConnections = (): { connection: Connection; why: string }[] =>
    connections.list().flatMap((connection) => {
      const why = whyWaits(connection);
      return why === null ? [] : [{ connection, why }];
    });
  // The connections whose options the agent may draft (OA-232): those that
  // wait, and those open whose connector drafts in its own form, made in
  // the window, which the person may ask to change, by a tab's Ask Oriel or
  // in their own words.
  const draftable = (): { connection: Connection; why: string }[] => {
    const waiting = waitingConnections();
    const open = opens().flatMap(({ connection }) => {
      const declaration = declared(connection.kind);
      return !declaration.review ||
        !declaration.preview ||
        byFlag.has(connection.id) ||
        waiting.some((each) => each.connection.id === connection.id)
        ? []
        : [{ connection, why: readsNow }];
    });
    return [...waiting, ...open];
  };
  // The tab each connection's last Ask Oriel named, by its `at`, which its
  // preview reads first.
  const asked = new Map<Ulid, string>();
  const askedOf = (connection: Connection): string[] => {
    const tab = asked.get(connection.id);
    return tab ? [tab] : [];
  };
  // Each waiting connection's preview as last read, while its options are
  // the same, for 5 minutes at most: the review step asks again while the
  // agent drafts, and each read is requests to the source, under its quota.
  // A draft is drawn from it.
  // `first`: tables it must hold, read before any other. Settings' list of
  // a connection's tables is its names alone, kept the same way, apart.
  const previews = new Map<Ulid, { options: string; at: number; tables: PreviewTable[] }>();
  const listed = new Map<Ulid, { options: string; at: number; tables: PreviewTable[] }>();
  const previewOf = async (
    connection: Connection,
    fresh = false,
    first: readonly string[] = [],
    names = false,
  ): Promise<PreviewTable[]> => {
    const declaration = declared(connection.kind);
    const key = JSON.stringify(connection.options);
    const kept = names ? listed : previews;
    const had = kept.get(connection.id);
    const at = Date.parse(now());
    const holds = first.every((place) => had?.tables.some((table) => table.at === place));
    if (!fresh && had?.options === key && at - had.at < 5 * 60_000 && holds) return had.tables;
    const secret = await connections.secret(connection);
    const via = openVia(connection.kind, connection.id, {
      kept: true,
      fetch: windows.viaFor(connection.kind).fetch,
    });
    const ask = names ? { names: true as const } : { first };
    const tables = (await declaration.preview?.({ ...connection, secret }, via, ask)) ?? [];
    kept.set(connection.id, { options: key, at, tables });
    return tables;
  };
  // A draft of `source.configure` whose connector drafts in its own form,
  // with that connection and its review.
  const reviewed = (draft: Draft) => {
    if (draft.action !== "source.configure") return null;
    const id = draft.input["connection"];
    const connection = typeof id === "string" && isUlid(id) ? connections.get(id) : null;
    const review = connection && declared(connection.kind).review;
    return connection && review ? { connection, review } : null;
  };
  // A held draft as Oriel draws it from its source, from the preview the
  // agent read, with what applying it does to the items the connection has;
  // null when it's no longer there to draw from. For a connection that
  // reads, only the tables it changes (OA-232).
  const drawn = (draft: Draft): { tables: ReviewTable[]; said: string[] } | null => {
    const of = reviewed(draft);
    const tables = of && previews.get(of.connection.id)?.tables;
    const given = draft.input["options"];
    if (!of || !tables || !isRecord(given)) return null;
    const { connection, review } = of;
    const drafted = review.draw(given, tables);
    const settled = review.settle(given, tables, connection.options);
    const said = "problem" in settled ? [] : review.said(connection.options, settled, tables);
    if (whyWaits(connection) !== null) return { tables: drafted, said };
    // How a table reads, and what it says of itself, its states among it.
    const now = review.draw(review.current(connection.options, tables), tables);
    const reads = (table: ReviewTable | undefined) =>
      JSON.stringify([table?.reads ?? null, table?.lines ?? []]);
    return {
      tables: drafted.filter(
        (table) => reads(table) !== reads(now.find((each) => each.at === table.at)),
      ),
      said,
    };
  };
  // A draft's input as its action takes it: one in its connector's own form
  // settles into options against its source as it is now, such as each
  // column's letter turned into the header above it (decision 0051).
  const settleDraft = async (draft: Draft): Promise<Record<string, unknown>> => {
    const of = reviewed(draft);
    const given = draft.input["options"];
    if (!of) return draft.input;
    const tables = await previewOf(of.connection, true, askedOf(of.connection));
    const settled = of.review.settle(isRecord(given) ? given : {}, tables, of.connection.options);
    if ("problem" in settled) throw new ActionError("refused", String(settled.problem));
    return { ...draft.input, options: settled };
  };
  // The onboarding turns the window chat ran, by the connection each drafts.
  const onboarding = new Map<Ulid, Ulid>();
  // A connection whose connector drafts its options in its own form, with
  // how it reviews them.
  const reviewing = (id: Ulid) => {
    const connection = live(id);
    const declaration = declared(connection.kind);
    const of = declaration.review;
    if (!of || !declaration.preview)
      throw new ActionError("not-found", "it has no options to review");
    return { connection, of };
  };
  // What a connection's review step shows (decision 0051): while it waits,
  // Oriel's guess, drawn and settled, with no model; the agent's draft once
  // its turn holds one, drawn; and whether that turn still runs. Once it
  // reads, its options as they read now, drawn the same way (OA-232).
  const review = async (id: Ulid, fresh = false, tab?: string): Promise<OptionsReviewView> => {
    const { connection, of } = reviewing(id);
    const waits = waitingConnections().some((each) => each.connection.id === id);
    const { fields } = of;
    // Once it has read: each of its tables in a line, from their names
    // alone; and, for the one the person edits by hand, how it reads now,
    // drawn. So too while a mapping it had no longer fits its source, to
    // fix a table by asking or by hand; only one never mapped shows the
    // onboarding's guess and draft.
    if (!waits || !of.waits(connection.options)) {
      const outline = of.outline(connection.options, await previewOf(connection, fresh, [], true));
      const first = tab === undefined ? null : await previewOf(connection, fresh, [tab]);
      const given = first && of.current(connection.options, first);
      const current =
        first && given
          ? {
              given,
              tables: of.draw(given, first).filter((table) => table.at === tab),
            }
          : null;
      return { waits, guess: null, draft: null, drafting: null, current, fields, outline };
    }
    const tables = await previewOf(connection, fresh);
    // What applying a draft does to what the connection read before it
    // waited, such as a tab whose mapped column was renamed.
    const said = (given: Record<string, unknown>) => {
      const settled = of.settle(given, tables, connection.options);
      return "problem" in settled ? [] : of.said(connection.options, settled, tables);
    };
    const guessed = of.guess(tables);
    const settled = guessed && of.settle(guessed, tables, connection.options);
    const thread = onboarding.get(id) ?? null;
    const held = thread
      ? threads
          .held(thread)
          .filter(
            (each) =>
              "draft" in each && each.outcome === null && each.draft.input["connection"] === id,
          )
          .at(-1)
      : undefined;
    const draft = held && "draft" in held ? held : null;
    const options = draft?.draft.input["options"];
    return {
      waits,
      guess:
        guessed && settled && !("problem" in settled)
          ? {
              given: guessed,
              tables: of.draw(guessed, tables),
              options: settled,
              said: of.said(connection.options, settled, tables),
            }
          : null,
      draft:
        thread && draft && isRecord(options)
          ? {
              thread,
              seq: draft.seq,
              given: options,
              tables: of.draw(options, tables),
              said: said(options),
            }
          : null,
      drafting: thread && conversation.running(thread) ? { thread } : null,
      current: null,
      fields,
      outline: null,
    };
  };
  // A review's draft with one of the person's edits made, against the
  // preview the review step drew: drawn again, with the options it settles
  // into and what they do to what the connection read. It keeps nothing:
  // applying them is `source.configure`, or the held draft's own Apply.
  const redraw = async (id: Ulid, given: unknown, edit: ReviewEdit): Promise<ReviewRedrawn> => {
    const { connection, of } = reviewing(id);
    const tables = await previewOf(connection, false, [edit.table]);
    const next = of.edit(isRecord(given) ? given : {}, edit, tables);
    if ("problem" in next) throw new ActionError("invalid", String(next.problem));
    const settled = of.settle(next, tables, connection.options);
    const fits = !("problem" in settled) && declared(connection.kind).options(settled).ok;
    return {
      given: next,
      tables: of.draw(next, tables),
      options: fits ? settled : null,
      said: fits ? of.said(connection.options, settled, tables) : [],
      problem:
        "problem" in settled
          ? String(settled.problem)
          : fits
            ? null
            : "Oriel can't read the sheet that way: each column feeds one field.",
    };
  };
  // Whether a model runs the agent now, so it may draft: the scripted agent
  // always does.
  const drafts = () =>
    options.agent !== undefined ||
    !options.models ||
    options.models.choose(store.get()).model !== null;
  // A draft's action is `source.configure`, the one draftable action: what
  // it would replace now is the options its connection has, and its name
  // the connection's.
  const drafted = (draft: Draft): { over: unknown; name: string } | null => {
    const id = draft.input["connection"];
    const connection = typeof id === "string" && isUlid(id) ? connections.get(id) : null;
    if (!connection || connection.disconnectedAt !== null) return null;
    return {
      over: connection.options,
      name: connection.name ?? declared(connection.kind).name,
    };
  };
  // What the window chat's module offers while any connection waits: each
  // one's preview, read live from its source, with its connector's validator
  // for its options' type and a draft's check.
  const waitingFor = (): Waiting | null =>
    waitingOf(
      draftable().map(({ connection, why }) => {
        const declaration = declared(connection.kind);
        const { review } = declaration;
        return {
          id: connection.id,
          kind: connection.kind,
          source: declaration.name,
          why,
          options: connection.options,
          validator: declaration.options,
          ...(review
            ? { draft: { validator: review.draft, doc: review.doc, current: review.current } }
            : {}),
          // The agent's read is always live, with the tab the person asked
          // about.
          preview: () => previewOf(connection, true, askedOf(connection)),
        };
      }),
    );
  const regionBindings = (
    region: Region,
    thread?: Ulid,
    shown?: Shown,
    run?: { challenge?: ChallengeRun },
  ) =>
    bindingsFor(region, {
      reader,
      namespaces: readable(
        namespacesOf(
          records(),
          opens().map(({ connection, opened }) => ({ kind: connection.kind, opened })),
        ),
      ),
      items: itemDocs,
      oriel: reads,
      ...(thread ? { thread } : {}),
      ...(shown ? { shown } : {}),
      ...(run?.challenge ? { challenge: run.challenge } : {}),
      // The window chat reads the overview, as the page shows it, and the
      // previews of connections that wait for their options.
      ...(thread && threads.isWindowChat(thread) ? windowChat() : {}),
      history: historyRead({
        records,
        changes: () => index.changes(workspaceId),
        workstream: (id) => {
          const found = workstreams.get(id);
          return found
            ? { workstream: found, region: workstreams.region(id, found.version) }
            : null;
        },
        asOf: () => asOf ?? now(),
      }),
    });
  const windowChat = () => {
    const waiting = waitingFor();
    return { overview: windowOverview, ...(waiting ? { waiting } : {}) };
  };

  // A kind whose open connections are all read-only offers no write in a
  // region's module (decision 0049): what it can't apply, the agent can't
  // propose.
  const readable = (namespaces: ReturnType<typeof namespacesOf>) => {
    const open = opens();
    return Object.fromEntries(
      Object.entries(namespaces).map(([kind, spec]) => {
        const of = open.filter((each) => each.connection.kind === kind);
        return of.length > 0 && of.every((each) => readOnlyOf(each.connection.options))
          ? [kind, { ...spec, fns: (scope) => spec.fns(scope).filter((fn) => fn.kind === "read") }]
          : [kind, spec];
      }),
    ) as ReturnType<typeof namespacesOf>;
  };

  const wiring = () => {
    // No writer is built for a read-only connection, so a write to it is
    // unreachable, not merely unapproved (decision 0049).
    const writable = opens().flatMap(({ connection, opened }) =>
      opened.writes === undefined || readOnlyOf(connection.options)
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
          : readOnlyOf(connection.options) && opened.writes !== undefined
            ? [[connection.prefix, readOnly(declared(connection.kind).name)] as const]
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
    // Held under the reply, each with what it was drafted over; one whose
    // connection went meanwhile is dropped.
    drafts: {
      hold: (thread, drafts) =>
        conversation.holdDrafts(
          thread.id,
          drafts.flatMap((draft) => {
            const now = drafted(draft);
            return now ? [{ draft, over: now.over }] : [];
          }),
        ),
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
    alsoSpent: (threadId) => looks.usage(threadId),
  });
  told = () => conversation.synced();
  // Second looks (decision 0054), with an agent of their own, or the
  // thread's agent, on the thread's model, when a model runs it.
  const lookingAgent = options.challenger
    ? options.challenger(agentDeps)
    : models && !options.agent
      ? agent
      : null;
  const secondLooks: Challenger | null =
    lookingAgent &&
    challenger({
      challenges: looks,
      changeSets: sets,
      threads,
      workstreams,
      agent: lookingAgent,
      read: (ids) => {
        const indexed = new Set<string>(records().map((record) => record.id));
        return reader.read(ids.filter((id) => indexed.has(id)));
      },
      asOf: () => {
        const times = new Map<string, Instant>(
          records().map((record) => [record.id, record.updatedAt]),
        );
        return (id) => times.get(id) ?? null;
      },
      modelOf: (runId) => runs.model(runId),
      known,
      snapshot: () => index.snapshot(workspaceId),
      spent: (threadId) => {
        const said = spent(threads.messages(threadId));
        const looked = looks.usage(threadId);
        return {
          inputTokens: said.inputTokens + looked.inputTokens,
          outputTokens: said.outputTokens + looked.outputTokens,
        };
      },
      maxMutations: caps.maxMutationsPerChangeSet,
      changed: (threadId, changeSetId) =>
        conversation.changeSet(threadId, changeSetId, sets.applying(changeSetId), true),
      emit,
      now,
      newId,
      log,
    });
  const viewer = views({
    workstreams,
    threads,
    records,
    presentations: sources,
    asOf: () => asOf ?? now(),
    now,
    running: conversation.running,
    changeSets: sets,
    drafted,
    drawn,
    sketchBase: options.sketchBase,
    ...(secondLooks ? { secondLook: (set: ChangeSet) => secondLooks.view(set) } : {}),
    get writable() {
      return opens().some(
        (each) => each.opened.writes !== undefined && !readOnlyOf(each.connection.options),
      );
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
  // Who hears each change a call publishes, besides the window: the MCP
  // door's subscriptions.
  const watchers = new Set<(changed: Changed) => void>();
  // The outside tools the person connected (decision 0058).
  const connectedTools = outsideTools({ store: outsideToolStore(db), workspaceId, now, newId });
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
    // Made once the overview's reads are, below; no action runs before.
    noticed: () => noticed,
    turns: conversation,
    changeSets: sets,
    ...(secondLooks
      ? {
          secondLook: {
            take: async (id: Ulid) => {
              await secondLooks.take(id);
            },
            add: (id: Ulid, look: Ulid, places: readonly number[]) =>
              secondLooks.add(id, look, places),
            dismiss: (id: Ulid, look: Ulid) => secondLooks.dismiss(id, look),
          },
        }
      : {}),
    applied: (set) => applied(set),
    sources: {
      connect: async ({ kind, given }) => {
        const before = announced;
        const made = await windows.connect(kind, given);
        return "problem" in made
          ? { outcome: made, counted: false, signedIn: false }
          : {
              outcome: { connection: connectionView(made.connection) },
              counted: announced > before,
              signedIn: made.signedIn,
            };
      },
      configure: async ({ connection: id, options: given }) => {
        const done = await configure(id as Ulid, given);
        return "connection" in done
          ? {
              outcome: {
                connection: connectionView(done.connection),
                ...(done.problem ? { problem: done.problem } : {}),
              },
              changed: done.changed,
              replaced: done.replaced,
            }
          : { outcome: done, changed: [], replaced: {} };
      },
      sync: async ({ connection: id }) => {
        const connection = live(id as Ulid);
        if (byPrefix.get(connection.prefix)?.connection.id !== id)
          throw new ActionError(
            "conflict",
            `${declared(connection.kind).name} is signed out. Connect it again in the window first.`,
          );
        const problem = await syncAsked(connection);
        return {
          outcome: problem ? { problem } : { connection: connectionView(connection) },
          of: connection,
        };
      },
      disconnect: ({ connection: id }) => disconnect(id as Ulid),
    },
    drafted,
    settle: settleDraft,
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
      for (const listener of watchers) listener(changed);
      if ("changeSet" in changed)
        return conversation.changeSet(changed.thread, changed.changeSet, changed.applying);
      if ("deleted" in changed) {
        // Every page watching a thread that went with its workstream says so.
        if ("thread" in changed) return conversation.deleted(changed.thread);
        for (const thread of changed.deleted) conversation.deleted(thread);
        notice();
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
      // A curation: Noticed looks again, and passes only if its signals moved.
      if ("workstream" in changed) notice();
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
    // Each in its kind's turn, as whatever is open then: one disconnected
    // since isn't read back in.
    for (const prefix of wrote)
      await inTurn(kindOf(prefix), async () => {
        const each = byPrefix.get(prefix);
        if (each) await syncOpen(each, !each.opened.incremental);
      });
  };

  // A live connection as the window shows it: open, or shut since its
  // source turned it away at the start.
  const connectionView = (connection: Connection): ConnectionView => {
    const open = byPrefix.get(connection.prefix);
    const kept = open?.connection.id === connection.id ? open.connection : connection;
    return {
      id: kept.id,
      kind: kept.kind,
      number: kept.number,
      prefix: kept.prefix,
      name: kept.name ?? declared(kept.kind).name,
      named: kept.name !== null,
      about: open?.connection.id === connection.id ? open.opened.about : kept.identity,
      reads: declared(kept.kind).connect?.reads(kept) ?? kept.identity,
      identity: kept.identity,
      options: kept.options,
      readOnly: readOnlyOf(kept.options),
      viewOnly:
        open?.connection.id === connection.id
          ? (open.opened.viewOnly?.(recordsOf(open)) ?? null)
          : null,
      every: kept.every,
      // Waiting, why its options don't fit says more than an older sync's.
      problem: unfit.get(kept.prefix) ?? problems.get(kept.id) ?? null,
      report: open?.connection.id === connection.id ? [...(open.opened.report?.() ?? [])] : [],
      ...synced(kept.prefix),
      // What its last sync changed.
      lastSync: index.source(workspaceId, kept.prefix)?.lastSync ?? {
        new: 0,
        changed: 0,
        removed: 0,
      },
      // Open, it still waits while its options don't fit, or it has none,
      // and is signed out once its source turned its sign-in away.
      state:
        open?.connection.id === connection.id && open.opened.signedOut?.()
          ? "signed-out"
          : whyWaits(kept) !== null ||
              (open?.connection.id !== connection.id && unfit.has(kept.prefix))
            ? "waiting"
            : open?.connection.id === connection.id
              ? "open"
              : "signed-out",
      flagged: byFlag.has(kept.id),
    };
  };
  // Every connection open or shut, in declared order, then by number.
  const kinds: readonly string[] = sourceKinds;
  const connectionsView = (): ConnectionView[] =>
    [...opens().map((each) => each.connection), ...shut.values()]
      .toSorted((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.number - b.number)
      .map(connectionView);

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

  // Noticed (decision 0052): the overview's strip of what
  // Oriel found unasked, from the same index, change log and workstreams.
  const noticed = noticedService({
    db,
    workspaceId,
    input: async () => ({
      records: records(),
      changes: index.changes(workspaceId),
      workstreams: openWorkstreams(),
      threadActivity: new Map(
        (await viewer.threads(workspaceId))
          .toSorted((a, b) => a.activityAt.localeCompare(b.activityAt))
          .map((thread) => [thread.workstream.id, thread.activityAt as Instant]),
      ),
      estimateKey,
      now: asOf ?? now(),
    }),
    read: async (ids) =>
      (await reader.read(ids)).flatMap((result) => {
        if (result.status !== "ok") return [];
        const { title, text } = result.content;
        return [{ id: result.id, facts: {}, title, text }];
      }),
    noticer: options.noticer ?? (async () => (models ? models.noticer(store.get()) : null)),
    block: viewer.block,
    chips: (ids) => viewer.chips(ids, "" as Ulid),
    now: () => asOf ?? now(),
    log,
    // At the time it happened, even in a window frozen at a fixture's.
    emit: (event) => emit({ ...event, at: now() }),
  });
  notice = () => void noticed.refresh();
  notice();

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

  const built: App = {
    workspaceId,
    window,
    setup,
    connections: connectionsView,
    settings,
    api: api({
      workspaceId,
      settings,
      outside: { tools: connectedTools, door: options.door ?? null },
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
            keepOf(
              filter,
              () => heldBy(openWorkstreams()),
              (query) => index.matches(workspaceId, query),
            ),
          ),
        page: (grouping, cluster, from, filter) =>
          clusterPage(
            grouping,
            groupings[grouping],
            records(),
            asOf ?? now(),
            cluster,
            from,
            keepOf(
              filter,
              () => heldBy(openWorkstreams()),
              (query) => index.matches(workspaceId, query),
            ),
          ),
      },
      overview,
      noticed,
      connections: () => ({
        connections: connectionsView(),
        connectable: sourceKinds.filter((kind) => windows.connectable(kind)),
        refused: Object.fromEntries(
          sourceKinds.flatMap((kind) => {
            const why = windows.why(kind);
            return why === null ? [] : [[kind, why]];
          }),
        ),
        picker: options.pickFolder !== undefined,
      }),
      pick: (kind, given, query) => windows.pick(kind, given, query),
      choices: (id, query) => windows.choices(live(id as Ulid), query),
      folderStep: (kind) => windows.folderStep(kind),
      begin: (kind) => windows.begin(kind),
      review: (id, fresh, tab) => review(id as Ulid, fresh, tab),
      redraw: (id, given, edit) => redraw(id as Ulid, given, edit),
      // The words that start a waiting connection's onboarding turn, when the
      // agent may draft and none has started for it; or, with a table, its
      // connector's words asking for a change to it, by its place, when the
      // agent may draft for the connection (OA-232); null otherwise.
      onboard: async (id, tab) => {
        const connection = live(id as Ulid);
        const step = declared(connection.kind).connect?.steps.find(
          (each) => each.kind === "review",
        );
        if (step?.kind !== "review" || !drafts()) return null;
        if (tab !== undefined) {
          const may = draftable().some((each) => each.connection.id === connection.id);
          // Only one of its own tables, so the words name nothing else.
          const listed = may ? await previewOf(connection, false, [], true) : [];
          if (!listed.some((table) => table.at === tab))
            throw new ActionError(
              "invalid",
              "Oriel can't ask about that table of this connection.",
            );
          asked.set(connection.id, tab);
          return step.fix.replace("{at}", tab);
        }
        const waits = waitingConnections().some((each) => each.connection.id === connection.id);
        if (!waits || onboarding.has(connection.id)) return null;
        return step.ask;
      },
      onboarded: (id, thread) => void onboarding.set(id as Ulid, thread as Ulid),
      ...(options.pickFolder ? { pickFolder: options.pickFolder } : {}),
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
      await secondLooks?.settled();
      await notifying?.idle();
      await guarding?.idle();
      await setup.idle();
      await noticed.settled();
    },
    telemetry: () => telemetry.list(workspaceId),
    revokeReviewLinks: () => sets.revokeAllReviewLinks(workspaceId),
    outside: {
      workspaceId,
      dispatch,
      reads,
      reader,
      indexed: (id) => records().some((record) => record.id === id),
      tools: connectedTools,
      // One of the window's own read routes, past the window's guard, which
      // the door stands in for with its own (mcp/http.ts): a GET only, and
      // never an event stream, which a door's read would leave open.
      window: async (path) => {
        const url = new URL(path, "http://door/");
        const reply = await built.api(
          { method: "GET", url: url.pathname + url.search, headers: {} },
          url,
        );
        if (reply?.stream) {
          await reply.stream[Symbol.asyncIterator]().return?.();
          return { status: 404, body: null };
        }
        if (!reply) return { status: 404, body: null };
        const text = typeof reply.body === "string" ? reply.body : "";
        return { status: reply.status, body: text ? JSON.parse(text) : null };
      },
      // A change set's diff as the window shows it, rendered from the source
      // now without keeping it: what the person approves against stays what
      // they were shown, whatever a program read since (decision 0050).
      diff: async (id) => {
        const set = await liveChangeSet({ changeSets: sets, threads, workspaceId, now }, id);
        if (!set) return null;
        return viewer.diff(await sets.look(set.id), set, sets.applying(set.id));
      },
      // What each of Oriel's actions changed, every thread that moved in a
      // turn, and each entry in a thread's chat, as the window's streams
      // hear them.
      watch: (listener) => {
        watchers.add(listener);
        const unwatch = conversation.watchAny((thread) =>
          listener(thread === null ? null : { thread }),
        );
        // A thread's chat entries as they come, as its page hears them.
        const unwatchChat = conversation.watchEvery((thread) => listener({ thread }));
        return () => {
          watchers.delete(listener);
          unwatch();
          unwatchChat();
        };
      },
    },
    // Stops every turn, waits for the last sync, and closes the database.
    // Closing twice does nothing more.
    async close() {
      if (!db.isOpen) return;
      for (const summary of threads.list(workspaceId, now())) conversation.stop(summary.thread.id);
      conversation.stopTitles();
      await conversation.settled();
      secondLooks?.stop();
      await secondLooks?.settled();
      unwatchNotifying();
      await notifying?.stop();
      unwatchGuarding();
      await guarding?.stop();
      setup.close();
      await setup.idle();
      for (const stop of timers.values()) stop();
      timers.clear();
      await Promise.all(waiting.values());
      await syncing.catch(() => {});
      await noticed.stop();
      for (const each of byPrefix.values()) each.opened.close?.();
      if (db.isOpen) db.close();
    },
  };
  return built;
}
