// What a person sets on a Jira connection, and how the window offers Jira
// and names what a connection reads. Jira turns on through Atlassian's own
// MCP server in the person's agent (decision 0059), so nothing here asks
// for an address or an account: a person picks the project through the
// server.
import {
  boolean,
  type ConnectOffer,
  object,
  optional,
  type OptionField,
  refine,
  string,
} from "@oriel/core";
import { jiraProject } from "./open-connection.ts";
import { projectKey } from "./rest.ts";

// What a person sets per connection beside the project they pick through
// Atlassian's server: whether Oriel may propose changes to it.
export const jiraOptionFields = [
  { kind: "read-only", name: "readOnly" },
] as const satisfies readonly OptionField[];
// Through Atlassian's server, a connection with none reads the first
// project it lists (decision 0059).
export const jiraOptions = object({
  readOnly: optional(boolean),
  project: optional(
    refine(string, (key) => key.length <= 32 && projectKey.test(key), "expected a project key"),
  ),
});

// How the window offers Jira, OA-191's words.
export const jiraOffer: ConnectOffer = {
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
};

// What a connection reads: its project.
export const jiraReads = ({ options }: { options: Readonly<Record<string, unknown>> }): string =>
  jiraProject(options);
