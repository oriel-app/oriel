// Making a Jira connection (decision 0049): the person types the site's
// address, the email they sign in to Jira with and an API token, then picks
// a project from the list Jira returns, so nobody types a project key
// (decision 0038). Each step's server half checks with the site before
// anything is kept. The token goes into a credential and the connection's
// secret, and nowhere else: not a log line, an event, a reply or a message.
// Under `pnpm dev` a live connection comes from `.env`, to the throwaway
// site only (SPEC §4).
import {
  type ConnectOf,
  type ConnectRefusal,
  type Infer,
  type LiveOf,
  boolean,
  object,
  optional,
  type OptionField,
  refine,
  string,
} from "@oriel/core";
import { checkConnection, issueCount, listProjects } from "./connect.ts";
import { jiraAccount, jiraProject } from "./open-connection.ts";
import { projectKey } from "./rest.ts";
import { basicAuth, readTransport } from "./transport.ts";

// The only site `pnpm dev` reads from and writes to (SPEC §4); the desktop
// app connects any Jira Cloud site (decision 0038).
export const throwawaySite = "https://oriel.atlassian.net";

// A Jira Cloud site as the user might type it: "acme", "acme.atlassian.net",
// or a link to any page on it. Its https origin, or null.
export function jiraSite(typed: string): string | null {
  const text = typed.trim().toLowerCase();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`;
  const url = URL.parse(withScheme);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.includes(".") ? url.hostname : `${url.hostname}.atlassian.net`;
  return /^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(host) ? `https://${host}` : null;
}

// What the person types. Its checks never quote a value.
const typed = (max: number, what: string) =>
  refine(string, (text) => text.trim() !== "" && text.length <= max, `expected ${what}`);
const details = {
  site: typed(200, "a site"),
  email: typed(254, "an email address"),
  token: typed(1024, "an API token"),
};
const given = object({ ...details, project: typed(32, "a project key") });
const listing = object(details);
type Details = { site: string; email: string; token: string };

// What a person sets per connection: the project it reads, picked again in
// Settings from Jira's list, and whether Oriel may propose changes to it.
export const jiraOptionFields = [
  { kind: "pick", name: "project", label: "Project" },
  { kind: "read-only", name: "readOnly" },
] as const satisfies readonly OptionField[];
// Through Atlassian's server, a connection with none reads the first
// project it lists (decision 0059); one Oriel connects itself always has one.
export const jiraOptions = object({
  readOnly: optional(boolean),
  project: optional(
    refine(string, (key) => key.length <= 32 && projectKey.test(key), "expected a project key"),
  ),
});

// Jira refused the email and API token typed: the help to make a new one
// stays on screen (OA-125, decision 0038).
const refusedCredentials =
  "Jira didn't accept these two together. Check the email is the one you sign in to Jira with. If it is, make a new one (step 2) and paste it here.";
const unexpected = "Jira gave an answer Oriel didn't expect. Try again in a minute.";
const unreachable = "Oriel couldn't reach that address. Is it right?";
const notASite = "Type your Jira address, like yourteam.atlassian.net.";

const account = (typed: Details) => ({ email: typed.email.trim(), token: typed.token.trim() });
const transportTo = (
  site: string,
  { email, token }: { email: string; token: string },
  send?: typeof fetch,
) => readTransport({ site, credential: basicAuth(email, token), ...(send ? { fetch: send } : {}) });

// The window's words for connecting Jira, OA-191's: its address, the email
// and an API token, with the three steps to make one on Atlassian's page,
// its expiry included. That label is the one place the word "token" shows
// (decision 0038). Then the project, from the list Jira returns.
export const jiraConnect = {
  steps: [
    {
      kind: "fields",
      label: "Your Jira account",
      title: "Connect Jira",
      lede: "Three things from your Jira account. Oriel keeps them encrypted on this Mac.",
      fields: [
        {
          name: "site",
          label: "Your Jira address",
          input: "url",
          placeholder: "yourteam.atlassian.net",
          hint: "The start of the address in your browser when Jira is open.",
        },
        {
          name: "email",
          label: "The email you sign in to Jira with",
          input: "email",
          placeholder: "you@company.com",
        },
        { name: "token", label: "API token", secret: true, placeholder: "Paste it here" },
      ],
      help: {
        intro:
          "Atlassian lets you make these for apps like Oriel. One has your Jira access and no more, Oriel changes Jira only when you approve, and you can delete it on Atlassian's page any time.",
        lines: [
          "[Open Atlassian's page for them](https://id.atlassian.com/manage-profile/security/api-tokens) (it opens in your browser).",
          "Click **Create**, name it **Oriel**, pick when it expires (a year is fine), and click **Create**.",
          "Click **Copy**, then paste it above. Atlassian shows it only once.",
        ],
      },
    },
    {
      kind: "pick",
      field: "project",
      label: "Jira projects",
      title: "Which Jira project?",
      lede: "Jira accepted your details. Pick the project you work in.",
      list: "Projects",
      find: "Find a project by its name or key",
      findLabel: "Find a project",
      none: "Jira accepted your details, but this account can't see any project. Ask your Jira admin for access, or use another account.",
      noMatch: "No project matches that.",
      counts: "issue",
      use: "Use this project",
    },
  ],
  offer: {
    firstRun: 1,
    mark: "J",
    title: "Jira",
    about: "Epics, stories and their details",
    counts: "issue",
    empty: "This project has no issues yet.",
    yours: "your Jira",
    changes: "Jira",
    follow: "an epic",
    ready: "Jira is ready.",
    catchUp: "Jira can catch up later.",
    invite: {
      note: "Your epics and stories show here. Oriel changes them only when you approve a change.",
      readOnly:
        "Oriel only reads folders. Ask about your notes now; to have Oriel draft changes for you to approve, connect Jira.",
      connected: "has no issues yet. Epics and stories made there show here when Oriel syncs Jira.",
    },
  },
  given,
  identify: async (typed, via) => {
    const at = jiraSite(typed.site);
    if (at === null) return { problem: notASite, fields: ["site"] };
    if (!via.anywhere && at !== throwawaySite)
      return {
        problem: `For now, Oriel connects only to ${new URL(throwawaySite).host}.`,
        fields: ["site"],
      };
    return at;
  },
  taken: (first, live): ConnectRefusal => {
    const host = URL.parse(first)?.host ?? first;
    return {
      problem: live
        ? `Oriel reads one Jira site for now, ${host}. Sign in to it again.`
        : `Oriel reads one Jira site for now: the first one connected, ${host}. Connect that one again.`,
      fields: ["site"],
    };
  },
  reads: ({ options }) => jiraProject(options),
  async make(typed, site, via) {
    const project = typed.project.trim().toUpperCase();
    const transport = transportTo(site, account(typed), via.fetch);
    const check = await checkConnection(transport, project).catch((error: unknown) => {
      via.log("jira check failed", { site, error: String(error) });
      return "unreachable" as const;
    });
    if (check !== "ok") {
      via.log("jira connect refused", { site, project, check });
      return {
        problem:
          check === "refused"
            ? refusedCredentials
            : check === "no-project"
              ? `There's no project ${project} on that site that this account can see.`
              : check === "unexpected"
                ? unexpected
                : unreachable,
      };
    }
    // The first sync counts what it reads, of the total Jira reports, for
    // the first run's progress (decision 0038).
    return {
      options: { project },
      secret: JSON.stringify(account(typed)),
      reading: { name: project, total: await issueCount(transport, project).catch(() => null) },
    };
  },
  failed: {
    open: "Jira answered, but Oriel couldn't read the project just now. Try again.",
    sync: "Jira answered, but Oriel couldn't read the project just now. Try again.",
  },
  // The projects the details typed can see, before any is connected.
  // Nothing is kept, and the token goes only into the credential for these
  // requests.
  pick: {
    given: listing,
    from(connection) {
      const kept = connection.secret === null ? null : jiraAccount(connection.secret);
      return kept && { site: connection.identity, ...kept };
    },
    async list(typed, site, query, via) {
      const listed = await listProjects(transportTo(site, account(typed), via.fetch), query).catch(
        (error: unknown) => {
          via.log("jira projects failed", { site, error: String(error) });
          return { kind: "unreachable" as const };
        },
      );
      if (listed.kind === "ok")
        return {
          choices: listed.projects.map((project) => ({
            value: project.key,
            name: project.name,
            count: project.issues,
            updatedAt: project.updatedAt,
          })),
          more: listed.more,
        };
      via.log("jira projects refused", { site, why: listed.kind });
      if (listed.kind === "refused")
        return { problem: refusedCredentials, fields: ["email", "token"] };
      if (listed.kind === "unreachable") return { problem: unreachable, fields: ["site"] };
      return { problem: unexpected, fields: [] };
    },
  },
  // A connection the site no longer takes, as when its token was revoked,
  // or to a site Oriel doesn't connect to, stays shut, so the window asks
  // for Jira again. One that can't be reached now opens.
  async vet(connection, via) {
    const kept = connection.secret === null ? null : jiraAccount(connection.secret);
    if (!kept) {
      via.log("jira: the connection has no account Oriel can read", {});
      return false;
    }
    const at = jiraSite(connection.identity);
    const check =
      at === null || (!via.anywhere && at !== throwawaySite)
        ? ("refused" as const)
        : await checkConnection(
            transportTo(at, kept, via.fetch),
            jiraProject(connection.options),
          ).catch(() => "unreachable" as const);
    if (check === "refused" || check === "no-project") {
      via.log("jira: the saved connection was refused", { check });
      return false;
    }
    return true;
  },
} satisfies ConnectOf<Infer<typeof given>, Details>;

// A live connection from `.env`: the throwaway site, as the account it
// names, reading `project`, SYN unless a flag names another.
export const jiraLive = {
  env: ["JIRA_SITE", "JIRA_EMAIL", "JIRA_API_TOKEN"],
  connection(env, options) {
    const { JIRA_SITE: site, JIRA_EMAIL: email, JIRA_API_TOKEN: token } = env;
    if (!site || !email || !token)
      return { problem: "JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN must all be set in .env" };
    if (!URL.canParse(site) || new URL(site).origin !== throwawaySite)
      return { problem: `JIRA_SITE must be the throwaway site, ${throwawaySite}` };
    const project = options.project ?? "SYN";
    if (!projectKey.test(project)) return { problem: "a Jira project is its key, such as SYN" };
    return {
      identity: throwawaySite,
      options: { project },
      secret: JSON.stringify({ email, token }),
    };
  },
} satisfies LiveOf;
