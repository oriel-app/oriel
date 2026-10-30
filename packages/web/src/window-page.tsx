// The window: clusters under a grouping, items to pick, and the user's
// groups beside them. Controls stay out of the way until something is picked
// or hovered.
import { Assignee, Chevron, type Dispatch, Link, plural } from "./parts.tsx";
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
  dispatch: Dispatch;
}) {
  const { model, groups, dispatch } = props;
  const adding = groups?.find((group) => group.id === model.addTo) ?? null;
  return (
    <div class="window-layout">
      <Groups groups={groups} dispatch={dispatch} />
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
        <Body model={model} dispatch={dispatch} />
      </main>
      <Selection model={model} groups={groups} adding={adding} dispatch={dispatch} />
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

function Groups({ groups, dispatch }: { groups: GroupSummary[] | null; dispatch: Dispatch }) {
  return (
    <nav class="groups" aria-label="Groups">
      <h2 class="rail-title">Groups</h2>
      {groups !== null && groups.length === 0 && (
        <p class="rail-empty">Pick items, or make a group from a cluster.</p>
      )}
      <ul class="group-list">
        {groups?.map((group) => (
          <li key={group.id}>
            <Link route={{ page: "group", id: group.id }} dispatch={dispatch} class="group-link">
              <span class="group-name">{group.name}</span>
              <span class="group-meta">
                {group.threads.working > 0 && (
                  <span
                    class="working-dot"
                    title={`${plural(group.threads.working, "working thread")}`}
                  />
                )}
                {group.size}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
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
  return (
    <section class="cluster" data-zoom={zoom}>
      <h2 class="cluster-head">
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
            {row.anchor && <span class="key">{row.anchor.key}</span>}
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

function ClusterPoints({ row }: { row: ClusterRow }) {
  const estimated = row.count - row.unestimated;
  const unestimated = row.unestimated > 0 && (
    <span class="unestimated">{row.unestimated} unestimated</span>
  );
  return (
    <span class="points-sum">
      {estimated > 0 && plural(row.points, "pt")}
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
  return (
    <li class={picked ? "item picked" : "item"}>
      <label class="pick">
        <input
          type="checkbox"
          checked={picked}
          aria-label={`Pick ${item.key}`}
          onChange={() => dispatch({ type: "window", msg: { type: "itemToggled", id: item.id } })}
        />
      </label>
      <span class="key">
        <span class="type" data-type={item.type.toLowerCase()} title={item.type} />
        {item.key}
      </span>
      <span class="title" title={item.title}>
        {item.title}
      </span>
      <span class="status" data-category={item.status?.category}>
        {item.status?.name}
      </span>
      <Assignee name={item.assignee} />
      <span class="points" title={item.points === null ? "Unestimated" : `${item.points} points`}>
        {item.points ?? "–"}
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
