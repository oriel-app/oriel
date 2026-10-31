// Connecting Jira from the window: its site, the user's email, the API token
// Atlassian gave them, and the project. Shown only while Jira can be
// connected here, which is until it is.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { JiraView } from "./view.ts";

export const jiraFields = ["site", "email", "token", "project"] as const;
export type JiraField = (typeof jiraFields)[number];

export type JiraModel = {
  // Jira as the server has it; null before it has loaded.
  view: JiraView | null;
  typed: Readonly<Record<JiraField, string>>;
  pending: boolean;
  problem: string | null;
};

export type JiraMsg =
  | { type: "fieldChanged"; field: JiraField; value: string }
  | { type: "connectClicked" };

export const loadJira: Effect = get("/api/jira", { kind: "jira" });

const blank = { site: "", email: "", token: "", project: "" };

export function initJira(): JiraModel {
  return { view: null, typed: blank, pending: false, problem: null };
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
  }
}

// A reply about Jira. `synced` says its items are in the index now, so the
// window should load again. Once connected, nothing typed is kept.
export function jiraReplied(model: JiraModel, msg: Replied): { model: JiraModel; synced: boolean } {
  const { tag } = msg;
  if (tag.kind === "jira")
    return {
      model: msg.ok ? { ...model, view: (msg.body as { jira: JiraView }).jira } : model,
      synced: false,
    };
  if (tag.kind !== "jiraConnected") return { model, synced: false };
  if (!msg.ok)
    return { model: { ...model, pending: false, problem: errorOf(msg.body) }, synced: false };
  const { jira } = msg.body as { jira: JiraView };
  return { model: { view: jira, typed: blank, pending: false, problem: null }, synced: true };
}
