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
  type OwnItems,
  maxReferences,
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
  type FoundServer,
  type Recognized,
  type ConnectRefusal,
  type PickChoice,
  pickedInto,
  pickedOf,
  type SourceServer,
  type ThroughServer,
  type ToolCaller,
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
  sourceKindStore,
  type StandInMove,
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
  knownServers,
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
import type { Provider, Titler } from "@oriel/agent";
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
import type { OldSecrets } from "./connection.ts";
import { connectionsOf } from "./connections.ts";
import { connecting } from "./connecting.ts";
import { historyRead } from "./history.ts";
import { flagged, inWindow, type SourceModes } from "./modes.ts";
import { followAnchors, nameOf } from "./names.ts";
import { intentsOf, lineUndo } from "./intents.ts";
import { orielReads } from "./oriel-reads.ts";
import { heldBy, overviewItems, overviewView } from "./overview.ts";
import { itemPanels } from "./panel.ts";
import type { Calling, Models } from "./model.ts";
import { devPlan, scriptedAgent } from "./scripted-agent.ts";
import { type Challenger, challenger } from "./challenger.ts";
import {
  memorySettings,
  type Settings,
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
import { type Discovery, discoverWith, sourceServers } from "./source-servers.ts";

export type { SourceMode, SourceModes } from "./modes.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The MCP door for outside tools (decision 0058): open where it listens, or
// closed and why, as when its kept port is taken.
export type Door = { url: string; port: number } | { closed: string };

// A source server's call with no process of the person's agent to make it:
// none is picked and runs, or the one picked can't run now (decision 0059).
class NoAgentRuns extends Error {}

export type AppOptions = {
  // A SQLite file, or ":memory:".
  db: string;
  // Where the MCP door listens, which `serve()` opens; none in a test.
  door?: Door;
  // Holds SQLite's exclusive lock on the file while the app runs, so no
  // second server can open it (decision 0036).
  exclusive?: boolean;
  // How each connector's connections are made: by a flag at start, as its
  // fixture or a site in memory, or in the window (decision 0049). A kind
  // left out is made in the window when its connector declares how, as the
  // folder's, and otherwise turns on through its source server (decision
  // 0059).
  sources?: SourceModes;
  // What `pnpm dev` kept of connections' secrets before decision 0059,
  // which the start deletes.
  retire?: OldSecrets;
  // Kinds turned on at start through the source server the person's agent
  // lists for each, as a person's click in Settings does: `pnpm dev`'s
  // `--on <kind>`, which the maintainer types.
  on?: readonly SourceKind[];
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
  // Asks the person's agent for its MCP servers (decision 0059), for tests
  // and screenshots; Settings' models when absent.
  discover?: (settings: Settings) => Promise<Discovery>;
  // The source servers Oriel knows, by kind: the connectors' when absent,
  // and a test's own entry in tests and screenshots.
  knownServers?: readonly { kind: string; server: SourceServer }[];
  // Starts a process of the person's agent that calls one of their servers
  // with only `tools` (decision 0059), for tests and screenshots: Settings'
  // models when absent.
  callServer?: (
    server: FoundServer,
    tools: readonly string[],
    known: SourceServer,
  ) => Promise<Calling | null>;
  // The themes window.css has, the default first.
  themes?: readonly string[];
  // Whether the page may set where a CLI is: only behind the desktop app's
  // launch secret, since a path set is a program the server runs.
  cliPaths?: boolean;
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
  // How a connection is opened or read: through its connector's `open`,
  // through the source server its kind is on through (`server`), or over
  // Oriel's own store of a stand-in's items (`own`); or through its
  // fixture's, over the fixture's stand-in, or over a site in memory a test
  // made (`fetch`), for a flag's.
  type How = {
    from?: "fixture" | "memory";
    fetch?: typeof fetch | undefined;
    own?: OwnItems;
    server?: ThroughServer;
  };
  const openVia = (how: How): OpenVia => ({
    log,
    now,
    ...(how.fetch ? { fetch: how.fetch } : {}),
    ...(how.own ? { own: how.own } : {}),
    ...(how.server ? { server: how.server } : {}),
  });
  // Opens a connection as `how` says. A source that keeps no prefix of its
  // own reads its items under its kind, so it opens only its kind's first
  // connection.
  const openOne = async (kind: SourceKind, connection: ToOpen, how: How): Promise<Opened> => {
    const declaration = declared(kind);
    const via = openVia(how);
    const memory = declaration.fixture.memory;
    const opened = await (how.from === "memory"
      ? memory && how.fetch
        ? memory(connection, { ...via, fetch: how.fetch })
        : Promise.reject(new Error(`${kind}'s fixture opens no site in memory`))
      : how.from === "fixture"
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
    opening: { connections, connect: (kind, made) => connect(kind, made) },
    log,
  });
  // Before any connection opens: what `pnpm dev` kept of connections'
  // secrets before decision 0059 is deleted, once. The connections, their
  // options and items stay, so a kind turned on through its source server
  // opens its first again (`openThrough`).
  if (options.retire) {
    const deleted = options.retire.retire();
    if (deleted > 0) log("connections: secrets kept before retired", { deleted });
  }
  // Kept connections that didn't open, as one whose source server couldn't
  // open it: what the index has of them still shows, but nothing reads or
  // writes them until it opens.
  const shut = new Map<string, Connection>();
  // Shut ones whose options no longer fit their source, by prefix, with why
  // (decision 0051): they wait for their options, which opens them again.
  const unfit = new Map<string, string>();
  // Which kinds are on, and what the person's agent has to turn one on with
  // (decision 0059). A kind has a connection of its own while a flag makes
  // one, or, for a kind the window still connects itself, as the folder,
  // the window made one, open or shut. Any other kind's connection, as one
  // Jira had before decision 0059, holds only its options and its items'
  // IDs for when its kind turns on through its server.
  // A connection kept only for the options a source server reads with
  // (`keptFor`) identifies nothing in its source.
  const keptFor = (reports: string) => `through:${reports}`;
  // Such a connection as its kind opens it: it identifies nothing in its
  // source, so its server reads the first it reaches, as one never kept does.
  const asThrough = <T extends Connection>(connection: T): T =>
    connection.identity.startsWith(keptFor("")) ? { ...connection, identity: "" } : connection;
  // Whether a connection through a server is kept, for options that are the
  // person's to set through it: a mapping (`keepsOptions`), or picks.
  const keeps = (known: SourceServer) =>
    known.keepsOptions === true || (known.picks?.length ?? 0) > 0;
  // Whether the window connects a kind itself: one whose connector declares
  // steps and no source server, as the folder's.
  const ownKind = (kind: SourceKind) =>
    declared(kind).connect !== undefined && (declared(kind).servers ?? []).length === 0;
  const ownFirst = (kind: SourceKind): Connection | null =>
    ownKind(kind)
      ? (connections.list().find((each) => each.kind === kind && each.disconnectedAt === null) ??
        null)
      : null;
  const connectedKind = (kind: SourceKind) =>
    flags.some((flag) => flag.kind === kind) || ownFirst(kind) !== null;
  const kindStore = sourceKindStore(db);
  // What's on changed, once the start has opened what it does: made below.
  let turned = async (): Promise<void> => {};
  const switches = sourceServers({
    store: kindStore,
    workspaceId,
    known: options.knownServers ?? knownServers,
    kinds: sourceKinds
      .filter((kind) => !declared(kind).standIn)
      .map((kind) => ({ kind, name: declared(kind).name })),
    connected: connectedKind,
    discover: () => (options.discover ?? discoverWith(options.models))(store.get()),
    changed: () => turned(),
    heard: () => told(),
    sync: () => ({ every: store.get().sourceSync }),
    now,
    log,
  });
  // Opens a kind's first connection: the one a flag makes, at every start,
  // or one the window made, if the window connects its kind. A flag's that
  // can't open stops the start; one the window made is left shut, so the
  // window asks for it again.
  const openKind = async (kind: SourceKind) => {
    // Through the source server the person turned it on through, while the
    // agent lists it, in place of any connection of its own (decision 0059).
    const server = switches.serverFor(kind);
    if (server) return openThrough(kind, server);
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
        },
        { from: flag.how, fetch: flag.fetch },
      );
      const connection = connections.flagged(kind, opened.identity ?? flag.identity, flag.options);
      byPrefix.set(connection.prefix, { connection, opened });
      byFlag.add(connection.id);
      return;
    }
    // One the window made, if the window connects its kind itself, as the
    // folder. One that can't open is left shut, so the window asks for it
    // again.
    const connection = inWindow(modes, kind) ? ownFirst(kind) : null;
    if (!connection) return;
    try {
      const opened = await openOne(kind, connection, {});
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
  };
  // A kind turned off: its connections close, and nothing of them shows,
  // though they and their items stay, for when it's on again.
  const closeKind = (kind: SourceKind) => {
    throughOpen.delete(kind);
    throughProblems.delete(kind);
    for (const each of [...byPrefix.values()].filter((one) => one.connection.kind === kind)) {
      byPrefix.delete(each.connection.prefix);
      each.opened.close?.();
    }
    for (const connection of [...shut.values()].filter((one) => one.kind === kind)) {
      shut.delete(connection.prefix);
      unfit.delete(connection.prefix);
    }
  };
  // What each kind open through a source server was opened through, and
  // the agent its processes run on, for telemetry. A kind on through
  // another server now, or through none, opens again.
  const throughOpen = new Map<
    SourceKind,
    {
      key: string;
      server: string;
      agent: () => string | null;
      via: ThroughServer;
      // Stops its processes once idle, so the next call starts on the agent
      // that runs now.
      retire: () => void;
    }
  >();
  const serverKey = (server: Recognized | null) =>
    server
      ? JSON.stringify([
          server.found.name,
          server.found.url,
          server.found.command,
          [...server.found.tools],
        ])
      : null;
  // Why no process of the person's agent can call `server`, and the one
  // place that fixes it.
  const noAgentSaid = (server: Recognized): string => {
    const name = declared(server.kind as SourceKind).name;
    const running = options.models?.choose(store.get()).model;
    return !running || running.provider.kind === "api"
      ? `No AI is on to read ${name} through ${server.known.name}. Set up Claude Code or Codex in Settings, under Providers.`
      : `${running.provider.name} can't run now, so Oriel can't read ${name} through ${server.known.name}. See Settings, under Providers.`;
  };
  const callServer =
    options.callServer ??
    ((server: FoundServer, tools: readonly string[]) =>
      options.models?.serverCalls(store.get(), server, tools, log) ?? Promise.resolve(null));
  // Calls the server from a process of the person's agent that starts on
  // the first call and stops once it's been quiet a while, with only
  // `tools`: one for reads, another for a change set's writes.
  const lazyCalls = (server: Recognized, tools: readonly string[]) => {
    let current: Promise<Calling | null> | null = null;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let agent: string | null = null;
    // Calls in flight: it stops only once none is.
    let active = 0;
    // Another agent runs now: the process stops once its calls end.
    let stale = false;
    const close = () => {
      if (quiet) clearTimeout(quiet);
      quiet = null;
      stale = false;
      const was = current;
      current = null;
      void was?.then((calling) => calling?.calls.close()).catch(() => {});
    };
    const call: ToolCaller = async (each, signal) => {
      if (quiet) clearTimeout(quiet);
      quiet = null;
      active += 1;
      const at = (current ??= callServer(server.found, tools, server.known));
      try {
        const calling = await at;
        if (!calling) throw new NoAgentRuns(noAgentSaid(server));
        agent = calling.agent.kind;
        return await calling.calls.call(each, signal);
      } catch (error) {
        // A process that failed a call starts afresh for the next.
        if ((current as Promise<Calling | null> | null) === at && active === 1) close();
        throw error;
      } finally {
        active -= 1;
        if (active === 0 && (current as Promise<Calling | null> | null) !== null) {
          if (stale) close();
          else {
            quiet = setTimeout(close, 20_000);
            quiet.unref();
          }
        }
      }
    };
    const retire = () => {
      if (active === 0) close();
      else stale = true;
    };
    return { call, close, retire, agent: () => agent };
  };
  // Opens a kind through its source server: its first connection if it has
  // one, as one made before decision 0059, so its items keep their IDs and
  // its options carry over, as a Jira connection's project does, else one of
  // the server's own, which nothing keeps, as what's on is the kind's switch,
  // unless what the server reads is the person's to set, as Sheets' mapping
  // (`keepsOptions`, OA-279) or Slack's channels (`picks`): that one is
  // kept, so they last. One that can't open is left shut, with why, naming the server.
  const openThrough = async (kind: SourceKind, server: Recognized) => {
    const reads = lazyCalls(server, server.known.reads);
    const writes = lazyCalls(server, server.known.writes);
    let own = connections.first(kind);
    if (!own && keeps(server.known)) {
      const made = connections.connect({
        kind,
        identity: keptFor(server.known.reports),
        options: {},
      });
      own = "taken" in made ? made.taken : made.connection;
    }
    const connection: Connection = own ?? {
      id: newId(),
      kind,
      number: 1,
      prefix: kind,
      identity: "",
      name: null,
      options: {},
      every: null,
      connectedAt: now(),
      disconnectedAt: null,
    };
    const via: ThroughServer = {
      known: server.known,
      found: server.found,
      read: reads.call,
      write: writes.call,
    };
    try {
      const opened = await openOne(kind, asThrough(connection), { server: via });
      const close = opened.close;
      opened.close = () => {
        close?.();
        reads.close();
        writes.close();
      };
      byPrefix.set(connection.prefix, {
        connection: own ? connection : { ...connection, identity: opened.identity ?? "" },
        opened,
      });
      throughOpen.set(kind, {
        key: serverKey(server) ?? "",
        server: server.found.name,
        agent: reads.agent,
        via,
        retire: () => {
          reads.retire();
          writes.retire();
        },
      });
      problems.delete(connection.id);
    } catch (error) {
      reads.close();
      writes.close();
      log("source servers: a kind couldn't open through its server", {
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
      if (own) shut.set(own.prefix, own);
      // What the person picked through it no longer fits, as a channel
      // archived since: it waits, still through the server, for a pick
      // that does (decision 0051).
      if (own && keeps(server.known) && error instanceof OptionsUnfit) {
        unfit.set(own.prefix, error.message);
        throughOpen.set(kind, {
          key: serverKey(server) ?? "",
          server: server.found.name,
          agent: reads.agent,
          via,
          retire: () => {
            reads.retire();
            writes.retire();
          },
        });
        return;
      }
      // The agent's own words for why its process failed, or Oriel's for why
      // it refused one, such as a Claude Code to update; never what the
      // server answered.
      const why =
        error instanceof Error && ["ProviderError", "HostRefused"].includes(error.name)
          ? ` ${error.message}`
          : "";
      throughProblems.set(
        kind,
        `${declared(kind).name} couldn't open through ${server.known.name}.${why}`,
      );
    }
  };
  // Why a kind on through its server couldn't open, until it does.
  const throughProblems = new Map<SourceKind, string>();
  // What a connection open through its kind's source server reads through,
  // or waiting there for options that fit; null when it isn't.
  const throughFor = (connection: Connection): ThroughServer | null =>
    (
      byPrefix.get(connection.prefix)?.connection ??
      (unfit.has(connection.prefix) ? shut.get(connection.prefix) : undefined)
    )?.id === connection.id
      ? (throughOpen.get(connection.kind)?.via ?? null)
      : null;
  // The same, where what it reads through it is the person's to set
  // (`keeps`): its options are set, and its source previewed for them,
  // through the server.
  const setThrough = (connection: Connection): ThroughServer | null => {
    const through = throughFor(connection);
    return through && keeps(through.known) ? through : null;
  };
  // A pick's list for a connection through its source server, by the
  // option it sets, its first when none is named; null when its server
  // has none. Only the server's read tools list it.
  const listThrough = async (
    connection: Connection,
    query: string,
    field: string | null,
  ): Promise<{ choices: PickChoice[]; more: boolean } | ConnectRefusal | null> => {
    const through = throughFor(connection);
    const pick = through?.known.picks?.find((each) => field === null || each.name === field);
    if (!through || !pick) return null;
    try {
      return await pick.list(through.read, query, asThrough(connection));
    } catch (error) {
      log("source servers: a pick's list failed", {
        kind: connection.kind,
        error: error instanceof Error ? error.name : "",
      });
      return { problem: `${through.known.name} didn't list them just now. Try again.`, fields: [] };
    }
  };
  // A stand-in opens below, while what it stands in for isn't on.
  for (const kind of sourceKinds)
    if (!declared(kind).standIn && switches.on(kind)) await openKind(kind);
  // Whether a kind's surfaces show (decision 0059): not one a person or the
  // agent turned off, one a person turned on whose source server went, or a
  // stand-in while what it stands in for is on. A kind that was never on
  // keeps what it had, as Slack's namespace while it isn't connected.
  const kindShows = (kind: string) =>
    !switches.turnedOff().includes(kind) &&
    !switches.went(kind) &&
    !(declarationOf(kind)?.standIn && !standingIn(kind));
  // The stand-ins (decision 0059): each open while none of the kinds it
  // stands in for is on, and closed while one is. Closed, nothing of it shows, and its
  // items stay in the index, for when it's on again. Its one connection is
  // Oriel's, which the window neither configures nor disconnects.
  // While Oriel's offer to move its issues into one that turned on hasn't
  // applied, rejected or not, both stay.
  const standingIn = (kind: SourceKind) =>
    !(declared(kind).standIn?.for ?? []).some(
      (other) => switches.on(other) && !(moveOf(kind, other) && !moveOf(kind, other)?.movedAt),
    );
  const moveOf = (standIn: string, into: string) =>
    kindStore.moves(workspaceId).find((each) => each.standIn === standIn && each.into === into) ??
    null;
  const standIns = async () => {
    for (const kind of sourceKinds) {
      if (!declared(kind).standIn) continue;
      const open = openedOf(kind);
      if (!standingIn(kind)) {
        if (!open) continue;
        byPrefix.delete(open.connection.prefix);
        open.opened.close?.();
        continue;
      }
      if (open) continue;
      const connection = connections.flagged(kind, "oriel", {});
      const opened = await openOne(kind, connection, { own: ownOf(kind, connection.prefix) });
      byPrefix.set(connection.prefix, { connection, opened });
      ownConnections.add(connection.id);
    }
  };
  // Oriel's own store of a stand-in's items, which its connector writes:
  // between syncs, as a sync is, with the references its texts name, and
  // counted, never with its words.
  const ownConnections = new Set<Ulid>();
  const ownOf = (kind: SourceKind, prefix: string): OwnItems => {
    const store = index.own(workspaceId, prefix, unknown, declared(kind).facets);
    return {
      records: () => index.records(workspaceId, prefix, unknown),
      content: store.content,
      keys: store.keys,
      write: async ({ records, texts, contents, gone, what }) => {
        await betweenSyncs(async () => {
          const named = recognize();
          const references = Object.fromEntries(
            Object.entries(texts).map(([stableId, text]) => {
              const own = records.find((record) => record.stableId === stableId)?.id;
              return [
                stableId,
                named(text)
                  .filter((id) => id !== own)
                  .slice(0, maxReferences),
              ];
            }),
          );
          store.write(
            { records: [...records], gone: [...gone], texts, references },
            contents,
            now(),
          );
        });
        emit({
          name: "standin.written",
          at: now(),
          workspaceId,
          source: kind,
          by: what.by,
          change: what.change,
          fields: [...what.fields],
        });
        try {
          await follow();
        } catch (error) {
          log("following epics failed", { error: String(error) });
        }
      },
    };
  };
  await standIns();
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
    // A stand-in's items are its index rows: nothing syncs it.
    if (declaration.standIn) return Promise.resolve(false);
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
    const through = throughOpen.get(each.connection.kind);
    const started = Date.now();
    // A sync through a source server, counted: never what it read.
    const counted = (ok: boolean) => {
      const agent = through?.agent();
      if (agent === "claude-code" || agent === "codex")
        emit({
          name: "source.server-synced",
          at: now(),
          workspaceId,
          source: each.connection.kind,
          agent,
          items: recordsOf(each).length,
          ms: Date.now() - started,
          ok,
        });
    };
    try {
      await syncInto(each.connection, each.opened, full, { items: lagging(each) });
      problems.delete(each.connection.id);
      counted(true);
      return null;
    } catch (error) {
      counted(false);
      log("connections: a sync failed", {
        source: each.connection.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      // No AI to run the server through: that, in plain words, since
      // trying again won't help until one runs.
      const problem = error instanceof NoAgentRuns ? error.message : each.opened.problem(error);
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
  // Connects what a person made in the window, in its kind's turn: opened,
  // synced in full, and kept only once both worked, so one that can't be
  // read leaves the one before as it was, and it takes the place of the
  // kind's open one, as another folder picked does. A walk or a listing that
  // fails throws before the index sees any of it. One live already keeps
  // its number and items; one disconnected before comes back under its ID
  // and number; anything else is new, with the next number.
  const connect = (
    kind: SourceKind,
    made: { identity: string; options: Record<string, unknown> },
  ): Promise<{ connection: Connection } | { failed: "open" | "sync" | "keep"; error: unknown }> =>
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
      // One live already keeps what was set on it, such as its name, under
      // what its steps gave.
      const options = "live" in plan ? { ...plan.live.options, ...made.options } : made.options;
      const toOpen: ToOpen = {
        id: was?.id ?? newId(),
        number,
        prefix: prefixOf(kind, number),
        identity: made.identity,
        options,
      };
      let opened: Opened;
      try {
        opened = await openOne(kind, toOpen, {});
      } catch (error) {
        return { failed: "open" as const, error };
      }
      let first: boolean;
      try {
        first = await syncInto({ kind, number, prefix: toOpen.prefix }, opened, true, {
          announce: false,
        });
      } catch (error) {
        opened.close?.();
        return { failed: "sync" as const, error };
      }
      try {
        const connection = await betweenSyncs(async () => {
          if (current) {
            connections.disconnect(current.connection);
            unarm(current.connection.id);
            byPrefix.delete(current.connection.prefix);
            current.opened.close?.();
          }
          if ("live" in plan) {
            connections.configure(plan.live, options);
            return { ...plan.live, options };
          }
          const kept = connections.connect({
            id: toOpen.id,
            kind,
            identity: made.identity,
            options: made.options,
          });
          if ("taken" in kept) throw new Error(`that ${kind} connection is live already`);
          return kept.connection;
        });
        byPrefix.set(connection.prefix, { connection, opened });
        shut.delete(connection.prefix);
        // Its first sync just worked: what the last one said is past.
        problems.delete(connection.id);
        await offerMoves();
        await standIns();
        sets.rewire(wiring());
        arm(connection);
        if (first) connected(connection);
        return { connection };
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
    if (ownConnections.has(connection.id))
      throw new ActionError(
        "conflict",
        `Oriel keeps ${declared(connection.kind).inSentence} itself, so the window can't ${what} it.`,
      );
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
          `${declaration.name} isn't open now, so its options can't be set.`,
        );
      const before = current.connection;
      // What its server's picks set, given as the values picked, as Sheets'
      // spreadsheets, written into the option that holds them (decision
      // 0059).
      const given = pickedInto(
        throughFor(before)?.known.picks ?? [],
        before.options,
        Object.fromEntries(Object.entries(raw).filter(([key]) => !isSetting(key))),
      );
      // Merged over the options it has now, in its turn, so a change made
      // just before isn't undone. A connector's option given as null goes,
      // as an Undo takes away one that wasn't set before.
      const decoded = declaration.options(
        Object.fromEntries(
          Object.entries({ ...before.options, ...given }).filter(([, value]) => value !== null),
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
        // Set through its source server, it opens through it again.
        const through = setThrough(connection);
        try {
          opened = await openOne(
            connection.kind,
            { ...(through ? asThrough(before) : before), options: next },
            through ? { server: through } : {},
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
        await standIns();
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
    // Open through a source server, it reads what the server gives it
    // (decision 0059): one of its own options, if it has none, doesn't wait,
    // unless they're the person's to set through it (`keepsOptions`).
    const through = throughFor(connection);
    if (through && !through.known.keepsOptions) return null;
    const declaration = declared(connection.kind);
    if (!declaration.preview) return null;
    return (
      unfit.get(connection.prefix) ??
      (declaration.options(connection.options).ok && !declaration.review?.waits(connection.options)
        ? null
        : noOptionsYet)
    );
  };
  // None of a kind that's off, whose source nothing reads (decision 0059),
  // nor one of a kind read only through a source server while it isn't
  // open through one, as a Sheets connection kept from before.
  const waitingConnections = (): { connection: Connection; why: string }[] =>
    connections.list().flatMap((connection) => {
      if (!kindShows(connection.kind)) return [];
      if (!ownKind(connection.kind) && !throughFor(connection)) return [];
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
    // Nothing reads the source of a kind that's off (decision 0059).
    if (!kindShows(connection.kind))
      throw new ActionError(
        "conflict",
        `${declaration.name} is off. Turn it on in Settings to read it again.`,
      );
    const key = JSON.stringify(connection.options);
    const kept = names ? listed : previews;
    const had = kept.get(connection.id);
    const at = Date.parse(now());
    const holds = first.every((place) => had?.tables.some((table) => table.at === place));
    if (!fresh && had?.options === key && at - had.at < 5 * 60_000 && holds) return had.tables;
    // Through its source server, while it's set through one; a flag's over
    // its fixture's stand-in, or the site in memory it names.
    const through = setThrough(connection);
    const flag = byFlag.has(connection.id)
      ? flags.find((each) => each.kind === connection.kind)
      : undefined;
    const via = openVia(through ? { server: through } : { fetch: flag?.fetch });
    const ask = names ? { names: true as const } : { first };
    const preview = flag && !through ? declaration.fixture.preview : declaration.preview;
    const tables = (await preview?.(through ? asThrough(connection) : connection, via, ask)) ?? [];
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
  // What a region's module has of each kind but those off, whose namespace
  // and item doc it doesn't name (decision 0059).
  const unlessOff = <T>(byKind: Partial<Record<string, T>>): Partial<Record<string, T>> =>
    Object.fromEntries(Object.entries(byKind).filter(([kind]) => kindShows(kind)));
  const regionBindings = (
    region: Region,
    thread?: Ulid,
    shown?: Shown,
    run?: { challenge?: ChallengeRun },
  ) =>
    bindingsFor(region, {
      reader,
      namespaces: readable(
        unlessOff(
          namespacesOf(
            records(),
            opens().map(({ connection, opened }) => ({ kind: connection.kind, opened })),
          ),
        ),
      ),
      items: unlessOff(itemDocs),
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
    notifies: options.notify !== undefined,
    asksBeforeQuitting: options.working !== undefined,
    saved: () => guarding?.changed(),
    picked: (theme) => emit({ name: "theme.picked", at: now(), workspaceId, theme }),
    // Another agent may have other servers, so what's on may change; and a
    // process of the one before, idle or once its calls end, stops.
    agentChanged: () => {
      for (const each of throughOpen.values()) each.retire();
      void switches.look();
    },
    synced: () => lookEvery(),
  });
  // What's on changed: a kind that turned on opens and syncs, one that
  // turned off closes, the stand-ins follow, and every page hears.
  turned = () =>
    betweenSyncs(async () => {
      const reopened: SourceKind[] = [];
      for (const kind of sourceKinds) {
        if (declared(kind).standIn) continue;
        const held =
          openedOf(kind) !== null || [...shut.values()].some((each) => each.kind === kind);
        if (!switches.on(kind)) {
          for (const each of opens().filter((one) => one.connection.kind === kind))
            unarm(each.connection.id);
          closeKind(kind);
        } else if (
          !held ||
          serverKey(switches.serverFor(kind)) !== (throughOpen.get(kind)?.key ?? null)
        ) {
          // Not open, or open through something else than the server it's on
          // through now, as a connection of its own once its server is on.
          if (held) {
            for (const each of opens().filter((one) => one.connection.kind === kind))
              unarm(each.connection.id);
            closeKind(kind);
          }
          await openKind(kind);
          for (const each of opens().filter((one) => one.connection.kind === kind))
            arm(each.connection);
          reopened.push(kind);
        }
      }
      await offerMoves();
      await standIns();
      sets.rewire(wiring());
      for (const kind of reopened) {
        const run = syncKind(kind).finally(() => kindSyncs.delete(run));
        kindSyncs.add(run);
      }
    });
  // What Settings shows of source servers, with why a kind on through one
  // couldn't open.
  const serversView = () => {
    const view = switches.view();
    return {
      ...view,
      kinds: view.kinds.map((each) => {
        const problem = throughProblems.get(each.kind as SourceKind);
        return problem ? { ...each, problem } : each;
      }),
    };
  };
  // The syncs of kinds that just turned on, which `settled` waits for.
  const kindSyncs = new Set<Promise<unknown>>();
  // Oriel looks for the person's servers when it opens, when they press
  // sync, and every so many minutes if they set that.
  let stopLooking = (): void => {};
  const lookEvery = () => {
    stopLooking();
    const minutes = store.get().sourceSync;
    // Each tick looks, then syncs every kind on through its server.
    const tick = async () => {
      await switches.look();
      for (const kind of throughOpen.keys()) await syncKind(kind);
    };
    stopLooking = minutes === null ? () => {} : every(minutes * 60_000, () => void tick());
  };
  lookEvery();
  void switches.look();
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
  // A workstream's member of a kind that's off doesn't show, and stays in
  // it for when the kind is on again (decision 0059).
  const shownMember = (id: string) => kindShows(parseItemId(id)?.kind ?? "");
  const viewer = views({
    workstreams,
    threads,
    records,
    shown: shownMember,
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
  // When a kind a stand-in stands in for turns on, writable, and the
  // stand-in has issues, Oriel offers one change set that makes each again
  // there (decision 0059), in a thread of its own, from a run of Oriel's
  // own, not the agent's. Each is offered once.
  const offerMoves = async () => {
    for (const kind of sourceKinds) {
      const standIn = declared(kind).standIn;
      const open = openedOf(kind);
      if (!standIn || !open) continue;
      for (const into of standIn.for) {
        const take = declared(into).takeIssues;
        if (!take || !switches.on(into) || !openedOf(into)?.opened.writes || moveOf(kind, into))
          continue;
        const issues = recordsOf(open).filter(
          (record) => record.facets.kind === "epic" || record.facets.kind === "story",
        );
        if (!issues.length) continue;
        const read = await open.opened.source.read(issues.map((record) => record.id));
        const description = (id: ItemId) => {
          const one = read.find((each) => each.id === id);
          const text =
            one?.status === "ok" ? (one.content as { description?: unknown }).description : "";
          return typeof text === "string" ? text : "";
        };
        const { mutations, items } = take(
          issues.map((record) => ({
            id: record.id,
            kind: record.facets.kind === "epic" ? "epic" : "story",
            summary: record.title,
            description: description(record.id),
            points: record.facets.estimate ?? null,
            epic: record.facets.container?.id ?? null,
          })),
        );
        if (!mutations.length) continue;
        const name = `Into ${declared(into).name}`;
        const workstreamId = newId();
        const threadId = newId();
        const runId = newId();
        const by = { kind: "sync", source: into } as const;
        workstreams.create(
          { id: workstreamId, workspaceId, name, origin: { kind: "thread" } },
          [],
          now(),
          by,
        );
        threads.open({ id: threadId, workspaceId, workstreamId }, now());
        threads.setTitle(threadId, name, now());
        runs.record(
          {
            id: runId,
            workspaceId,
            threadId,
            snapshot: index.snapshot(workspaceId),
            regionVersion: 1,
            systemPromptHash: "oriel",
            dtsHash: "oriel",
            model: "oriel",
            inputTokens: 0,
            outputTokens: 0,
            wallMs: 0,
            coldStartMs: null,
            outcome: "ok",
            startedAt: now(),
          },
          [],
        );
        const set = await sets.capture({ id: runId, threadId, workspaceId }, mutations);
        threads.append(
          threadId,
          {
            role: "note",
            note: {
              kind: "moving",
              changeSet: set.id,
              from: declared(kind).inSentence,
              into: declared(into).name,
              items: mutations.length,
            },
          },
          newId(),
          now(),
        );
        // Where a change set shows in its thread, as a run's does.
        threads.append(
          threadId,
          { role: "agent", event: { kind: "change-set", changeSetId: set.id } },
          newId(),
          now(),
        );
        kindStore.offerMove(
          workspaceId,
          { standIn: kind, into, threadId, changeSetId: set.id, items },
          now(),
        );
        emit({
          name: "standin.moving",
          at: now(),
          workspaceId,
          source: into,
          step: "offered",
          items: mutations.length,
        });
      }
    }
  };
  // The stand-in's item each create of a move made again, by its ID, to the
  // item it made.
  const pairsOf = (set: ChangeSet, move: StandInMove) =>
    new Map(
      set.mutations.flatMap((m) => {
        const from = m.ref ? move.items[m.ref] : undefined;
        return from && m.applied ? [[from as string, m.applied.item.id] as const] : [];
      }),
    );
  // Every workstream holding one of `pairs`' items holds its pair in its
  // place.
  const swapMembers = async (set: ChangeSet, pairs: ReadonlyMap<string, ItemId>) => {
    const by = { kind: "change-set", changeSetId: set.id } as const;
    const swapped: Ulid[] = [];
    for (const workstream of workstreams.list(workspaceId)) {
      const region = workstreams.region(workstream.id, workstream.version);
      const held = (region?.items ?? []).filter((member) => pairs.has(member.id));
      if (!held.length) continue;
      const items = held.flatMap((member) => {
        const pair = pairs.get(member.id);
        return pair ? [pair] : [];
      });
      await dispatch("workstream.add", { workstream: workstream.id, items }, by);
      await dispatch(
        "workstream.remove",
        { workstream: workstream.id, items: held.map((member) => member.id) },
        by,
      );
      swapped.push(workstream.id);
    }
    return swapped;
  };
  // Once Oriel's offer applied in full, and every issue of the stand-in has
  // its new item, every workstream holds the new items in place of the
  // stand-in's, and the stand-in steps aside. One the person left out of
  // it, or one made since, stays only in the stand-in, which stays on.
  const moved = async (set: ChangeSet) => {
    const move = kindStore.moves(workspaceId).find((each) => each.changeSetId === set.id);
    if (!move || move.movedAt || set.mutations.some((m) => m.status !== "applied")) return false;
    const pairs = pairsOf(set, move);
    const open = openedOf(move.standIn as SourceKind);
    const left = (open ? recordsOf(open) : []).filter(
      (record) =>
        (record.facets.kind === "epic" || record.facets.kind === "story") && !pairs.has(record.id),
    );
    if (left.length) return false;
    const swapped = await swapMembers(set, pairs);
    kindStore.moved(workspaceId, set.id, now());
    // Its own workstream held nothing but the move: the thread says where
    // its items went, and both end, done, where the Done page keeps them.
    threads.append(
      move.threadId as Ulid,
      {
        role: "note",
        note: {
          kind: "moved",
          changeSet: set.id,
          into: declared(move.into as SourceKind).name,
          workstreams: swapped,
        },
      },
      newId(),
      now(),
    );
    const own = threads.get(move.threadId as Ulid, now())?.workstreamId;
    if (own && !workstreams.region(own, workstreams.get(own)?.version ?? 0)?.items.length)
      await dispatch(
        "workstream.done",
        { workstream: own },
        { kind: "change-set", changeSetId: set.id },
      );
    emit({
      name: "standin.moving",
      at: now(),
      workspaceId,
      source: move.into as SourceKind,
      step: "moved",
      items: pairs.size,
    });
    await betweenSyncs(async () => {
      await standIns();
      sets.rewire(wiring());
    });
    return true;
  };
  // A move reverted, in full or part: for each item the revert deleted,
  // workstreams hold the stand-in's again, and the stand-in is on again
  // beside the kind, as when the move was offered. A revert that deleted
  // nothing changes nothing. Each apply of the revert, a Retry too, swaps
  // what it deleted: one already swapped back is held no more.
  const unmoved = async (set: ChangeSet, revert: ChangeSet) => {
    const move = kindStore.moves(workspaceId).find((each) => each.changeSetId === set.id);
    if (!move) return;
    const deleted = new Set<string>(
      revert.mutations.flatMap((m) =>
        m.op === "deleteItem" && m.status === "applied" && typeof m.target === "string"
          ? [m.target]
          : [],
      ),
    );
    const back = new Map(
      [...pairsOf(set, move)]
        .filter(([, to]) => deleted.has(to))
        .map(([from, to]) => [to as string, from as ItemId] as const),
    );
    if (!back.size) return;
    if (move.movedAt) {
      kindStore.moved(workspaceId, set.id, null);
      await betweenSyncs(async () => {
        await standIns();
        sets.rewire(wiring());
      });
    }
    await swapMembers(set, back);
  };
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
    kinds: {
      on: (kind, server) => switches.turnOn(kind, server),
      off: (kind, by) => switches.turnOff(kind, by),
      dismiss: () => switches.dismiss(),
    },
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
    // A person's own edit, of a stand-in's item only (decision 0059).
    edit: async (item, values) => {
      const prefix = parseItemId(item)?.prefix;
      const open = prefix === undefined ? undefined : byPrefix.get(prefix);
      if (!open?.opened.edit)
        throw new ActionError(
          "refused",
          "Only Oriel's own tracker's items are edited in place; any other source's change through a change set.",
        );
      try {
        return await open.opened.edit(item, values);
      } catch (error) {
        if (error instanceof RangeError) throw new ActionError("invalid", error.message);
        throw error;
      }
    },
    sources: {
      connect: async ({ kind, given }) => {
        const before = announced;
        const made = await windows.connect(kind, given);
        return "problem" in made
          ? { outcome: made, counted: false }
          : {
              outcome: { connection: connectionView(made.connection) },
              counted: announced > before,
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
        // One open through a source server isn't kept: it's the kind's.
        const connection =
          [...byPrefix.values()].find(
            (each) => each.connection.id === id && throughOpen.has(each.connection.kind),
          )?.connection ?? live(id as Ulid);
        if (byPrefix.get(connection.prefix)?.connection.id !== id)
          throw new ActionError(
            "conflict",
            `${declared(connection.kind).name} isn't open now, so Oriel can't sync it.`,
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
    // A move's items go to the workstreams that held the stand-in's.
    const moving = kindStore.moves(workspaceId).some((each) => each.changeSetId === set.id);
    if (thread && !moving) {
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
    // A move's new items are in the index now, for its workstreams to hold;
    // a revert of one gives them back the stand-in's.
    if (moving) await moved(set);
    const original = set.revertOf ? await sets.get(set.revertOf) : null;
    if (original) await unmoved(original, set);
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
      reads: declared(kept.kind).reads?.(kept) ?? kept.identity,
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
      // Open, it still waits while its options don't fit, or it has none;
      // shut, it couldn't open, as through a server that turned Oriel away.
      state:
        whyWaits(kept) !== null || (open?.connection.id !== connection.id && unfit.has(kept.prefix))
          ? "waiting"
          : open?.connection.id === connection.id
            ? "open"
            : "shut",
      flagged: byFlag.has(kept.id),
      own: ownConnections.has(kept.id),
      through: throughFor(kept) ? (throughOpen.get(kept.kind)?.server ?? null) : null,
      // What the person picks on it through its server, kept in its options.
      picks: (throughFor(kept)?.known.picks ?? []).map((pick) => ({
        name: pick.name,
        label: pick.label,
        many: pick.many === true,
        most: pick.most ?? null,
        unpicked: pick.unpicked,
        picked: pickedOf(pick, kept.options),
      })),
    };
  };
  // Every connection open or shut, in declared order, then by number.
  const kinds: readonly string[] = sourceKinds;
  // A stand-in on is among them, as the tracker that's on (decision 0059),
  // which Oriel keeps itself.
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
        members: (workstreams.region(summary.id as Ulid, summary.version)?.items ?? []).filter(
          (member) => shownMember(member.id),
        ),
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
      // The providers first, as one may have signed in or out since: the
      // servers are those of the agent that runs now.
      lookForServers: async () => {
        await settings.look();
        await switches.look();
      },
      connections: () => ({
        connections: connectionsView(),
        // A kind turned off isn't offered: nothing of it shows (decision 0059).
        connectable: sourceKinds.filter(
          (kind) => windows.connectable(kind) && !switches.turnedOff().includes(kind),
        ),
        refused: Object.fromEntries(
          sourceKinds.flatMap((kind) => {
            const why = windows.why(kind);
            return why === null ? [] : [[kind, why]];
          }),
        ),
        picker: options.pickFolder !== undefined,
        // The stand-ins on now (decision 0059), which the first run and the
        // overview offer in place of what they stand in for.
        standingIn: opens()
          .filter((each) => declared(each.connection.kind).standIn)
          .map((each) => each.connection.kind),
        servers: serversView(),
      }),
      choices: async (id, query, field) => {
        const listed = await listThrough(live(id as Ulid), query, field ?? null);
        if (listed === null) throw new ActionError("not-found", "it has no list to pick from");
        return listed;
      },
      folderStep: (kind) => windows.folderStep(kind),
      review: (id, fresh, tab) => review(id as Ulid, fresh, tab),
      redraw: (id, given, edit) => redraw(id as Ulid, given, edit),
      // The words that start a waiting connection's onboarding turn, when the
      // agent may draft and none has started for it; or, with a table, its
      // connector's words asking for a change to it, by its place, when the
      // agent may draft for the connection (OA-232); null otherwise.
      onboard: async (id, tab) => {
        const connection = live(id as Ulid);
        const step = declared(connection.kind).review?.step;
        if (!step || !drafts()) return null;
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
      await Promise.allSettled(kindSyncs);
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
      stopLooking();
      switches.close();
      await Promise.all(waiting.values());
      await syncing.catch(() => {});
      await noticed.stop();
      for (const each of byPrefix.values()) each.opened.close?.();
      if (db.isOpen) db.close();
    },
  };
  // `pnpm dev --on <kind>`: each kind turned on at start through the first
  // server the person's agent lists for it, as the maintainer's click in
  // Settings would, once the look ends (decision 0059). One the agent
  // doesn't list stays off, and the log says why.
  if (options.on?.length) {
    await switches.look();
    for (const kind of options.on) {
      try {
        await dispatch("source.on", { kind }, { kind: "user" });
      } catch (error) {
        log("source servers: --on couldn't turn a kind on", {
          kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return built;
}
