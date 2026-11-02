// The window: clusters under a grouping, and items to pick into a workstream.
// Controls stay out of the way until something is picked or hovered.
import type { AccessibleInputHTMLAttributes, ComponentChildren } from "preact";
import { emptyJira, type JiraField, type JiraModel, type JiraMsg, jiraReady } from "./jira.ts";
import {
  Assignee,
  Chevron,
  type Dispatch,
  ItemLink,
  ItemListContext,
  keyLabel,
  Link,
  plural,
  points,
  Replies,
  SearchIcon,
} from "./parts.tsx";
import { type Model, type Msg as WindowMsg, pickedName, type Zoom, zoomOf } from "./update.ts";
import {
  type BrowseFilter,
  type Choice,
  type ClusterRow,
  type ClusterView,
  filtered,
  type GroupingId,
  groupingIds,
  listSize,
  sameFilter,
  type StatusCategory,
  statusCategories,
  type WorkstreamSummary,
  type ItemRow,
  pageSize,
  type WindowView,
} from "./view.ts";

const groupingNames: Record<GroupingId, string> = {
  epic: "Epic",
  assignee: "Assignee",
  stuck: "Stuck",
  linked: "Linked",
};

export function WindowPage(props: {
  model: Model;
  workstreams: WorkstreamSummary[] | null;
  jira: JiraModel;
  dispatch: Dispatch;
}) {
  const { model, workstreams, jira, dispatch } = props;
  const adding = workstreams?.find((workstream) => workstream.id === model.addTo) ?? null;
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
          {model.window && <Counts view={model.window} filter={model.filter} />}
        </div>
        <Filters model={model} dispatch={dispatch} />
        {adding && (
          <p class="adding" role="status">
            Pick items to add to <strong>{adding.name}</strong>.
          </p>
        )}
        {jira.view?.connectable && <ConnectJira jira={jira} dispatch={dispatch} />}
        {empty && <EmptyJira site={empty.site} project={empty.project} />}
        <Body model={model} dispatch={dispatch} />
      </main>
      <Selection model={model} workstreams={workstreams} adding={adding} dispatch={dispatch} />
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

const statusNames: Record<StatusCategory, string> = {
  todo: "To do",
  "in-progress": "In progress",
  done: "Done",
};

// Browse's filters (decision 0027): item search, then a source, a status
// category and an assignee, each from what the index has. The search box
// asks once typing pauses; Enter doesn't wait.
function Filters({ model, dispatch }: { model: Model; dispatch: Dispatch }) {
  const { filter } = model;
  const send = (msg: WindowMsg) => dispatch({ type: "window", msg });
  const pick = (over: BrowseFilter) =>
    send({ type: "filterPicked", filter: { ...filter, q: model.query, ...over } });
  const choices = model.window?.choices;
  const select = (
    label: string,
    any: string,
    value: string | undefined,
    options: readonly Choice[],
    picked: (value: string) => BrowseFilter,
  ) => (
    <label class="filter">
      <span class="visually-hidden">{label}</span>
      <select
        value={value ?? ""}
        data-set={value ? "" : undefined}
        onChange={(event) => pick(picked(event.currentTarget.value))}
      >
        <option value="">{any}</option>
        {/* One the address names that the index doesn't have stays shown. */}
        {value && !options.some((option) => option.id === value) && (
          <option value={value}>{value}</option>
        )}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form
      class="filters"
      role="search"
      aria-label="Filter items"
      onSubmit={(event) => {
        event.preventDefault();
        pick({});
      }}
    >
      <label class="filter-search">
        <SearchIcon />
        <span class="visually-hidden">Search items</span>
        <input
          type="search"
          autocomplete="off"
          spellcheck={false}
          placeholder="Search items by key or title"
          maxLength={200}
          value={model.query}
          onInput={(event) => send({ type: "queryTyped", text: event.currentTarget.value })}
        />
      </label>
      {select("Source", "All sources", filter.source, choices?.sources ?? [], (source) => ({
        source,
      }))}
      {select(
        "Status",
        "Any status",
        filter.status,
        statusCategories.map((id) => ({ id, name: statusNames[id] })),
        (status) => ({ status: statusCategories.find((id) => id === status) }),
      )}
      {select("Assignee", "Anyone", filter.assignee, choices?.people ?? [], (assignee) => ({
        assignee,
      }))}
      {filtered(filter) && (
        <button type="button" class="quiet-action" onClick={() => send({ type: "filtersCleared" })}>
          Clear filters
        </button>
      )}
    </form>
  );
}

function Counts({ view, filter }: { view: WindowView; filter: BrowseFilter }) {
  const asOf = new Date(view.asOf).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <p class="counts">
      {filtered(filter)
        ? `${view.items} ${view.items === 1 ? "match" : "matches"}`
        : plural(view.items, "item")}{" "}
      in {plural(view.clusters.length, "cluster")}
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
  const stale = shown.grouping !== model.grouping || !sameFilter(model.shownFilter, model.filter);
  const derived = shown.clusters.some(({ row }) => row.origin.kind === "derived");
  // Headings make room for an anchor's checkbox once any cluster has one, so
  // they line up.
  const anchored = shown.clusters.some(({ row }) => row.anchor !== null);
  return (
    <>
      {failed}
      {shown.clusters.length === 0 && filtered(model.filter) && (
        <p class="no-matches">
          Nothing in the window matches these filters.{" "}
          <button
            type="button"
            class="quiet-action"
            onClick={() => dispatch({ type: "window", msg: { type: "filtersCleared" } })}
          >
            Clear filters
          </button>
        </p>
      )}
      {derived && (
        <p class="derived-note">
          <span class="derived-tag">Oriel rule</span>
          marks a cluster Oriel made, which the source doesn't have. Each one shows its rule.
        </p>
      )}
      <div
        hidden={shown.clusters.length === 0 && filtered(model.filter)}
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
            paging={model.paging[view.row.key] ?? null}
            selected={model.selected}
            pending={model.pending}
            locations={shown.locations ?? {}}
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
  paging: number | "failed" | null;
  selected: readonly string[];
  pending: boolean;
  locations: Readonly<Record<string, string>>;
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
              <span class="count">
                {view.matched === undefined
                  ? plural(row.count, "item")
                  : `${view.matched} of ${plural(row.count, "item")}`}
              </span>
              <ClusterPoints row={row} />
              <StatusBar status={row.status} />
            </span>
          </span>
        </button>
        <button
          type="button"
          class="quiet-action make-workstream"
          disabled={props.pending}
          title={
            view.matched === undefined
              ? `Make a workstream of ${row.label}'s items as they are now`
              : `Make a workstream of all ${plural(row.count, "item")} in ${row.label} as they are now, not only those that match`
          }
          onClick={() =>
            dispatch({ type: "window", msg: { type: "clusterToWorkstream", key: row.key } })
          }
        >
          Make workstream
        </button>
      </h2>
      {open && (
        <Items
          id={listId}
          cluster={row}
          size={listSize(view)}
          matching={view.matched !== undefined}
          items={list}
          paging={props.paging}
          selected={props.selected}
          locations={props.locations}
          dispatch={dispatch}
        />
      )}
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

// A cluster's items as far as they have loaded, and the next page's button.
function Items(props: {
  id: string;
  cluster: ClusterRow;
  // How many items the list holds once loaded, and whether a filter chose
  // them.
  size: number;
  matching: boolean;
  items: ItemRow[];
  paging: number | "failed" | null;
  selected: readonly string[];
  locations: Readonly<Record<string, string>>;
  dispatch: Dispatch;
}) {
  const { cluster, size, items, paging } = props;
  if (size === 0) {
    return (
      <p class="no-items" id={props.id}>
        {props.matching ? "None of its items match." : "No items."}
      </p>
    );
  }
  const left = size - items.length;
  const next = (
    <More
      cluster={cluster}
      size={size}
      left={left}
      paging={paging}
      onClick={() =>
        props.dispatch({ type: "window", msg: { type: "moreClicked", key: cluster.key } })
      }
    />
  );
  if (items.length === 0)
    return (
      <div class="items-loading" id={props.id}>
        {next}
      </div>
    );
  return (
    <>
      <ItemListContext.Provider value={items.map((item) => item.id)}>
        <ul class="items" id={props.id}>
          {items.map((item) => (
            <Item
              key={item.id}
              item={item}
              picked={props.selected.includes(item.id)}
              url={props.locations[item.id] ?? null}
              dispatch={props.dispatch}
            />
          ))}
        </ul>
      </ItemListContext.Provider>
      {left > 0 && next}
    </>
  );
}

// The next page of a cluster's items: on its way, failed, or a button.
function More(props: {
  cluster: ClusterRow;
  size: number;
  left: number;
  paging: number | "failed" | null;
  onClick(): void;
}) {
  const { cluster, size, left, paging } = props;
  if (typeof paging === "number")
    return (
      <p class="more-items" data-state="loading">
        Loading…
      </p>
    );
  if (paging === "failed")
    return (
      <p class="more-items" data-state="failed" role="alert">
        <span>These items didn't load.</span>
        <button type="button" class="button" onClick={props.onClick}>
          Try again
        </button>
      </p>
    );
  return (
    <p class="more-items">
      <button
        type="button"
        class="button"
        aria-label={`Show ${Math.min(left, pageSize)} more of ${cluster.label}'s items`}
        onClick={props.onClick}
      >
        Show {Math.min(left, pageSize)} more
      </button>
      <span class="more-count">
        {size - left} of {size} shown
      </span>
    </p>
  );
}

function Item(props: { item: ItemRow; picked: boolean; url: string | null; dispatch: Dispatch }) {
  const { item, picked, dispatch } = props;
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
      <ItemLink item={{ id: item.id, url: props.url }} class="key source-link">
        <span class="type" data-type={item.type.toLowerCase()} title={item.type} />
        {keyLabel(item)}
      </ItemLink>
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
        <span class="assignee">
          {item.replies && <Replies id={item.id} replies={item.replies} />}
        </span>
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
  workstreams: WorkstreamSummary[] | null;
  adding: WorkstreamSummary | null;
  dispatch: Dispatch;
}) {
  const { model, adding, dispatch } = props;
  const count = model.selected.length;
  if (count === 0 && !adding && !model.notice) return null;
  const send = (msg: WindowMsg) => dispatch({ type: "window", msg });
  const others = (props.workstreams ?? []).filter((workstream) => workstream.id !== adding?.id);
  return (
    <div class="selection-bar" role="region" aria-label="Picked items">
      <span class="selection-count">{count === 0 ? "Nothing picked" : `${count} picked`}</span>
      {adding ? (
        <button
          type="button"
          class="button primary"
          disabled={count === 0 || model.pending}
          onClick={() => send({ type: "selectionAdded", workstreamId: adding.id })}
        >
          Add to {adding.name}
        </button>
      ) : (
        <button
          type="button"
          class="button primary"
          disabled={count === 0 || model.pending}
          onClick={() => send({ type: "selectionToWorkstream", name: pickedName(model) })}
        >
          New workstream
        </button>
      )}
      {!adding && others.length > 0 && count > 0 && (
        <select
          class="add-to"
          aria-label="Add to a workstream"
          disabled={model.pending}
          value=""
          onChange={(event) => {
            const workstreamId = event.currentTarget.value;
            if (workstreamId) send({ type: "selectionAdded", workstreamId });
          }}
        >
          <option value="">Add to…</option>
          {others.map((workstream) => (
            <option key={workstream.id} value={workstream.id}>
              {workstream.name}
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
        <Link
          route={{ page: "workstream", id: adding.id }}
          dispatch={dispatch}
          class="quiet-action"
        >
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
