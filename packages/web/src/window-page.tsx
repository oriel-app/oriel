// The window: clusters under a grouping, and items to pick into a workstream.
// Controls stay out of the way until something is picked or hovered.
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { dragItem } from "./drag-item.ts";
import { columnsOf } from "./connectors.ts";
import {
  Assignee,
  Chevron,
  ConnectorsContext,
  type Dispatch,
  ItemLink,
  ItemListContext,
  keyLabel,
  Link,
  plural,
  points,
  Replies,
  SearchIcon,
  useStamp,
} from "./parts.tsx";
import { ViewTabs } from "./overview-page.tsx";
import { isOpen, windowRoute, type Model, type Msg as WindowMsg, pickedName } from "./update.ts";
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
import { Tooltip } from "./tooltip.tsx";

const groupingNames: Record<GroupingId, string> = {
  epic: "Epic",
  assignee: "Assignee",
  stuck: "Stuck",
  linked: "Linked",
};

export function WindowPage(props: {
  model: Model;
  workstreams: WorkstreamSummary[] | null;
  // What asks to connect a source, or says one connected has nothing yet.
  connect: ComponentChildren;
  dispatch: Dispatch;
}) {
  const { model, workstreams, dispatch } = props;
  const adding = workstreams?.find((workstream) => workstream.id === model.addTo) ?? null;
  return (
    <div class="window-layout">
      <main class="window" aria-busy={model.status === "loading"}>
        <div class="window-head">
          <ViewTabs current="browse" browse={windowRoute(model)} dispatch={dispatch} />
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
        {props.connect}
        <Body model={model} dispatch={dispatch} />
      </main>
      <Selection model={model} workstreams={workstreams} adding={adding} dispatch={dispatch} />
    </div>
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
          placeholder="Search items by key, title or text"
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
      {select(
        "Workstream",
        "In a workstream or not",
        filter.workstream,
        [{ id: "none", name: "Not in a workstream" }],
        (workstream) => ({ workstream: workstream === "none" ? "none" : undefined }),
      )}
      {filtered(filter) && (
        <button type="button" class="quiet-action" onClick={() => send({ type: "filtersCleared" })}>
          Clear filters
        </button>
      )}
    </form>
  );
}

// The fixture's date, as Browse writes it absolute.
const fixtureDay = (instant: string) =>
  new Date(instant).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function Counts({ view, filter }: { view: WindowView; filter: BrowseFilter }) {
  const asOf = useStamp()(view.asOf, fixtureDay);
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
            open={isOpen(model, view.row.key)}
            paging={model.paging[view.row.key] ?? null}
            selected={model.selected}
            pending={model.pending}
            locations={shown.locations ?? {}}
            dispatch={dispatch}
          />
        ))}
      </div>
      {/* Under the clusters, not over them: a grouping with Oriel's clusters
          starts its list where every other grouping does. */}
      {derived && (
        <p class="derived-note">
          <span class="derived-tag">Oriel rule</span>
          marks a cluster Oriel made, which the source doesn't have. Each one shows its rule.
        </p>
      )}
    </>
  );
}

function Cluster(props: {
  view: ClusterView;
  open: boolean;
  paging: number | "failed" | null;
  selected: readonly string[];
  pending: boolean;
  locations: Readonly<Record<string, string>>;
  dispatch: Dispatch;
}) {
  const { view, open, dispatch } = props;
  const { row, list } = view;
  const listId = `items-${row.key}`;
  const { anchor } = row;
  const picked = anchor !== null && props.selected.includes(anchor.id);
  return (
    <section class="cluster" data-open={open ? "" : undefined}>
      <h2 class={picked ? "cluster-head picked" : "cluster-head"}>
        {/* The anchor (the epic) is an item too, picked here: the heading is
            where it shows, open or closed, so it never shows twice. */}
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
                  ? plural(row.size, "item")
                  : `${view.matched + (view.anchorMatched ? 1 : 0)} of ${plural(row.size, "item")}`}
              </span>
              <ClusterPoints row={row} />
              <StatusBar status={row.status} />
            </span>
          </span>
        </button>
        <Tooltip
          text={`Make a workstream of all ${plural(row.size, "item")} in ${row.label} as they are now${view.matched === undefined ? "" : ", not only those that match"}`}
        >
          <button
            type="button"
            class="quiet-action make-workstream"
            disabled={props.pending}
            onClick={() =>
              dispatch({ type: "window", msg: { type: "clusterToWorkstream", key: row.key } })
            }
          >
            Make workstream
          </button>
        </Tooltip>
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
export function StatusBar({ status }: { status: ClusterRow["status"] }) {
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
        {props.matching
          ? "None of its items match."
          : cluster.anchor
            ? `No items but ${cluster.anchor.key} itself.`
            : "No items."}
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
  const connectors = useContext(ConnectorsContext);
  const columns = columnsOf(connectors, item);
  // Dragged onto a workstream in the sidebar, it joins it (moving.ts).
  const carried = { id: item.id, key: keyLabel(item, connectors), title: item.title, from: null };
  return (
    <li class={picked ? "item picked" : "item"} {...dragItem(carried)}>
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
        {keyLabel(item, connectors)}
      </ItemLink>
      <span class="title" title={item.title}>
        {item.title}
      </span>
      <span class="status" data-category={item.status?.category}>
        {item.status?.name}
      </span>
      {columns.assignee ? (
        <Assignee name={item.assignee} />
      ) : (
        <span class="assignee">
          {columns.replies && item.replies && <Replies id={item.id} replies={item.replies} />}
        </span>
      )}
      <span
        class="points"
        title={
          !columns.estimate ? undefined : item.points === null ? "Unestimated" : points(item.points)
        }
      >
        {columns.estimate ? (item.points ?? "–") : ""}
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
