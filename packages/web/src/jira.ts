// Jira from the window and the first run: its address, the email the person
// signs in to Jira with and an API token Atlassian gives them; then the
// project, picked from the list Jira returns, so nobody types a project key
// (decision 0038). Nothing is kept until a project is connected, and once it
// is, nothing typed stays in the page. Syncing it is the sidebar's, as for
// every source.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { JiraProjectView, JiraView } from "./view.ts";

export const jiraFields = ["site", "email", "token"] as const;
export type JiraField = (typeof jiraFields)[number];

export type JiraModel = {
  // Jira as the server has it; null before it has loaded.
  view: JiraView | null;
  typed: Readonly<Record<JiraField, string>>;
  // The projects the details can see, once Jira listed them; `more`: Jira
  // has others, which a search finds.
  projects: JiraProjectView[] | null;
  more: boolean;
  query: string;
  picked: string | null;
  // Listing the projects, or connecting one, which reads it whole first.
  pending: "listing" | "connecting" | null;
  // The project being connected, or the last one tried, for its progress.
  connecting: string | null;
  // Why the last step didn't work, and the fields it named.
  problem: string | null;
  fields: readonly JiraField[];
};

export type JiraMsg =
  | { type: "fieldChanged"; field: JiraField; value: string }
  // The details are done: Jira lists what they can see.
  | { type: "listClicked" }
  | { type: "queryChanged"; query: string }
  | { type: "projectPicked"; key: string }
  | { type: "connectClicked" }
  // Back from the list to the details, which stay as typed.
  | { type: "changeClicked" };

export const loadJira: Effect = get("/api/jira", { kind: "jira" });

const blank = { site: "", email: "", token: "" };

export function initJira(): JiraModel {
  return {
    view: null,
    typed: blank,
    projects: null,
    more: false,
    query: "",
    picked: null,
    pending: null,
    connecting: null,
    problem: null,
    fields: [],
  };
}

export const jiraReady = (model: JiraModel) =>
  jiraFields.every((field) => model.typed[field].trim() !== "");

const listing = (model: JiraModel): [JiraModel, Effect[]] => [
  { ...model, pending: "listing", problem: null, fields: [] },
  [post("/api/jira/projects", { ...model.typed, query: model.query }, { kind: "jiraProjects" })],
];

export function updateJira(model: JiraModel, msg: JiraMsg): [JiraModel, Effect[]] {
  switch (msg.type) {
    case "fieldChanged":
      return [
        {
          ...model,
          typed: { ...model.typed, [msg.field]: msg.value },
          fields: model.fields.filter((field) => field !== msg.field),
        },
        [],
      ];
    case "listClicked":
      if (model.pending || !jiraReady(model)) return [model, []];
      return listing({ ...model, query: "" });
    case "queryChanged":
      return listing({ ...model, query: msg.query });
    case "projectPicked":
      return [{ ...model, picked: msg.key }, []];
    case "connectClicked": {
      if (model.pending || model.picked === null) return [model, []];
      return [
        { ...model, pending: "connecting", connecting: model.picked, problem: null },
        [post("/api/jira", { ...model.typed, project: model.picked }, { kind: "jiraConnected" })],
      ];
    }
    case "changeClicked":
      return [{ ...model, projects: null, picked: null, problem: null }, []];
  }
}

// A reply about Jira. `synced` says the index changed, so what's on screen
// should load again. Once connected, nothing typed is kept.
export function jiraReplied(model: JiraModel, msg: Replied): { model: JiraModel; synced: boolean } {
  const { tag } = msg;
  if (tag.kind === "jira")
    return {
      model: msg.ok ? { ...model, view: (msg.body as { jira: JiraView }).jira } : model,
      synced: false,
    };
  if (tag.kind === "jiraProjects") {
    if (!msg.ok) {
      const { fields } = (msg.body ?? {}) as { fields?: JiraField[] };
      return {
        model: { ...model, pending: null, problem: errorOf(msg.body), fields: fields ?? [] },
        synced: false,
      };
    }
    const { projects, more } = msg.body as { projects: JiraProjectView[]; more: boolean };
    // The likeliest is the one changed last, which the list puts first.
    const picked = projects.some((p) => p.key === model.picked)
      ? model.picked
      : (projects[0]?.key ?? null);
    return { model: { ...model, pending: null, projects, more, picked }, synced: false };
  }
  if (tag.kind !== "jiraConnected") return { model, synced: false };
  if (!msg.ok)
    return { model: { ...model, pending: null, problem: errorOf(msg.body) }, synced: false };
  const { jira } = msg.body as { jira: JiraView };
  return { model: { ...initJira(), view: jira }, synced: true };
}

// Jira connected to a project with no issues, which the window says, so an
// empty window doesn't look as if Jira isn't connected. Only once a sync has
// read the project: before that, Oriel doesn't know it's empty.
export const emptyJira = (view: JiraView | null) =>
  view?.connected?.items === 0 && view.connected.syncedAt !== null ? view.connected : null;

// The project picked, as the list showed it.
export const pickedProject = (model: JiraModel): JiraProjectView | null =>
  model.projects?.find((p) => p.key === (model.connecting ?? model.picked)) ?? null;
