// The window's routes for each source, until the Connections story (OA-214)
// gives every connection one view and its routes, drawn from declarations:
// Jira's and the folder's connect forms, the projects Jira's details can
// see, each source's view and what a Sync of it gives back, and which kinds
// the window connects at all. Everything here goes through the server's one
// loop over connections (`Opening`), which knows no source.
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ActionInput, Log, Opened, SourceKind } from "@oriel/core";
import type { Connection } from "@oriel/db";
import { folderProblem, type FolderPath, resolveFolder } from "@oriel/folder";
import {
  basicAuth,
  checkConnection,
  issueCount,
  jiraAccount,
  jiraProject,
  type JiraProject,
  listProjects,
  readTransport,
} from "@oriel/jira";
import type { FolderView, JiraView, SlackView } from "@oriel/web/view";
import type { SourceOutcome } from "./actions.ts";
import { jiraSite, type LegacyJira, parsedLegacy } from "./connection.ts";
import type { Connections } from "./connections.ts";
import { throwawaySite } from "./env.ts";
import type { JiraMode } from "./modes.ts";

// What the server's loop over connections offers the window's routes.
export type Opening = {
  connections: Connections;
  // A kind's open connection, as the server opens one of each for now.
  opened(kind: SourceKind): { connection: Connection; opened: Opened } | null;
  // How many items the index has under a prefix, and when it last synced.
  synced(prefix: string): { items: number; syncedAt: string | null };
  // Connects what a person made, taking turns with the kind's syncs: opened,
  // synced in full, and kept only once both worked. The same thing as the
  // kind's open connection is synced again instead. `replaces`: it takes
  // the place of the kind's open connection. `counting` hears how many
  // records each page of its first sync read.
  connect(
    kind: SourceKind,
    made: { identity: string; options: Record<string, unknown>; secret?: string },
    how?: { replaces?: boolean; counting?: (records: number) => void },
  ): Promise<{ connection: Connection } | { failed: "open" | "sync" | "keep"; error: unknown }>;
  // A Sync the person asked for of the kind's open connection: null, or
  // what went wrong in their words.
  sync(kind: SourceKind): Promise<string | null>;
};

// Jira refused the email and API token typed: the help to make a new one
// stays on screen (OA-125, decision 0038).
const refusedCredentials =
  "Jira didn't accept these two together. Check the email is the one you sign in to Jira with. If it is, make a new one (step 2) and paste it here.";

// Why a connection the person typed wasn't kept, in their words.
const refusals: Record<
  "refused" | "no-project" | "unexpected" | "unreachable",
  (project: string) => string
> = {
  refused: () => refusedCredentials,
  "no-project": (project) =>
    `There's no project ${project} on that site that this account can see.`,
  unexpected: () => "Jira gave an answer Oriel didn't expect. Try again in a minute.",
  unreachable: () => "Oriel couldn't reach that address. Is it right?",
};

const notASite = "Type your Jira address, like yourteam.atlassian.net.";

export function windowSources(deps: { jira: JiraMode; opening: Opening; log: Log }) {
  const { jira: mode, opening, log } = deps;
  const { connections } = opening;
  const send = mode.kind === "window" && mode.fetch ? { fetch: mode.fetch } : {};
  const transportTo = (site: string, account: { email: string; token: string }) =>
    readTransport({ site, credential: basicAuth(account.email, account.token), ...send });
  // A site the window may connect: any Jira Cloud site on the desktop app,
  // else only the throwaway one.
  const siteAllowed = (at: string | null): at is string =>
    at !== null && (mode.kind === "window" && mode.anySite === true ? true : at === throwawaySite);
  const siteProblem = (at: string | null): string | null =>
    at === null
      ? notASite
      : siteAllowed(at)
        ? null
        : `For now, Oriel connects only to ${new URL(throwawaySite).host}.`;
  // The server opens a kind's first connection only, for now: a site other
  // than the one Jira's connection has, signed out since, is refused, as is
  // any after a first that was disconnected.
  const anotherSite = (at: string): string | null => {
    const existing = connections.first("jira");
    if (existing)
      return existing.identity === at
        ? null
        : `Oriel reads one Jira site for now, ${URL.parse(existing.identity)?.host ?? existing.identity}. Sign in to it again.`;
    const plan = connections.planned("jira", at);
    const number = "revives" in plan ? plan.revives.number : "number" in plan ? plan.number : 1;
    return number === 1 ? null : "Oriel reads one Jira site for now.";
  };

  // Jira's first sync while it reads, and after it stopped, until the next
  // connect or one that worked.
  let jiraReading: {
    project: string;
    read: number;
    total: number | null;
    stopped: boolean;
  } | null = null;

  const jira = (): JiraView => {
    const open = opening.opened("jira");
    return {
      connected: open && {
        site: open.connection.identity,
        project: jiraProject(open.connection.options),
        ...opening.synced(open.connection.prefix),
      },
      connectable: mode.kind === "window" && open === null,
    };
  };
  const folder = (): FolderView | null => {
    const open = opening.opened("folder");
    return open && { path: open.connection.identity, ...opening.synced(open.connection.prefix) };
  };
  const slack = (): SlackView | null => {
    const open = opening.opened("slack");
    return (
      open && {
        workspace: URL.parse(open.connection.identity)?.host ?? open.connection.identity,
        ...opening.synced(open.connection.prefix),
      }
    );
  };

  // Connects Jira with the details the person typed: checked against the
  // site first, then synced, and kept only once both worked. The token goes
  // into a credential and the store, and nowhere else: not a log line, an
  // event, a reply or a message.
  const connectJira = async (
    typed: Extract<ActionInput<"source.connect">, { kind: "jira" }>,
  ): Promise<SourceOutcome> => {
    if (mode.kind !== "window" || opening.opened("jira"))
      return { problem: "Jira is already connected to this window." };
    const at = jiraSite(typed.site);
    const refusedSite = siteProblem(at) ?? (at && anotherSite(at));
    if (refusedSite || !at) return { problem: refusedSite ?? notASite };
    const account = { email: typed.email.trim(), token: typed.token.trim() };
    const project = typed.project.trim().toUpperCase();
    const transport = transportTo(at, account);
    const check = await checkConnection(transport, project).catch((error: unknown) => {
      log("jira check failed", { site: at, error: String(error) });
      return "unreachable" as const;
    });
    if (check !== "ok") {
      log("jira connect refused", { site: at, project, check });
      return { problem: refusals[check](project) };
    }
    // The first sync counts what it reads, of the total Jira reports, for
    // the first run's progress (decision 0038).
    const reading = {
      project,
      read: 0,
      total: await issueCount(transport, project).catch(() => null),
      stopped: false,
    };
    jiraReading = reading;
    // Kept as its connection: the site it identifies, the project it reads,
    // and the account as its secret. Signing in to the same site again keeps
    // the connection, its number and its items.
    const made = await opening.connect(
      "jira",
      { identity: at, options: { project }, secret: JSON.stringify(account) },
      { counting: (records) => (reading.read += records) },
    );
    if ("failed" in made) {
      if (made.failed === "keep") {
        log("jira connection not saved", {
          error: (made.error as NodeJS.ErrnoException).code ?? "",
        });
        return { problem: "Oriel couldn't save the connection on this computer. Try again." };
      }
      reading.stopped = true;
      log("jira connect failed", { site: at, project, error: String(made.error) });
      return { problem: "Jira answered, but Oriel couldn't read the project just now. Try again." };
    }
    jiraReading = null;
    log("jira connected", { site: at, project });
    return { jira: jira() };
  };

  // The folder the person picked, read-only (decision 0019). Another takes
  // the place of the one connected: one connected before comes back under
  // its ID and number, and any other is a new connection, with the next.
  // Only a folder that synced is kept; one that can't be listed leaves the
  // one before as it was.
  const connectFolder = async (picked: string): Promise<SourceOutcome> => {
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
    const made = await opening.connect(
      "folder",
      { identity: real, options: {} },
      { replaces: true },
    );
    if ("failed" in made) {
      log("folder connect failed", { failed: made.failed });
      return {
        problem: made.failed === "sync" ? folderProblem() : "Oriel couldn't connect the folder.",
      };
    }
    const view = folder();
    return view ? { folder: view } : { problem: "No folder is connected." };
  };

  return {
    // The kinds whose kept connections the server opens at start: those the
    // window connects. The folder always; Jira unless a flag sets it up.
    kept: (kind: SourceKind): boolean =>
      kind === "folder" || (kind === "jira" && mode.kind === "window"),

    // How a kept connection's requests reach its source.
    fetch: (kind: SourceKind): typeof fetch | undefined =>
      kind === "jira" ? send.fetch : undefined,

    // Before any connection opens: Jira's saved connection from before
    // connections moves into one.
    async beforeOpen(): Promise<void> {
      if (mode.kind === "window" && mode.legacy) await moveLegacy(connections, mode.legacy, log);
    },

    // Whether a kept connection opens at start. A Jira one the site no
    // longer takes, as when its token was revoked, or to a site Oriel
    // doesn't connect to, stays shut, so the window asks for Jira again.
    // One that can't be reached now opens.
    async vet(connection: Connection, secret: string | null): Promise<boolean> {
      if (connection.kind !== "jira") return true;
      const account = secret === null ? null : jiraAccount(secret);
      if (!account) {
        log("jira: the connection has no account Oriel can read", {});
        return false;
      }
      const check = !siteAllowed(jiraSite(connection.identity))
        ? ("refused" as const)
        : await checkConnection(
            transportTo(connection.identity, account),
            jiraProject(connection.options),
          ).catch(() => "unreachable" as const);
      if (check === "refused" || check === "no-project") {
        log("jira: the saved connection was refused", { check });
        return false;
      }
      return true;
    },

    reading: () => jiraReading && { ...jiraReading },
    jira,
    folder,

    connect: (input: ActionInput<"source.connect">): Promise<SourceOutcome> =>
      input.kind === "folder" ? connectFolder(input.path) : connectJira(input),

    // A source as a Sync of it leaves it.
    synced(kind: SourceKind): SourceOutcome {
      if (kind === "jira") return { jira: jira() };
      const files = kind === "folder" ? folder() : null;
      if (files) return { folder: files };
      const messages = kind === "slack" ? slack() : null;
      return messages ? { slack: messages } : { problem: "It isn't connected to this window." };
    },

    // The projects the details typed can see, before any is connected, so
    // the person picks one from Jira's own list (decision 0038). Nothing is
    // kept, and the token goes only into the credential for these requests.
    async jiraProjects(typed: {
      site: string;
      email: string;
      token: string;
      query: string;
    }): Promise<
      | { projects: JiraProject[]; more: boolean }
      | { problem: string; fields: ("site" | "email" | "token")[] }
    > {
      if (mode.kind !== "window" || opening.opened("jira"))
        return { problem: "Jira is already connected to this window.", fields: [] };
      const at = jiraSite(typed.site);
      const refusedSite = siteProblem(at) ?? (at && anotherSite(at));
      if (refusedSite || !at) return { problem: refusedSite ?? notASite, fields: ["site"] };
      const transport = transportTo(at, { email: typed.email.trim(), token: typed.token.trim() });
      const listed = await listProjects(transport, typed.query).catch((error: unknown) => {
        log("jira projects failed", { site: at, error: String(error) });
        return { kind: "unreachable" as const };
      });
      if (listed.kind === "ok") return { projects: listed.projects, more: listed.more };
      log("jira projects refused", { site: at, why: listed.kind });
      if (listed.kind === "refused")
        return { problem: refusedCredentials, fields: ["email", "token"] };
      if (listed.kind === "unreachable")
        return { problem: refusals.unreachable(""), fields: ["site"] };
      return { problem: refusals.unexpected(""), fields: [] };
    },
  };
}

// Jira's saved connection from before connections (decision 0049) moves
// into one, its kind's first, with its account as the secret, and the old one
// is deleted. One that can't be read is left, and logged; a move that fails
// leaves it for the next start. Never a value in a log line.
async function moveLegacy(connections: Connections, legacy: LegacyJira, log: Log): Promise<void> {
  let text: string | null;
  try {
    text = await legacy.load();
  } catch {
    log("jira: the saved connection couldn't be read", {});
    return;
  }
  if (text === null) return;
  const saved = parsedLegacy(text);
  const site = saved && jiraSite(saved.site);
  if (!saved || !site) {
    log("jira: the saved connection isn't one Oriel can read", {});
    return;
  }
  try {
    // One a start before moved, and couldn't delete the old one after, is
    // kept as it is.
    if (!connections.first("jira"))
      await connections.connect({
        kind: "jira",
        identity: site,
        options: { project: saved.project },
        secret: JSON.stringify({ email: saved.email, token: saved.token }),
      });
    await legacy.delete();
    log("jira: the saved connection moved", {});
  } catch {
    log("jira: the saved connection couldn't move", {});
  }
}
