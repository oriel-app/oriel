// The window: clusters under a grouping, and items to pick into a group.
// Controls stay out of the way until something is picked or hovered.
import type { AccessibleInputHTMLAttributes, ComponentChildren } from "preact";
import { emptyJira, type JiraField, type JiraModel, type JiraMsg, jiraReady } from "./jira.ts";
import {
  Assignee,
  Chevron,
  type Dispatch,
  keyLabel,
  Link,
  plural,
  points,
  Replies,
} from "./parts.tsx";
import { type Model, type Msg as WindowMsg, pickedName, type Zoom, zoomOf } from "./update.ts";
import {
  type ClusterRow,
  type ClusterView,
  type GroupingId,
  groupingIds,
  type GroupSummary,
  type ItemRow,
  type WindowView,
} from "./view.ts";

const groupingNames: Record<GroupingId, string> = {
  epic: "Epic",
  assignee: "Assignee",
  stuck: "Stuck",
};

export function WindowPage(props: {
  model: Model;
  groups: GroupSummary[] | null;
  jira: JiraModel;
  dispatch: Dispatch;
}) {
  const { model, groups, jira, dispatch } = props;
  const adding = groups?.find((group) => group.id === model.addTo) ?? null;
  const empty = emptyJira(jira.view);
  return (
    <div class="window-layout">
      <main class="window" aria-busy={model.status === "loading"}>
        <div class="window-head">
          <Tabs
            picked={model.grouping}
            onPick={(grouping) =>
              dispatch({ type: "window", msg: { type: "groupingPicked", grouping } })
            }
          />
          {model.window && <Counts view={model.window} />}
        </div>
        {adding && (
          <p class="adding" role="status">
            Pick items to add to <strong>{adding.name}</strong>.
          </p>
        )}
        {jira.view?.connectable && <ConnectJira jira={jira} dispatch={dispatch} />}
        {empty && <EmptyJira site={empty.site} project={empty.project} />}
        <Body model={model} dispatch={dispatch} />
      </main>
      <Selection model={model} groups={groups} adding={adding} dispatch={dispatch} />
    </div>
  );
}

// Until Jira is connected, the window asks for it first: the one place the
// onboarding names the token, in its field's label.
function ConnectJira({ jira, dispatch }: { jira: JiraModel; dispatch: Dispatch }) {
  const send = (msg: JiraMsg) => dispatch({ type: "jira", msg });
  const field = (
    name: JiraField,
    label: string,
    input: AccessibleInputHTMLAttributes<HTMLInputElement>,
    hint?: ComponentChildren,
  ) => (
    <label class="jira-field">
      <span>{label}</span>
      <input
        name={name}
        value={jira.typed[name]}
        spellcheck={false}
        autoCapitalize="off"
        {...input}
        onInput={(event) =>
          send({ type: "fieldChanged", field: name, value: event.currentTarget.value })
        }
      />
      {hint && <span class="jira-hint">{hint}</span>}
    </label>
  );
  return (
    <form
      class="connect-jira"
      aria-labelledby="connect-jira-title"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: "connectClicked" });
      }}
    >
      <h2 id="connect-jira-title">Connect Jira</h2>
      <p class="connect-note">
        Your epics and stories show here. Oriel changes them only when you approve a change.
      </p>
      <div class="jira-fields">
        {field("site", "Site", {
          type: "text",
          placeholder: "yourteam.atlassian.net",
          autoComplete: "url",
        })}
        {field("project", "Project key", { type: "text", placeholder: "OA", autoComplete: "off" })}
        {field("email", "Your Atlassian email", { type: "email", autoComplete: "email" })}
        {field(
          "token",
          "API token",
          { type: "password", autoComplete: "off" },
          <>
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noreferrer"
            >
              Make one in your Atlassian account
            </a>
            , then paste it here.
          </>,
        )}
      </div>
      <div class="connect-actions">
        <button type="submit" class="button primary" disabled={jira.pending || !jiraReady(jira)}>
          {jira.pending ? "Connecting…" : "Connect"}
        </button>
        {jira.problem && (
          <p class="connect-problem" role="alert">
            {jira.problem}
          </p>
        )}
      </div>
    </form>
  );
}

// Jira connected to a project with no issues yet: said in its place, so the
// window doesn't look as if the connection failed.
function EmptyJira({ site, project }: { site: string; project: string }) {
  return (
    <section class="empty-jira" aria-labelledby="empty-jira-title">
      <h2 id="empty-jira-title">
        <span class="connected-dot" aria-hidden="true" />
        Jira is connected
      </h2>
      <p class="connect-note">
        <strong>{project}</strong> on {site.replace(/^https?:\/\//, "")} has no issues yet. Epics
        and stories made there show here when Oriel syncs Jira.
      </p>
    </section>
  );
}

function Tabs(props: { picked: GroupingId; onPick(grouping: GroupingId): void }) {
  return (
    <div class="tabs" role="group" aria-label="Group by">
      {groupingIds.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={id === props.picked}
          onClick={() => props.onPick(id)}
        >
          {groupingNames[id]}
        </button>
      ))}
    </div>
  );
}

function Counts({ view }: { view: WindowView }) {
  const asOf = new Date(view.asOf).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <p class="counts">
      {plural(view.items, "item")} in {plural(view.clusters.length, "cluster")}
      {view.fixture && (
        <span class="fixture" title="Synthetic fixture data, not your index">
          Fixture · {asOf}
        </span>
      )}
    </p>
  );
}

function Body({ model, dispatch }: { model: Model; dispatch: Dispatch }) {
  const failed = model.status === "failed" && (
    <div class="failed" role="alert">
      <span>The window didn't load.</span>
      <button
        type="button"
        class="button"
        onClick={() => dispatch({ type: "window", msg: { type: "retryClicked" } })}
      >
        Try again
      </button>
    </div>
  );
  if (model.window === null) return failed || <p class="loading">Loading…</p>;
  const shown = model.window;
  const stale = shown.grouping !== model.grouping;
  const derived = shown.clusters.some(({ row }) => row.origin.kind === "derived");
  // Headings make room for an anchor's checkbox once any cluster has one, so
  // they line up.
  const anchored = shown.clusters.some(({ row }) => row.anchor !== null);
  return (
    <>
      {failed}
      {derived && (
        <p class="derived-note">
          <span class="derived-tag">Oriel rule</span>
          marks a cluster Oriel made, which the source doesn't have. Each one shows its rule.
        </p>
      )}
      <div
        class={stale ? "clusters stale" : "clusters"}
        data-grouping={shown.grouping}
        data-picking={model.selected.length > 0 || model.addTo !== null ? "" : undefined}
        data-anchored={anchored ? "" : undefined}
        inert={stale}
      >
        {shown.clusters.map((view) => (
          <Cluster
            key={view.row.key}
            view={view}
            zoom={zoomOf(model, view.row.key)}
            selected={model.selected}
            pending={model.pending}
            dispatch={dispatch}
          />
        ))}
      </div>
    </>
  );
}

function Cluster(props: {
  view: ClusterView;
  zoom: Zoom;
  selected: readonly string[];
  pending: boolean;
  dispatch: Dispatch;
}) {
  const { view, zoom, dispatch } = props;
  const { row, list } = view;
  const open = zoom === "list";
  const listId = `items-${row.key}`;
  const { anchor } = row;
  const picked = anchor !== null && props.selected.includes(anchor.id);
  return (
    <section class="cluster" data-zoom={zoom}>
      <h2 class={picked ? "cluster-head picked" : "cluster-head"}>
        {/* The anchor (the epic) is an item too, picked here: the heading is
            where it shows, at both zoom levels, so it never shows twice. */}
        {anchor && (
          <label class="pick anchor-pick" title={`Pick ${anchor.key} itself, not its items`}>
            <input
              type="checkbox"
              checked={picked}
              aria-label={`Pick ${anchor.title}`}
              onChange={() =>
                dispatch({ type: "window", msg: { type: "itemToggled", id: anchor.id } })
              }
            />
          </label>
        )}
        <button
          type="button"
          class="cluster-toggle"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() =>
            dispatch({ type: "window", msg: { type: "clusterToggled", key: row.key } })
          }
        >
          <Chevron />
          <span class="cluster-name">
            <span class="cluster-label">{row.label}</span>
            {anchor && <span class="key">{anchor.key}</span>}
          </span>
          <span class="cluster-details">
            <Origin origin={row.origin} />
            <span class="cluster-meta">
              <span class="count">{plural(row.count, "item")}</span>
              <ClusterPoints row={row} />
              <StatusBar status={row.status} />
            </span>
          </span>
        </button>
        <button
          type="button"
          class="quiet-action make-group"
          disabled={props.pending}
          title={`Make a group of ${row.label}'s items as they are now`}
          onClick={() =>
            dispatch({ type: "window", msg: { type: "clusterGrouped", key: row.key } })
          }
        >
          Make group
        </button>
      </h2>
      {open && <Items id={listId} items={list} selected={props.selected} dispatch={dispatch} />}
    </section>
  );
}

function Origin({ origin }: { origin: ClusterRow["origin"] }) {
  if (origin.kind === "source") {
    return (
      <span class="origin" title={`This cluster is in ${origin.source}`}>
        {origin.source}
      </span>
    );
  }
  return (
    <span class="origin derived" title="Oriel made this cluster; the source doesn't have it">
      <span class="derived-tag">Oriel rule</span>
      {origin.rule}
    </span>
  );
}

// Points only where an item has an estimate: a cluster of files has none to
// sum, which isn't zero.
function ClusterPoints({ row }: { row: ClusterRow }) {
  const { estimated } = row;
  const unestimated = row.unestimated > 0 && (
    <span class="unestimated">{row.unestimated} unestimated</span>
  );
  return (
    <span class="points-sum">
      {estimated > 0 && points(row.points, true)}
      {estimated > 0 && unestimated && " · "}
      {unestimated}
    </span>
  );
}

const categories = [
  ["done", "done"],
  ["in-progress", "in progress"],
  ["todo", "to do"],
] as const;

// Items by status category, as one bar. Its parts are counts, not estimates.
function StatusBar({ status }: { status: ClusterRow["status"] }) {
  const shown = categories.filter(([category]) => status[category] > 0);
  if (shown.length === 0) return <span class="status-bar empty" />;
  const label = shown.map(([category, name]) => `${status[category]} ${name}`).join(", ");
  return (
    <span class="status-bar" role="img" aria-label={label} title={label}>
      {shown.map(([category]) => (
        <span key={category} class={`segment ${category}`} style={{ flexGrow: status[category] }} />
      ))}
    </span>
  );
}

function Items(props: {
  id: string;
  items: ItemRow[];
  selected: readonly string[];
  dispatch: Dispatch;
}) {
  if (props.items.length === 0) {
    return (
      <p class="no-items" id={props.id}>
        No items.
      </p>
    );
  }
  return (
    <ul class="items" id={props.id}>
      {props.items.map((item) => (
        <Item
          key={item.id}
          item={item}
          picked={props.selected.includes(item.id)}
          dispatch={props.dispatch}
        />
      ))}
    </ul>
  );
}

function Item({ item, picked, dispatch }: { item: ItemRow; picked: boolean; dispatch: Dispatch }) {
  // Files and Slack messages carry no assignees or estimates (decisions 0019
  // and 0021).
  const tracked = !item.id.startsWith("folder:") && !item.id.startsWith("slack:");
  // A Jira item whose board takes no estimates carries none either.
  const estimated = tracked && !item.noEstimates;
  return (
    <li class={picked ? "item picked" : "item"}>
      <label class="pick">
        <input
          type="checkbox"
          checked={picked}
          aria-label={`Pick ${item.title}`}
          onChange={() => dispatch({ type: "window", msg: { type: "itemToggled", id: item.id } })}
        />
      </label>
      <span class="key">
        <span class="type" data-type={item.type.toLowerCase()} title={item.type} />
        {keyLabel(item)}
      </span>
      <span class="title" title={item.title}>
        {item.title}
      </span>
      <span class="status" data-category={item.status?.category}>
        {item.status?.name}
      </span>
      {/* A file or a message has no assignee or estimate to lack: those stay
          empty, or a message shows its replies there. */}
      {tracked ? (
        <Assignee name={item.assignee} />
      ) : (
        <span class="assignee">{item.replies && <Replies replies={item.replies} />}</span>
      )}
      <span
        class="points"
        title={!estimated ? undefined : item.points === null ? "Unestimated" : points(item.points)}
      >
        {estimated ? (item.points ?? "–") : ""}
      </span>
      <span
        class="idle"
        title={
          item.idleDays === 0 ? "Updated today" : `Updated ${plural(item.idleDays, "day")} ago`
        }
      >
        {item.idleDays === 0 ? "today" : `${item.idleDays}d`}
      </span>
    </li>
  );
}

// What can be done with picked items. It appears once something is picked.
function Selection(props: {
  model: Model;
  groups: GroupSummary[] | null;
  adding: GroupSummary | null;
  dispatch: Dispatch;
}) {
  const { model, adding, dispatch } = props;
  const count = model.selected.length;
  if (count === 0 && !adding && !model.notice) return null;
  const send = (msg: WindowMsg) => dispatch({ type: "window", msg });
  const others = (props.groups ?? []).filter((group) => group.id !== adding?.id);
  return (
    <div class="selection-bar" role="region" aria-label="Picked items">
      <span class="selection-count">{count === 0 ? "Nothing picked" : `${count} picked`}</span>
      {adding ? (
        <button
          type="button"
          class="button primary"
          disabled={count === 0 || model.pending}
          onClick={() => send({ type: "selectionAdded", groupId: adding.id })}
        >
          Add to {adding.name}
        </button>
      ) : (
        <button
          type="button"
          class="button primary"
          disabled={count === 0 || model.pending}
          onClick={() => send({ type: "selectionGrouped", name: pickedName(model) })}
        >
          New group
        </button>
      )}
      {!adding && others.length > 0 && count > 0 && (
        <select
          class="add-to"
          aria-label="Add to a group"
          disabled={model.pending}
          value=""
          onChange={(event) => {
            const groupId = event.currentTarget.value;
            if (groupId) send({ type: "selectionAdded", groupId });
          }}
        >
          <option value="">Add to…</option>
          {others.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      )}
      {count > 0 && (
        <button
          type="button"
          class="quiet-action"
          onClick={() => send({ type: "selectionCleared" })}
        >
          Clear
        </button>
      )}
      {adding && (
        <Link route={{ page: "group", id: adding.id }} dispatch={dispatch} class="quiet-action">
          Done
        </Link>
      )}
      {model.notice && (
        <span class="selection-notice" role="alert">
          {model.notice}
        </span>
      )}
    </div>
  );
}
