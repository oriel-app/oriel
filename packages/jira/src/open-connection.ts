// A Jira connection, opened (decision 0049): its site is what identifies it,
// its options name the project it reads, and its secret is the account, its
// email and API token. The source, its namespace and its writer share one
// answer to what each board estimates in, which each sync refreshes.
import {
  type Credential,
  object,
  type Opened,
  OptionsUnfit,
  type OpenVia,
  SourceRefused,
  string,
  type ThroughServer,
  type ToolCaller,
  type ToOpen,
} from "@oriel/core";
import {
  atlassianTools,
  atlassianTransport,
  projectsOf,
  ServerUnreadable,
  siteOf,
} from "./atlassian.ts";
import { jiraAttrs } from "./attrs.ts";
import { type JiraBoards, jiraBoards } from "./boards.ts";
import type { Estimates } from "./namespace.ts";
import type { JiraScope } from "./references.ts";
import { UnexpectedAnswer } from "./rest.ts";
import { jiraSource } from "./source.ts";
import { basicAuth, JiraFailed, readOnly, readTransport } from "./transport.ts";

// What a Jira connection's writer is built from, by its line in
// packages/changeset/src/writers.ts.
export type JiraWrites = {
  // An https origin, such as "https://oriel.atlassian.net".
  site: string;
  // Its account's, or, through a source server, the server's tools: the
  // site's cloud ID, which every call names, its reads and its writes
  // (decision 0059).
  credential?: Credential;
  through?: { cloudId: string; read: ToolCaller; write: ToolCaller };
  // Where a story with no epic is created.
  project: string;
  // How requests reach the site: the global fetch unless given, as tests
  // give one that answers from memory.
  fetch?: typeof fetch;
  // What each board estimates in, shared with the source that syncs it.
  // Without it, the writer finds each board's once.
  boards?: JiraBoards;
};

export type OpenedJira = Opened<Estimates, JiraScope, JiraWrites>;

// How long Jira's search may take to find a write; it is usually seconds.
const searchLagMs = 10 * 60 * 1000;

const accountShape = object({ email: string, token: string });

// The account a connection keeps as its secret, or null. JSON.parse's own
// message quotes the text, which holds the token, so it's never passed on.
export function jiraAccount(secret: string): { email: string; token: string } | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(secret) as unknown;
  } catch {
    return null;
  }
  const read = accountShape(parsed);
  return read.ok ? read.value : null;
}

// The project a connection reads, from its options.
export const jiraProject = (options: Readonly<Record<string, unknown>>): string =>
  typeof options.project === "string" ? options.project : "";

export async function openJira(connection: ToOpen, via: OpenVia): Promise<OpenedJira> {
  if (via.server) return openThrough(connection, via, via.server);
  const account = connection.secret === null ? null : jiraAccount(connection.secret);
  if (!account) throw new Error("the connection has no account Oriel can read");
  const site = connection.identity;
  const project = jiraProject(connection.options);
  if (!project) throw new OptionsUnfit("Pick a Jira project to read");
  const credential = basicAuth(account.email, account.token);
  const send = via.fetch ? { fetch: via.fetch } : {};
  const transport = readTransport({ site, credential, ...send });
  const boards = jiraBoards({ transport, projects: [project], log: via.log });
  return {
    source: jiraSource({ transport, site, projects: [project], log: via.log, boards }),
    attrs: jiraAttrs,
    about: `${project} on ${URL.parse(site)?.host ?? site}`,
    scope: { projects: [project] },
    // What the last sync found on the boards; nothing before one.
    context: () => ({ none: boards.unestimating() ?? new Set(), home: project }),
    writes: { site, credential, project, boards, ...send },
    incremental: true,
    lagMs: searchLagMs,
    problem: (error) => jiraProblem(error, via.kept),
  };
}

// What the person sees when Jira can't be synced. A sync that fails marks
// nothing gone; pages it had already read stay, as they're what Jira said.
export function jiraProblem(error: unknown, kept: boolean): string {
  if (
    error instanceof SourceRefused ||
    (error instanceof JiraFailed && [401, 403].includes(error.status))
  )
    // A connection made in the window is signed out at the next start if
    // Jira still refuses the account, as it does a revoked token, and the
    // window asks for Jira again. One refused only the project's search is
    // kept.
    return kept
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
}

// A Jira connection through the source server Jira is on through (decision
// 0059): the site the server reaches, the one the connection names if it
// names one, else its first with Jira, and the project in its options, else
// the first the server lists. Every read goes through the server's read
// tools, and the writer, built only in packages/changeset, through its
// write tools, in another process.
async function openThrough(
  connection: ToOpen,
  via: OpenVia,
  server: ThroughServer,
): Promise<OpenedJira> {
  const named = URL.canParse(connection.identity) ? new URL(connection.identity).origin : null;
  const site = siteOf(await server.read({ tool: atlassianTools.resources, args: {} }), named);
  if (!site) throw new Error(`${server.known.name} reaches no Jira site Oriel can read`);
  const project =
    jiraProject(connection.options) ||
    projectsOf(
      await server.read({ tool: atlassianTools.projects, args: { cloudId: site.cloudId } }),
    )[0];
  if (!project) throw new Error(`${server.known.name} lists no Jira project`);
  const transport = readOnly(atlassianTransport({ cloudId: site.cloudId, read: server.read }));
  const boards = jiraBoards({ transport, projects: [project], log: via.log });
  const source = jiraSource({
    transport,
    site: site.url,
    projects: [project],
    log: via.log,
    boards,
    whole: true,
  });
  return {
    source,
    attrs: jiraAttrs,
    identity: site.url,
    about: `${project} on ${URL.parse(site.url)?.host ?? site.url}, through ${server.known.name}`,
    scope: { projects: [project] },
    context: () => ({ none: boards.unestimating() ?? new Set(), home: project }),
    writes: {
      site: site.url,
      project,
      boards,
      through: { cloudId: site.cloudId, read: server.read, write: server.write },
    },
    incremental: true,
    lagMs: searchLagMs,
    problem: (error) => serverProblem(error, server.known.name),
  };
}

// What the person sees when Jira can't be synced through its server, naming
// it. A sync that fails this way keeps the index as it was.
export function serverProblem(error: unknown, server: string): string {
  if (error instanceof ServerUnreadable || error instanceof UnexpectedAnswer)
    return `${server} answered in a way Oriel didn't expect, so Oriel kept the window as it was.`;
  if (
    error instanceof SourceRefused ||
    (error instanceof JiraFailed && [401, 403].includes(error.status))
  )
    return `${server} turned Oriel away, so the window may be behind Jira. Sign in to it again in your agent.`;
  return `Oriel couldn't sync Jira through ${server}, so the window may be behind it. Try again in a moment.`;
}
