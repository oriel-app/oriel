// Connecting Jira, the same in the first run and the window (decision 0038):
// its address, the email the person signs in with and an API token, with
// the three steps to make one on Atlassian's page, its expiry included. That
// label is the one place the word "token" shows. Then the project, picked
// from the list Jira returns. A refusal names its fields and keeps the steps
// on screen (OA-125).
import type { ComponentChildren } from "preact";
import type { JiraField, JiraModel, JiraMsg } from "./jira.ts";
import { jiraReady } from "./jira.ts";
import { plural } from "./parts.tsx";

const atlassianPage = "https://id.atlassian.com/manage-profile/security/api-tokens";

export function JiraDetails(props: {
  jira: JiraModel;
  send(msg: JiraMsg): void;
  // What sits beside Connect, such as Back.
  actions?: ComponentChildren;
}) {
  const { jira, send } = props;
  const field = (name: JiraField, label: string, input: Record<string, string>, hint?: string) => {
    const wrong = jira.fields.includes(name);
    return (
      <label class="jira-field">
        <span class="jira-label">{label}</span>
        <input
          class="input"
          name={name}
          value={jira.typed[name]}
          spellcheck={false}
          autoCapitalize="off"
          aria-invalid={wrong || undefined}
          {...input}
          onInput={(event) =>
            send({ type: "fieldChanged", field: name, value: event.currentTarget.value })
          }
        />
        {hint && <span class="jira-hint">{hint}</span>}
      </label>
    );
  };
  return (
    <form
      class="jira-details"
      aria-label="Your Jira account"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: "listClicked" });
      }}
    >
      <div class="jira-fields">
        {field(
          "site",
          "Your Jira address",
          { type: "text", placeholder: "yourteam.atlassian.net", autoComplete: "url" },
          "The start of the address in your browser when Jira is open.",
        )}
        {field("email", "The email you sign in to Jira with", {
          type: "email",
          placeholder: "you@company.com",
          autoComplete: "email",
        })}
        {field("token", "API token", {
          type: "password",
          placeholder: "Paste it here",
          autoComplete: "off",
        })}
        {jira.problem && jira.projects === null && (
          <p class="jira-problem" role="alert">
            {jira.problem}
          </p>
        )}
      </div>
      <div class="jira-help">
        <p>
          Atlassian lets you make these for apps like Oriel. One has your Jira access and no more,
          Oriel changes Jira only when you approve, and you can delete it on Atlassian's page any
          time.
        </p>
        <ol>
          <li>
            <a href={atlassianPage} target="_blank" rel="noreferrer">
              Open Atlassian's page for them
            </a>{" "}
            (it opens in your browser).
          </li>
          <li>
            Click <strong>Create</strong>, name it <strong>Oriel</strong>, pick when it expires (a
            year is fine), and click <strong>Create</strong>.
          </li>
          <li>
            Click <strong>Copy</strong>, then paste it above. Atlassian shows it only once.
          </li>
        </ol>
      </div>
      <div class="jira-actions">
        {props.actions}
        <button
          type="submit"
          class="button primary"
          disabled={jira.pending !== null || !jiraReady(jira)}
        >
          {jira.pending === "listing" ? "Connecting…" : "Connect"}
        </button>
      </div>
    </form>
  );
}

const changed = (at: string | null) =>
  at
    ? ` · changed ${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";

export function JiraProjects(props: {
  jira: JiraModel;
  send(msg: JiraMsg): void;
  actions?: ComponentChildren;
}) {
  const { jira, send } = props;
  const projects = jira.projects ?? [];
  const picked = projects.find((p) => p.key === jira.picked);
  return (
    <form
      class="jira-projects"
      aria-label="Jira projects"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: "connectClicked" });
      }}
    >
      {(jira.more || jira.query !== "") && (
        <input
          class="input"
          type="search"
          value={jira.query}
          placeholder="Find a project by its name or key"
          aria-label="Find a project"
          onChange={(event) => send({ type: "queryChanged", query: event.currentTarget.value })}
        />
      )}
      {projects.length === 0 ? (
        <p class="jira-empty">
          {jira.query
            ? "No project matches that."
            : "Jira accepted your details, but this account can't see any project. Ask your Jira admin for access, or use another account."}
        </p>
      ) : (
        <ul class="choice-rows" role="radiogroup" aria-label="Projects">
          {projects.map((project) => (
            <li key={project.key} data-picked={project.key === jira.picked || undefined}>
              <label class="choice-row">
                <input
                  type="radio"
                  name="jira-project"
                  value={project.key}
                  checked={project.key === jira.picked}
                  onChange={() => send({ type: "projectPicked", key: project.key })}
                />
                <span class="choice-text">
                  <span class="choice-name">{project.name}</span>
                  <span class="choice-detail">
                    {project.key}
                    {project.issues !== null && ` · ${plural(project.issues, "issue")}`}
                    {changed(project.updatedAt)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {jira.problem && (
        <p class="jira-problem" role="alert">
          {jira.problem}
        </p>
      )}
      <div class="jira-actions">
        {props.actions}
        <button
          type="submit"
          class="button primary"
          disabled={jira.pending !== null || picked === undefined}
        >
          {jira.pending === "connecting"
            ? "Connecting…"
            : picked
              ? `Use ${picked.name}`
              : "Use this project"}
        </button>
      </div>
    </form>
  );
}
