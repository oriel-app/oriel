// The composition root: where the adapters' declarations meet the packages
// that use them. It opens the database, syncs Jira, the connected folder and
// Slack's picked channels into the index, connects Jira when the user does it
// from the window, and wires groupings, change sets, bindings, the sandbox and
// the agent into the JSON routes. Only this file builds change sets, which
// hold the writers; thread code gets `capture` and nothing else.
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { bindingsFor } from "@oriel/bindings";
import {
  ChangeSetError,
  changeSets,
  explainConflicts,
  type FieldReader,
  type WriterConfig,
} from "@oriel/changeset";
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
  SourceRefused,
  type SourceKind,
  sourceKinds,
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
  basicAuth,
  checkConnection,
  estimateless,
  fixtureFields,
  fixtureSource,
  jiraAttrs,
  JiraFailed,
  jiraSource,
  readTransport,
  syncSource,
} from "@oriel/jira";
import { folderAttrs, type FolderPath, folderSource, resolveFolder } from "@oriel/folder";
import {
  connectSlack,
  fixtureApi,
  slackAttrs,
  type SlackSource,
  slackSource,
  webApi,
} from "@oriel/slack";
import { createSandbox } from "@oriel/sandbox";
import { itemDocs, namespacesFor, sources, specs } from "@oriel/sources";
import type { FolderView, GroupingId, JiraView, WindowView } from "@oriel/web/view";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import type { Titler } from "@oriel/agent";
import { loadSlackFixture } from "../../../scripts/fixtures/slack.ts";
import type { Agent, ServerAgentDeps, AgentLimits } from "./agent.ts";
import { api, blankGroupName, type JiraDetails } from "./api.ts";
import { type ConnectionStore, type JiraConnection, jiraSite } from "./connection.ts";
import { throwawaySite } from "./env.ts";
import { fixtureIndex } from "./fixture.ts";
import { followAnchors, nameOf } from "./names.ts";
import { devPlan, scriptedAgent } from "./scripted-agent.ts";
import type { Reply, Request } from "./site.ts";
import { turns } from "./turns.ts";
import { views } from "./views.ts";
import { groupings, windowView } from "./window.ts";

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
// approved change sets. From the window is live too, once the user connects
// it there; the connection is kept in `store`, so it's there again the next
// time the server starts. `fetch` is for tests, as above.
export type JiraMode =
  | { kind: "fixture"; writeTo?: JiraWrites }
  | ({ kind: "live" } & JiraWrites)
  | { kind: "window"; store: ConnectionStore; fetch?: typeof fetch };

// Where Slack comes from, read-only (decision 0021). The fixture is the
// synthetic workspace in `fixtures/slack/`, with the channel picked there.
// Live is the workspace a token is for, reading only the public channels
// picked by name or ID; one it can't find stops the app from starting.
export type SlackMode =
  | { kind: "fixture" }
  | { kind: "live"; credential: Credential; channels: string[]; fetch?: typeof fetch };

export type AppOptions = {
  // A SQLite file, or ":memory:".
  db: string;
  jira: JiraMode;
  // No Slack when absent.
  slack?: SlackMode;
  // Builds the agent from everything but a model provider: @oriel/agent's,
  // with one, or the scripted dev agent, which is the default.
  agent?: (deps: ServerAgentDeps) => Agent;
  // Writes each thread's title from its first message. Without one, a
  // thread's title is that message, clipped.
  titler?: Titler;
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
  // Jira as the window shows it: what's connected, and whether it can be.
  jira(): JiraView;
  api(request: Request, url: URL): Promise<Reply | null>;
  workspaceId: Ulid;
  // Resolves once no turn is running and no title is being written.
  settled(): Promise<void>;
  // The pilot telemetry stored so far, oldest first.
  telemetry(): StoredEvent[];
  close(): Promise<void>;
};

// Jira's fields while the window has it unconnected: a change set captured
// before can't be shown until it's connected again.
const disconnected: FieldReader<"jira"> = {
  current: async () => {
    throw new ChangeSetError(
      "read-only",
      "Jira isn't connected now, so Oriel can't show this change. Connect Jira in the window.",
    );
  },
  person: async () => null,
};

// Why a connection the user typed wasn't kept, in their words.
const refusals: Record<
  "refused" | "no-project" | "unexpected" | "unreachable",
  (project: string) => string
> = {
  refused: () => "Jira didn't accept that email with what you pasted. Check both and try again.",
  "no-project": (project) =>
    `There's no project ${project} on that site that this account can see.`,
  unexpected: () => "Jira gave an answer Oriel didn't expect. Try again in a minute.",
  unreachable: () => "Oriel couldn't reach that site. Is it right?",
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
// How long Jira's search may take to find a write; it is usually seconds.
const searchLagMs = 10 * 60 * 1000;
const isJira = (id: string): id is ItemId<"jira"> => parseItemId(id)?.source === "jira";

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
  const transportTo = (to: JiraWrites) =>
    readTransport({
      site: to.site,
      credential: to.credential,
      ...(to.fetch ? { fetch: to.fetch } : {}),
    });
  const liveSource = (to: JiraWrites) =>
    jiraSource({
      transport: transportTo(to),
      site: to.site,
      projects: [to.project],
      log,
    });
  // Where change sets write, and the source the index syncs. From the
  // window, both are null until the user connects Jira.
  const writesTo = (saved: JiraConnection, send?: typeof fetch): JiraWrites => ({
    site: saved.site,
    credential: basicAuth(saved.email, saved.token),
    project: saved.project,
    ...(send ? { fetch: send } : {}),
  });
  const saved = mode.kind === "window" ? mode.store.load() : null;
  let writes: JiraWrites | null =
    mode.kind === "live"
      ? { site: mode.site, credential: mode.credential, project: mode.project, fetch: mode.fetch }
      : mode.kind === "fixture"
        ? (mode.writeTo ?? null)
        : saved && writesTo(saved, mode.fetch);
  // A saved connection Jira no longer takes, as when its token was revoked,
  // or to a site Oriel doesn't connect to, is dropped, so the window asks for
  // Jira again. One that can't be reached now is kept.
  if (mode.kind === "window" && writes) {
    const check =
      jiraSite(writes.site) !== throwawaySite
        ? ("refused" as const)
        : await checkConnection(transportTo(writes), writes.project).catch(
            () => "unreachable" as const,
          );
    if (check === "refused" || check === "no-project") {
      log("jira: the saved connection was refused", { check });
      writes = null;
    }
  }
  let source = fixture
    ? fixtureSource(fixture, { site, edited: fixture.edits.length })
    : writes && liveSource(writes);
  // The fixture is frozen as of its last edit, so its window is built for
  // that instant: the "stuck" rules come out the same on every run.
  const asOf = fixture ? fixtureIndex(fixture).now : null;

  const slack = options.slack ? await slackFrom(options.slack, log) : null;
  const records = (): IndexRecord[] => [
    ...index.records(workspaceId, "jira", jiraAttrs),
    ...index.records(workspaceId, "folder", folderAttrs),
    // Slack's records only while it's connected: a server started without it
    // keeps what an earlier one indexed, which nothing can read now.
    ...(slack ? index.records(workspaceId, "slack", slackAttrs) : []),
  ];

  // One sync at a time, of any source, through the generic sync worker.
  let syncing: Promise<unknown> = Promise.resolve();
  const syncInto = <K extends SourceKind, A>(
    from: Source<K, A>,
    attrs: Validator<A>,
    full: boolean,
    items: readonly { id: ItemId<K>; stableId: string }[] = [],
  ): Promise<unknown> => {
    const run = syncing
      .catch(() => {})
      .then(() =>
        syncSource({ source: from, attrs, index, workspaceId, full, items, clock: now, log }),
      )
      .then(() => {
        // A group that can't follow its epic is no reason to call the sync failed.
        try {
          followAnchors(groups, workspaceId, records());
        } catch (error) {
          log("following epics failed", { error: String(error) });
        }
      });
    syncing = run;
    return run;
  };
  // What applies wrote lately, by stable ID, read by key on every sync until
  // Jira's search has surely caught up: until then it may list an item as it
  // was before the write, or list one a revert deleted, and a listed record
  // comes back to life in the index.
  const written = new Map<string, { id: ItemId<"jira">; stableId: string; at: Instant }>();
  // The first sync of a source into this workspace connects it, whenever
  // that sync is. Jira's is announced once, though two syncs may both start
  // as the first.
  const connected = (kind: SourceKind) => {
    emit({ name: "source.connected", at: now(), workspaceId, source: kind });
  };
  let jiraAnnounced = false;
  const jiraConnected = () => {
    if (jiraAnnounced) return;
    jiraAnnounced = true;
    connected("jira");
  };
  const sync = async (full: boolean) => {
    if (!source) return;
    const first = index.source(workspaceId, "jira") === null;
    const since = Date.parse(now()) - searchLagMs;
    for (const [stableId, { at }] of written) if (Date.parse(at) < since) written.delete(stableId);
    await syncInto(source, jiraAttrs, full || first, [...written.values()]);
    if (first) jiraConnected();
  };
  // A connection made in the window that can't sync now leaves the index as
  // it was, and the server starts anyway, as it does for a folder.
  await sync(fixture !== null).catch((error: unknown) => {
    if (mode.kind !== "window") throw error;
    log("jira sync failed", { error: String(error) });
  });
  // What the user sees when Jira can't be synced. A sync that fails marks
  // nothing gone; pages it had already read stay, as they're what Jira said.
  const jiraProblem = (error: unknown) => {
    if (
      error instanceof SourceRefused ||
      (error instanceof JiraFailed && [401, 403].includes(error.status))
    )
      // A connection made in the window is dropped at the next start if Jira
      // still refuses the account, as it does a revoked token, and the window
      // asks for Jira again. One refused only the project's search is kept.
      return mode.kind === "window"
        ? "Jira turned Oriel away, so the window may be behind it. Restart Oriel to connect Jira again."
        : "Jira turned Oriel away, so the window may be behind it. Oriel's access to Jira may need renewing.";
    // No answer, as fetch reports it, or one Jira gives while it's busy or down.
    const unreachable =
      (error instanceof TypeError && error.message === "fetch failed") ||
      (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) ||
      (error instanceof JiraFailed && (error.status === 429 || error.status >= 500));
    if (unreachable)
      return "Oriel couldn't reach Jira just now, so the window may be behind it. Try again in a moment.";
    return error instanceof JiraFailed
      ? "Jira answered in a way Oriel didn't expect, so the window may be behind it."
      : "Oriel couldn't finish syncing Jira, so the window may be behind it.";
  };
  // The Sync the user asks for: a full sweep, as only one finds what was
  // deleted in Jira. Syncs run one at a time; one asked for while another
  // waits to start joins it, as it would list the same.
  let waiting: Promise<string | null> | null = null;
  const syncJira = (): Promise<string | null> =>
    (waiting ??= syncing
      .catch(() => {})
      .then(() => {
        waiting = null;
        return sync(true);
      })
      .then(
        () => null,
        (error: unknown) => {
          log("jira sync failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          return jiraProblem(error);
        },
      ));
  // The user asked for a sync: how often they do says whether Oriel should
  // sync on its own.
  const synced = (kind: SourceKind, problem: string | null) =>
    emit({ name: "source.synced", at: now(), workspaceId, source: kind, ok: problem === null });
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

  // Slack's picked channels, read-only (decision 0021). A sync that fails
  // leaves its items as they were, and says so.
  const syncSlack = async (): Promise<string | null> => {
    if (!slack) return null;
    const first = index.source(workspaceId, "slack") === null;
    try {
      await syncInto(slack, slackAttrs, true);
    } catch (error) {
      log("slack sync failed", { error: error instanceof Error ? error.message : String(error) });
      return "Slack didn't answer, so Oriel couldn't look for new messages.";
    }
    if (first) connected("slack");
    return null;
  };
  await syncSlack();

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
      const jira = ids.filter(isJira);
      const files = ids.filter(
        (id): id is ItemId<"folder"> => parseItemId(id)?.source === "folder",
      );
      const messages = ids.filter(
        (id): id is ItemId<"slack"> => parseItemId(id)?.source === "slack",
      );
      const results: ReadResult[] = [
        ...(jira.length && source ? await source.read(jira) : []),
        ...(files.length && folder ? await folder.source.read(files) : []),
        ...(messages.length && slack ? await slack.read(messages) : []),
      ];
      const read = new Map<string, ReadResult>(results.map((result) => [result.id, result]));
      return ids.map((id) => read.get(id) ?? { id, status: "gone", reason: "forbidden" as const });
    },
    async search(query, limit) {
      // Slack only while it's connected.
      const sources = sourceKinds.filter((kind) => kind !== "slack" || slack);
      return index.search(workspaceId, query, limit, sources).map((record) => ({
        id: record.id,
        title: record.title,
        location: record.location,
        updatedAt: record.updatedAt,
      }));
    },
  };
  const regionBindings = (region: Region) => {
    const all = records();
    // Where a story with no epic is created: the project the writer writes to.
    const home = writes?.project ?? fixture?.project.key ?? null;
    // What the last sync found on the boards, or else what the index shows.
    const none = source?.unestimating?.() ?? estimateless(all);
    return bindingsFor(region, {
      reader,
      namespaces: namespacesFor(all, { jira: { none, home } }),
      items: itemDocs,
    });
  };

  const buildSets = () => {
    const writerConfig: WriterConfig = writes ? { jira: writes } : {};
    return changeSets({
      db,
      writerConfig,
      readers:
        fixture && !writes
          ? { jira: fixtureFields(fixture, { site, edited: fixture.edits.length }) }
          : mode.kind === "window" && !writes
            ? { jira: disconnected }
            : {},
      people: { jira: async (id) => people().get(id) ?? null },
      specs,
      reviewBase: options.reviewBase,
      now,
      emit,
      log,
    });
  };
  // The writers are built with the change sets. Connecting Jira from the
  // window builds them again, into this same object, so everything holding
  // it writes to Jira from then on. Nothing can be applying then: with no
  // writer, no change set can be approved.
  const sets = buildSets();

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
    titler: options.titler ?? null,
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
    presentations: sources,
    asOf: () => asOf ?? now(),
    now,
    running: conversation.running,
    changeSets: sets,
    get writable() {
      return writes !== null;
    },
  });

  // What a change set created joins its thread's group, so later turns can
  // work on it (decision 0018); the group's working threads follow. A group
  // made for a thread from nothing takes the name of the first epic created
  // in it, unless the user has named it. A live index syncs, reading what
  // the change set wrote by key, as Jira's search finds a write only a while
  // after it: what landed shows at once, and what it deleted goes.
  const applied = async (set: ChangeSet) => {
    const thread = threads.get(set.threadId, now());
    if (thread) {
      const created = set.mutations.flatMap((m) =>
        m.target === null && m.applied ? [m.applied.item] : [],
      );
      const group = groups.get(thread.groupId);
      const epic = set.mutations.find((m) => m.op === "createEpic" && m.applied);
      const summary = (epic?.args as { summary?: unknown } | undefined)?.summary;
      const blank =
        group?.origin.kind === "thread" &&
        group.name === blankGroupName &&
        groups.region(group.id, group.version)?.items.length === 0;
      if (blank && typeof summary === "string")
        groups.rename(thread.groupId, nameOf(summary), "oriel");
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
    if (mode.kind === "fixture") return;
    for (const { applied: write } of set.mutations)
      if (write && isJira(write.item.id))
        written.set(write.item.stableId, {
          id: write.item.id,
          stableId: write.item.stableId,
          at: write.at,
        });
    await sync(false).catch((error: unknown) => log("sync failed", { error: String(error) }));
  };

  const jiraView = (): JiraView => ({
    connected:
      source &&
      (() => {
        const synced = index.source(workspaceId, "jira");
        return {
          site: writes?.site ?? site,
          project: writes?.project ?? fixture?.project.key ?? "",
          items: index.records(workspaceId, "jira", jiraAttrs).length,
          syncedAt: synced?.syncedAt ?? null,
        };
      })(),
    connectable: mode.kind === "window" && source === null,
  });
  // Connects Jira with the details the user typed: checked against the site
  // first, then synced, and kept only once both worked. The token goes into
  // a credential and the store, and nowhere else: not a log line, an event,
  // a reply or a message.
  let joining = false;
  const connectJira = async (
    typed: JiraDetails,
  ): Promise<{ jira: JiraView } | { problem: string }> => {
    if (mode.kind !== "window" || source)
      return { problem: "Jira is already connected to this window." };
    if (joining) return { problem: "Oriel is connecting Jira already." };
    const at = jiraSite(typed.site);
    if (!at) return { problem: "Type your Jira site, like yourteam.atlassian.net." };
    if (at !== throwawaySite)
      return { problem: `For now, Oriel connects only to ${new URL(throwawaySite).host}.` };
    const email = typed.email.trim();
    const project = typed.project.trim().toUpperCase();
    const chosen = writesTo({ site: at, email, token: typed.token.trim(), project }, mode.fetch);
    joining = true;
    try {
      const check = await checkConnection(transportTo(chosen), project).catch((error: unknown) => {
        log("jira check failed", { site: at, error: String(error) });
        return "unreachable" as const;
      });
      if (check !== "ok") {
        log("jira connect refused", { site: at, project, check });
        return { problem: refusals[check](project) };
      }
      const next = liveSource(chosen);
      const first = index.source(workspaceId, "jira") === null;
      try {
        await syncInto(next, jiraAttrs, true);
      } catch (error) {
        log("jira connect failed", { site: at, project, error: String(error) });
        return {
          problem: "Jira answered, but Oriel couldn't read the project just now. Try again.",
        };
      }
      try {
        mode.store.save({ site: at, email, token: typed.token.trim(), project });
      } catch (error) {
        log("jira connection not saved", { error: (error as NodeJS.ErrnoException).code ?? "" });
        return { problem: "Oriel couldn't save the connection on this computer. Try again." };
      }
      source = next;
      writes = chosen;
      Object.assign(sets, buildSets());
      if (first) jiraConnected();
      log("jira connected", { site: at, project });
      return { jira: jiraView() };
    } finally {
      joining = false;
    }
  };

  const window = (grouping: GroupingId) =>
    windowView(grouping, groupings[grouping], records(), asOf ?? now(), fixture !== null);

  return {
    workspaceId,
    window,
    jira: jiraView,
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
        if (mode.kind !== "fixture" && source)
          await sync(false).catch((error: unknown) => {
            log("sync failed", { error: String(error) });
            problems.push("Jira didn't answer, so Oriel couldn't look for new items.");
          });
        const folderProblem = folder ? await syncFolder() : null;
        if (folderProblem) problems.push(folderProblem);
        const slackProblem = await syncSlack();
        if (slackProblem) problems.push(slackProblem);
        return problems.length > 0 ? problems.join(" ") : null;
      },
      explain: (conflicts) => explainConflicts(conflicts, specs),
      jira: {
        view: jiraView,
        connect: connectJira,
        sync: async () => {
          const problem = await syncJira();
          synced("jira", problem);
          return problem ? { problem } : { jira: jiraView() };
        },
      },
      folder: {
        view: folderView,
        connect: connectFolder,
        sync: async () => {
          const problem = await syncFolder();
          if (folder) synced("folder", problem);
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
      conversation.stopTitles();
      await conversation.settled();
      await waiting;
      await syncing.catch(() => {});
      if (db.isOpen) db.close();
    },
  };
}

// The Slack source a mode reads from: the fixture's Web API with its picked
// channel, or Slack's, with the picked channels found by name or ID.
async function slackFrom(mode: SlackMode, log: Log): Promise<SlackSource> {
  if (mode.kind === "fixture") {
    const fixture = loadSlackFixture();
    return slackSource({
      api: fixtureApi(fixture).api,
      workspaceUrl: fixture.team.url,
      channels: fixture.picked,
      log,
    });
  }
  const api = webApi({ credential: mode.credential, ...(mode.fetch ? { fetch: mode.fetch } : {}) });
  const workspace = await connectSlack(api, mode.channels);
  if (workspace.missing.length)
    throw new Error(
      `Slack has no public channel Oriel can see named ${workspace.missing.map((name) => `#${name}`).join(", ")}`,
    );
  if (!workspace.channels.length) throw new Error("Pick at least one Slack channel to read");
  return slackSource({
    api,
    workspaceUrl: workspace.url,
    channels: workspace.channels.map((channel) => channel.id),
    log,
  });
}
