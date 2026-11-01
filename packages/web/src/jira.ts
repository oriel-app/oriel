// Jira from the window: connecting it with its site, the user's email, the
// API token Atlassian gave them, and the project, which is offered only
// until it's connected; then syncing it again on demand, so what was made
// or deleted there since shows.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { JiraView } from "./view.ts";

export const jiraFields = ["site", "email", "token", "project"] as const;
export type JiraField = (typeof jiraFields)[number];

export type JiraModel = {
  // Jira as the server has it; null before it has loaded.
  view: JiraView | null;
  typed: Readonly<Record<JiraField, string>>;
  // Connecting.
  pending: boolean;
  syncing: boolean;
  // Why connecting or syncing didn't work. Only one is on offer at a time.
  problem: string | null;
};

export type JiraMsg =
  | { type: "fieldChanged"; field: JiraField; value: string }
  | { type: "connectClicked" }
  | { type: "syncClicked" };

export const loadJira: Effect = get("/api/jira", { kind: "jira" });

const blank = { site: "", email: "", token: "", project: "" };

export function initJira(): JiraModel {
  return { view: null, typed: blank, pending: false, syncing: false, problem: null };
}

export const jiraReady = (model: JiraModel) =>
  jiraFields.every((field) => model.typed[field].trim() !== "");

export function updateJira(model: JiraModel, msg: JiraMsg): [JiraModel, Effect[]] {
  switch (msg.type) {
    case "fieldChanged":
      return [{ ...model, typed: { ...model.typed, [msg.field]: msg.value } }, []];
    case "connectClicked":
      if (model.pending || !jiraReady(model)) return [model, []];
      return [
        { ...model, pending: true, problem: null },
        [post("/api/jira", model.typed, { kind: "jiraConnected" })],
      ];
    case "syncClicked":
      if (model.syncing || !model.view?.connected) return [model, []];
      return [
        { ...model, syncing: true, problem: null },
        [post("/api/jira/sync", {}, { kind: "jiraSynced" })],
      ];
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
  if (tag.kind !== "jiraConnected" && tag.kind !== "jiraSynced") return { model, synced: false };
  const settled = tag.kind === "jiraConnected" ? { pending: false } : { syncing: false };
  if (!msg.ok)
    return { model: { ...model, ...settled, problem: errorOf(msg.body) }, synced: false };
  const { jira } = msg.body as { jira: JiraView };
  const typed = tag.kind === "jiraConnected" ? blank : model.typed;
  return { model: { ...model, ...settled, view: jira, typed, problem: null }, synced: true };
}

// Jira connected to a project with no issues, which the window says, so an
// empty window doesn't look as if Jira isn't connected. Only once a sync has
// read the project: before that, Oriel doesn't know it's empty.
export const emptyJira = (view: JiraView | null) =>
  view?.connected?.items === 0 && view.connected.syncedAt !== null ? view.connected : null;
