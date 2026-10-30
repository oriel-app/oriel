import type { Program } from "./program.ts";
import { type Effect, type Model, type Msg, type Zoom, windowZoom, zoomOf } from "./update.ts";
import { useProgram } from "./use-program.ts";
import {
  type ClusterRow,
  type ClusterView,
  type GroupingId,
  groupingIds,
  type ItemRow,
  type WindowView,
} from "./view.ts";

type Dispatch = (msg: Msg) => void;

const groupingNames: Record<GroupingId, string> = {
  epic: "Epic",
  assignee: "Assignee",
  stuck: "Stuck",
};

const zoomNames: Record<Zoom, string> = { cluster: "Clusters", list: "Items" };

export function App({ program }: { program: Program<Model, Msg, Effect> }) {
  const [model, dispatch] = useProgram(program);
  return (
    <>
      <header class="bar">
        <div class="bar-inner">
          <span class="brand">
            <Mark />
            Oriel
          </span>
          <Segmented
            label="Group by"
            options={groupingIds.map((id) => [id, groupingNames[id]] as const)}
            picked={model.grouping}
            onPick={(grouping) => dispatch({ type: "groupingPicked", grouping })}
          />
          <Segmented
            label="Show"
            options={(["cluster", "list"] as const).map((zoom) => [zoom, zoomNames[zoom]] as const)}
            picked={windowZoom(model)}
            onPick={(zoom) => dispatch({ type: "zoomPicked", zoom })}
          />
        </div>
      </header>
      <main class="window" aria-busy={model.status === "loading"}>
        <Body model={model} dispatch={dispatch} />
      </main>
    </>
  );
}

function Body({ model, dispatch }: { model: Model; dispatch: Dispatch }) {
  const failed = model.status === "failed" && (
    <div class="failed" role="alert">
      <span>The window didn't load.</span>
      <button type="button" class="button" onClick={() => dispatch({ type: "retryClicked" })}>
        Try again
      </button>
    </div>
  );
  if (model.window === null) {
    return failed || <p class="loading">Loading…</p>;
  }
  const shown = model.window;
  const stale = shown.grouping !== model.grouping;
  return (
    <>
      {failed}
      <Summary view={shown} />
      <div
        class={stale ? "clusters stale" : "clusters"}
        data-grouping={shown.grouping}
        inert={stale}
      >
        {shown.clusters.map((view) => (
          <Cluster
            key={view.row.key}
            view={view}
            zoom={zoomOf(model, view.row.key)}
            dispatch={dispatch}
          />
        ))}
      </div>
    </>
  );
}

function Summary({ view }: { view: WindowView }) {
  const derived = view.clusters.some(({ row }) => row.origin.kind === "derived");
  const asOf = new Date(view.asOf).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <div class="summary">
      <p class="counts">
        {plural(view.items, "item")} in {plural(view.clusters.length, "cluster")}
        {view.fixture && (
          <span class="fixture" title="Synthetic fixture data, not your index">
            Fixture data · {asOf}
          </span>
        )}
      </p>
      {derived && (
        <p class="derived-note">
          <span class="derived-tag">Oriel rule</span>
          marks a cluster Oriel made, which the source doesn't have. Each one shows its rule.
        </p>
      )}
    </div>
  );
}

function Cluster({ view, zoom, dispatch }: { view: ClusterView; zoom: Zoom; dispatch: Dispatch }) {
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
          onClick={() => dispatch({ type: "clusterToggled", key: row.key })}
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
      </h2>
      {open && <Items id={listId} items={list} />}
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

function Items({ id, items }: { id: string; items: ItemRow[] }) {
  if (items.length === 0) {
    return (
      <p class="no-items" id={id}>
        No items.
      </p>
    );
  }
  return (
    <ul class="items" id={id}>
      {items.map((item) => (
        <Item key={item.id} item={item} />
      ))}
    </ul>
  );
}

function Item({ item }: { item: ItemRow }) {
  return (
    <li class="item">
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

function Assignee({ name }: { name: string | null }) {
  if (name === null) {
    return (
      <span class="assignee none">
        <span class="avatar" aria-hidden="true" />
        Unassigned
      </span>
    );
  }
  return (
    <span class="assignee">
      <span class="avatar" aria-hidden="true">
        {initials(name)}
      </span>
      {name}
    </span>
  );
}

function Segmented<T extends string>(props: {
  label: string;
  options: readonly (readonly [T, string])[];
  picked: T | null;
  onPick(value: T): void;
}) {
  return (
    <div class="segmented" role="group" aria-label={props.label}>
      <span class="segmented-label" aria-hidden="true">
        {props.label}
      </span>
      <span class="segmented-options">
        {props.options.map(([value, name]) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === props.picked}
            onClick={() => props.onPick(value)}
          >
            {name}
          </button>
        ))}
      </span>
    </div>
  );
}

function Chevron() {
  return (
    <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function Mark() {
  return (
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
      <path d="M2.5 8.5h15M10 8.5v9" />
    </svg>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = Array.from(words[0] ?? "")[0] ?? "";
  const last = words.length > 1 ? (Array.from(words.at(-1) ?? "")[0] ?? "") : "";
  return (first + last).toUpperCase();
}
