// The sidebar, on every page but a review link: the window, the threads
// waiting on the user, the user's workstreams with their threads under them, the
// latest done threads, the sources, and Settings at the foot. It stays quiet unless something is
// happening: what waits on the user is at the top, the rest fold.
// On a wide screen it folds to a strip of icons, where the fold button counts
// the threads waiting on the user; on a narrow one it's a drawer the menu
// opens.
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import { ThreadMenu } from "./close-thread.tsx";
import { WorkstreamMenu } from "./end-workstream.tsx";
import { dragMove, useMoveDrop } from "./drag-move.ts";
import { Menu, type MenuItem } from "./menu.tsx";
import {
  type Carried,
  type CarriedThread,
  type MovingModel,
  type MovingMsg,
  movesTo,
} from "./moving.ts";
import { doneRoute, doneTabs, type Nav, type NavWorkstream, nav } from "./nav.ts";
import { changeSetStateNames, stateNames } from "./chip.ts";
import {
  Chevron,
  type Dispatch,
  Link,
  Mark,
  plural,
  SearchIcon,
  useStamp,
  waitingNames,
} from "./parts.tsx";
import type { Model } from "./root.ts";
import type { Route } from "./route.ts";
import type { ThreadSummaryView } from "./view.ts";
import { resultRoute, type SearchModel, type SearchMsg } from "./search.ts";
import {
  type ConnectionsModel,
  type ConnectionsMsg,
  openConnections,
  sourcesLine,
  syncChanges,
} from "./connections.ts";
import { windowRoute } from "./update.ts";
import { Tooltip } from "./tooltip.tsx";

// A workstream shows this many of its threads; the rest are on its page.
const shown = 5;
// So many threads waiting on the user show until the user asks for the rest.
const shownWaiting = 8;
// So many done threads show; the rest are on the Done page.
const shownDone = 5;

export function Sidebar(props: {
  model: Model;
  dispatch: Dispatch;
  folded: boolean;
  onFold(): void;
}) {
  const { model, dispatch } = props;
  const where = nav(model);
  const page = model.route.page;
  return (
    <aside id="sidebar" class="sidebar" aria-label="Sidebar">
      <div class="sidebar-head">
        <Link route={{ page: "overview" }} dispatch={dispatch} class="brand">
          <Mark />
          <span class="sidebar-label">Oriel</span>
        </Link>
        <Tooltip text={`${props.folded ? "Show" : "Hide"} the sidebar (${modKey}\\)`}>
          <button
            type="button"
            class="sidebar-fold"
            aria-controls="sidebar"
            aria-expanded={!props.folded}
            onClick={props.onFold}
          >
            <PanelIcon />
            <span class="visually-hidden">
              {props.folded ? "Show sidebar" : "Hide sidebar"}
              {props.folded &&
                where.needsYou > 0 &&
                `, ${plural(where.needsYou, "thread")} waiting on you`}
            </span>
            {props.folded && where.needsYou > 0 && (
              <span class="bar-count" aria-hidden="true">
                {where.needsYou}
              </span>
            )}
          </button>
        </Tooltip>
      </div>
      <ThreadSearch
        search={model.search}
        dispatch={dispatch}
        folded={props.folded}
        onFold={props.onFold}
        newThread={page === "new-thread"}
      />
      <nav class="sidebar-pages" aria-label="Pages">
        <Link
          route={{ page: "overview" }}
          dispatch={dispatch}
          class="nav-link"
          aria-current={page === "overview" || page === "window" ? "page" : undefined}
        >
          <WindowIcon />
          <span class="sidebar-label">Window</span>
        </Link>
      </nav>
      {/* While a search shows its results, they take the lists' place, below
          Window, so nothing above them moves as typing starts. */}
      {searching(model.search) ? (
        <SearchResults search={model.search} dispatch={dispatch} />
      ) : (
        <>
          <NeedsYou where={where} loaded={model.threads !== null} dispatch={dispatch} />
          <Workstreams where={where} moving={model.moving} dispatch={dispatch} />
          <Done where={where} loaded={model.threads !== null} dispatch={dispatch} />
        </>
      )}
      <Sources
        connections={model.connections}
        browse={windowRoute(model.window)}
        dispatch={dispatch}
      />
      <nav class="sidebar-foot" aria-label="Settings">
        <Link
          route={{ page: "settings", section: "providers" }}
          dispatch={dispatch}
          class="nav-link"
          aria-current={page === "settings" ? "page" : undefined}
        >
          <SettingsIcon />
          <span class="sidebar-label">Settings</span>
        </Link>
      </nav>
    </aside>
  );
}

// The search field, at the top, with New thread beside it as an icon; folded,
// both are icons, and the search's opens the sidebar at the field. Typing
// finds threads by name, by what was said in them and by what their change
// sets wrote. The arrow keys move through the results, Enter opens one, at
// the change set that matched, and Escape clears the field.
function ThreadSearch(props: {
  search: SearchModel;
  dispatch: Dispatch;
  folded: boolean;
  onFold(): void;
  newThread: boolean;
}) {
  const { search, dispatch } = props;
  const send = (msg: SearchMsg) => dispatch({ type: "search", msg });
  const shown = searching(search) ? (search.results ?? []) : [];
  const keyed = (event: KeyboardEvent) => {
    const msg: SearchMsg | null =
      event.key === "ArrowDown"
        ? { type: "moved", by: 1 }
        : event.key === "ArrowUp"
          ? { type: "moved", by: -1 }
          : event.key === "Enter"
            ? { type: "entered" }
            : event.key === "Escape" && search.query !== ""
              ? { type: "cleared" }
              : null;
    if (msg === null) return;
    event.preventDefault();
    // Escape here clears the field, and closes nothing else.
    event.stopPropagation();
    send(msg);
  };
  return (
    <div class="sidebar-search">
      <div class="sidebar-search-row" role="search">
        <Tooltip text="Search threads">
          <button
            type="button"
            class="sidebar-search-open nav-link"
            onClick={() => {
              props.onFold();
              requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
            }}
          >
            <SearchIcon />
            <span class="sidebar-label">Search threads</span>
          </button>
        </Tooltip>
        <label class="sidebar-search-field">
          <SearchIcon />
          <span class="visually-hidden">Search threads</span>
          <input
            id={fieldId}
            type="text"
            role="combobox"
            autocomplete="off"
            spellcheck={false}
            placeholder="Search threads"
            aria-expanded={shown.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown.length > 0 ? optionId(search.active) : undefined}
            value={search.query}
            onInput={(event) => send({ type: "typed", text: event.currentTarget.value })}
            onKeyDown={keyed}
          />
        </label>
        <Tooltip text="New thread: start from nothing, such as a plan for a new epic">
          <Link
            route={{ page: "new-thread" }}
            dispatch={dispatch}
            class="sidebar-new nav-link"
            aria-label="New thread"
            aria-current={props.newThread ? "page" : undefined}
          >
            <PlusIcon />
          </Link>
        </Tooltip>
      </div>
    </div>
  );
}

// What a search found, where the lists were.
function SearchResults({ search, dispatch }: { search: SearchModel; dispatch: Dispatch }) {
  const shown = search.results ?? [];
  return (
    <div class="search-results">
      <p class="rail-empty" role="status">
        {search.failed
          ? "Oriel couldn't search just now. Keep typing to try again."
          : search.results === null
            ? ""
            : search.results.length === 0
              ? "No thread matches that."
              : plural(search.results.length, "result")}
      </p>
      <div id={listId} role="listbox" aria-label="Threads found" class="search-list">
        {shown.map((result, index) => (
          <Link
            key={`${result.thread.id}-${result.changeSet?.id ?? ""}`}
            route={resultRoute(result)}
            dispatch={dispatch}
            msg={{ type: "search", msg: { type: "picked", index } }}
            id={optionId(index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === search.active}
            class="search-result"
          >
            <span class="search-result-head">
              <span class="nav-name">{result.thread.title ?? "New thread"}</span>
              {result.changeSet && (
                <span class="search-result-set" data-state={result.changeSet.state}>
                  {`Change set ${changeSetStateNames[result.changeSet.state]}`}
                </span>
              )}
            </span>
            {/* A name that matched is the title above already. */}
            {result.matched !== "name" && (
              <span class="search-result-excerpt">{result.excerpt}</span>
            )}
            <span class="nav-waiting-workstream">{result.thread.workstream.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

const fieldId = "thread-search";
const listId = "thread-search-results";

const optionId = (index: number) => `thread-search-${index}`;

// Whether the field holds a query, so its results show instead of the lists.
const searching = (search: SearchModel) => search.query.trim() !== "";

const modKey = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";

// What needs the user, in sight on every page, at the top and never folded:
// each thread waiting on a review or a reply, with what it waits on and its
// workstream, which says why it's here, so it has no heading. When nothing
// waits, nothing shows. Past a few, the rest show here when asked for. The
// overview's count of them points here (`needsYouId`).
function NeedsYou(props: { where: Nav; loaded: boolean; dispatch: Dispatch }) {
  const { where, dispatch } = props;
  const [all, setAll] = useState(false);
  if (!props.loaded || where.waiting.length === 0) return null;
  const shown = all ? where.waiting : where.waiting.slice(0, shownWaiting);
  return (
    <nav id={needsYouId} class="sidebar-needs" aria-label="Needs you" tabIndex={-1}>
      <ul class="nav-waiting">
        {shown.map((thread) => (
          <li key={thread.id} {...dragThread(thread)}>
            <ThreadMenu
              thread={thread}
              dispatch={dispatch}
              swipe
              moves={threadMoves(thread, where, dispatch)}
            >
              <Link
                route={{ page: "thread", id: thread.id }}
                dispatch={dispatch}
                class="nav-link nav-waiting-link"
              >
                <span class="state-dot" data-state={thread.state} data-waiting={thread.waitingOn} />
                <span class="nav-waiting-text">
                  <span class="nav-name">{thread.title ?? "New thread"}</span>
                  <span class="nav-waiting-about">
                    <span class="nav-waiting-on" data-waiting={thread.waitingOn}>
                      {thread.waitingOn && waitingNames[thread.waitingOn]}
                    </span>
                    <span class="nav-waiting-workstream">{thread.workstream.name}</span>
                  </span>
                </span>
              </Link>
            </ThreadMenu>
          </li>
        ))}
        {where.waiting.length > shown.length && (
          <li>
            <button type="button" class="nav-link nav-more" onClick={() => setAll(true)}>
              {where.waiting.length - shown.length} more
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}

export const needsYouId = "needs-you";

const carriedThread = (thread: ThreadSummaryView): CarriedThread => ({
  kind: "thread",
  id: thread.id,
  title: thread.title,
  from: { id: thread.workstream.id, name: thread.workstream.name },
});

const dragThread = (thread: ThreadSummaryView) =>
  thread.state === "working" ? dragMove(carriedThread(thread)) : {};

function threadMoves(thread: ThreadSummaryView, where: Nav, dispatch: Dispatch): MenuItem[] {
  if (thread.state !== "working") return [];
  const carried = carriedThread(thread);
  return (where.workstreams ?? []).flatMap(({ workstream }) =>
    movesTo(carried, workstream.id)
      ? [
          {
            label: `Move to “${workstream.name}”`,
            onSelect: () =>
              dispatch({
                type: "moving",
                msg: {
                  type: "dropped",
                  item: carried,
                  to: { id: workstream.id, name: workstream.name },
                },
              }),
          },
        ]
      : [],
  );
}

// The user's workstreams, under a heading that folds them, which this
// browser remembers; open until the user folds them. An item or a thread
// dragged onto one moves there; an item onto the heading, a menu asks
// whether to make a new workstream of it (moving.ts).
function Workstreams({
  where,
  moving,
  dispatch,
}: {
  where: Nav;
  moving: MovingModel;
  dispatch: Dispatch;
}) {
  const move = (msg: MovingMsg) => dispatch({ type: "moving", msg });
  const heading = useMoveDrop(
    (carried) => carried.kind === "item",
    (item, at) => item.kind === "item" && move({ type: "droppedOnHeading", item, at }),
  );
  const { asking } = moving;
  const [shown, toggleShown] = useFold("oriel.sidebar.workstreams", true);
  // Workstreams the user opened or closed by hand. Any other is open while it's
  // the current one, and arriving at a workstream opens it whatever was set.
  const [set, setSet] = useState<ReadonlyMap<string, boolean>>(new Map());
  const current = where.workstreams?.find((entry) => entry.current)?.workstream.id ?? null;
  // Before paint, so an arrival never shows the workstream closed for a frame.
  useLayoutEffect(() => {
    if (current === null) return;
    setSet((was) => {
      if (!was.has(current)) return was;
      const next = new Map(was);
      next.delete(current);
      return next;
    });
  }, [current]);
  const isOpen = (entry: NavWorkstream) => set.get(entry.workstream.id) ?? entry.current;
  const toggle = (entry: NavWorkstream) =>
    setSet((was) =>
      new Map(was).set(entry.workstream.id, !(was.get(entry.workstream.id) ?? entry.current)),
    );
  return (
    <nav class="sidebar-workstreams" aria-label="Workstreams">
      <FoldHead
        open={shown}
        onToggle={toggleShown}
        controls="nav-workstreams"
        drop={heading.props}
        over={heading.over}
      >
        Workstreams
      </FoldHead>
      <Menu
        label={asking ? `Move ${asking.item.key}` : "Move"}
        items={
          asking
            ? [
                {
                  label: "Create new workstream",
                  onSelect: () => move({ type: "newClicked", item: asking.item }),
                },
                { label: "Cancel", onSelect: () => move({ type: "askCancelled" }) },
              ]
            : []
        }
        at={asking?.at ?? null}
        onClose={() => move({ type: "askCancelled" })}
      />
      {shown && where.workstreams !== null && where.workstreams.length === 0 && (
        <p class="rail-empty">Pick items in the window, or make a workstream from a cluster.</p>
      )}
      {shown && (
        <ul id="nav-workstreams" class="nav-workstreams">
          {where.workstreams?.map((entry) => (
            <WorkstreamEntry
              key={entry.workstream.id}
              entry={entry}
              open={isOpen(entry)}
              where={where}
              onToggle={() => toggle(entry)}
              onDrop={(item) =>
                move({
                  type: "dropped",
                  item,
                  to: { id: entry.workstream.id, name: entry.workstream.name },
                })
              }
              dispatch={dispatch}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}

function WorkstreamEntry(props: {
  entry: NavWorkstream;
  open: boolean;
  where: Nav;
  onToggle(): void;
  onDrop(item: Carried): void;
  dispatch: Dispatch;
}) {
  const { entry, dispatch } = props;
  const { workstream, threads } = entry;
  // Not where the item or thread came from: dropped there, it stays.
  const target = useMoveDrop(
    (item) => movesTo(item, workstream.id),
    (item) => props.onDrop(item),
  );
  const open = props.open && threads.length > 0;
  const busy = threads.filter((thread) => thread.waitingOn === "agent").length;
  const listId = `nav-threads-${workstream.id}`;
  return (
    <li class="nav-workstream" data-current={entry.current || undefined}>
      <div class="nav-workstream-row" data-drop-over={target.over || undefined} {...target.props}>
        {threads.length > 0 ? (
          <button
            type="button"
            class="nav-disclose"
            aria-expanded={open}
            aria-controls={listId}
            onClick={props.onToggle}
          >
            <Chevron />
            <span class="visually-hidden">
              {open ? "Hide" : "Show"} threads in {workstream.name}
            </span>
          </button>
        ) : (
          <span class="nav-disclose" aria-hidden="true" />
        )}
        {/* A swipe or right-click marks it done or deletes it (decision 0028). */}
        <WorkstreamMenu
          workstream={workstream}
          done={false}
          dispatch={dispatch}
          swipe
          class="nav-workstream-menu"
        >
          <Link
            route={{ page: "workstream", id: workstream.id }}
            dispatch={dispatch}
            class="nav-link"
            aria-current={entry.current && props.where.thread === null ? "page" : undefined}
          >
            <span class="nav-name">{workstream.name}</span>
            {busy > 0 && <span class="working-dot" title={`${plural(busy, "agent")} working`} />}
            <span class="nav-count" title={plural(workstream.size, "item")}>
              {workstream.size}
            </span>
          </Link>
        </WorkstreamMenu>
      </div>
      {open && (
        <ul id={listId} class="nav-threads">
          {threads.slice(0, shown).map((thread) => (
            <li key={thread.id} {...dragThread(thread)}>
              <ThreadMenu
                thread={thread}
                dispatch={dispatch}
                swipe
                moves={threadMoves(thread, props.where, dispatch)}
              >
                <Link
                  route={{ page: "thread", id: thread.id }}
                  dispatch={dispatch}
                  class="nav-link nav-thread"
                  aria-current={thread.id === props.where.thread ? "page" : undefined}
                >
                  <span
                    class="state-dot"
                    data-state={thread.state}
                    data-waiting={thread.waitingOn ?? undefined}
                    title={
                      thread.waitingOn ? waitingNames[thread.waitingOn] : stateNames[thread.state]
                    }
                  />
                  <span class="nav-name">{thread.title ?? "New thread"}</span>
                </Link>
              </ThreadMenu>
            </li>
          ))}
          {threads.length > shown && (
            <li>
              <Link
                route={{ page: "workstream", id: workstream.id }}
                dispatch={dispatch}
                class="nav-link nav-more"
              >
                {threads.length - shown} more
              </Link>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

// The latest done and handed-off threads, folded until the user opens them,
// which this browser remembers. The rest are on the Done page, and dropped
// ones on its Dropped tab, which a line under them leads to.
function Done(props: { where: Nav; loaded: boolean; dispatch: Dispatch }) {
  const { where, dispatch } = props;
  const [open, toggle] = useFold("oriel.sidebar.done", false);
  if (!props.loaded) return null;
  const { done, dropped } = doneTabs(where.finished);
  return (
    <nav class="sidebar-done" aria-label="Done">
      <FoldHead open={open} onToggle={toggle} controls="nav-done">
        Done
        {done.length > 0 && <span class="nav-count">{done.length}</span>}
      </FoldHead>
      {open && (
        <ul id="nav-done" class="nav-threads nav-done">
          {done.length === 0 && <li class="rail-empty">No thread is done yet.</li>}
          {done.slice(0, shownDone).map((thread) => (
            <li key={thread.id}>
              <ThreadMenu thread={thread} dispatch={dispatch} swipe>
                <Link
                  route={{ page: "thread", id: thread.id }}
                  dispatch={dispatch}
                  class="nav-link nav-thread"
                  title={thread.workstream.name}
                  aria-current={thread.id === where.thread ? "page" : undefined}
                >
                  <span
                    class="state-dot"
                    data-state={thread.state}
                    title={stateNames[thread.state]}
                  />
                  <span class="nav-name">{thread.title ?? "New thread"}</span>
                </Link>
              </ThreadMenu>
            </li>
          ))}
          {done.length > shownDone && (
            <li>
              <Link
                route={doneRoute("done")}
                dispatch={dispatch}
                class="nav-link nav-more"
                aria-current={where.doneTab === "done" ? "page" : undefined}
              >
                {done.length - shownDone} more
              </Link>
            </li>
          )}
          {dropped.length > 0 && (
            <li>
              <Link
                route={doneRoute("dropped")}
                dispatch={dispatch}
                class="nav-link nav-more"
                aria-current={where.doneTab === "dropped" ? "page" : undefined}
              >
                {dropped.length} dropped
              </Link>
            </li>
          )}
        </ul>
      )}
    </nav>
  );
}

// A heading that folds the section under it.
function FoldHead(props: {
  open: boolean;
  onToggle(): void;
  controls: string;
  children: ComponentChildren;
  // Beside the heading, at its end: what it says folded, or its actions.
  after?: ComponentChildren;
  // What a drop on it does, and whether one it takes is over it now.
  drop?: ReturnType<typeof useMoveDrop>["props"];
  over?: boolean;
}) {
  return (
    <div class="fold-head" data-drop-over={props.over || undefined} {...props.drop}>
      <h2 class="rail-title">
        <button
          type="button"
          class="fold-toggle"
          aria-expanded={props.open}
          aria-controls={props.controls}
          onClick={props.onToggle}
        >
          <Chevron />
          {props.children}
        </button>
      </h2>
      {props.after}
    </div>
  );
}

// Whether a section of the sidebar is open, kept in this browser only, by
// `key`; `opened` until the user folds or opens it. `show` opens it for now
// without keeping that, as a source's problem does.
function useFold(key: string, opened: boolean) {
  const [open, setOpen] = useState(() => readOpen(key, opened));
  const toggle = () => {
    writeOpen(key, !open);
    setOpen(!open);
  };
  return [open, toggle, () => setOpen(true)] as const;
}

function readOpen(key: string, opened: boolean): boolean {
  try {
    const kept = localStorage.getItem(key);
    return kept === null ? opened : kept === "1";
  } catch {
    return opened;
  }
}

function writeOpen(key: string, open: boolean) {
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // Storage may be off; the section just opens as it starts next time.
  }
}

// Every connected source, at the foot, folded until the user opens it: one
// line of how many, when the longest ago of them last synced, and a warning
// mark while any has a problem. It draws the eye only while a sync runs or a
// source has a problem, and a problem opens it. Open, each source is one row
// drawn the same way, whatever the source: its name, its items, which open
// Browse filtered to it, and when it last synced, with what that sync
// changed under it when it changed anything, and Sync on hover or focus;
// Sync all heads them. Adding a source is the last entry, which opens
// Settings' Connections, where every connector is offered.
function Sources(props: {
  connections: ConnectionsModel;
  // Browse as the user last left it, which a row opens filtered to its source.
  browse: Extract<Route, { page: "window" }>;
  dispatch: Dispatch;
}) {
  const { connections: sources, dispatch } = props;
  const [open, toggle, show] = useFold("oriel.sidebar.sources", false);
  const line = sourcesLine(sources);
  const problems = Object.keys(sources.problems).length;
  useEffect(() => {
    if (problems > 0) show();
  }, [problems]);
  const send = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const synced = useStamp();
  if (sources.view === null) return null;
  return (
    <section
      class="sidebar-sources"
      aria-label="Sources"
      data-syncing={line.syncing || undefined}
      data-problem={line.problem || undefined}
    >
      <FoldHead
        open={open}
        onToggle={toggle}
        controls="nav-sources"
        after={
          open ? (
            line.syncable > 1 && (
              <button
                type="button"
                class="quiet-action"
                disabled={sources.syncing.length === line.syncable}
                onClick={() => send({ type: "syncAllClicked" })}
              >
                Sync all
              </button>
            )
          ) : (
            <span class="sources-line">
              {line.problem && <WarningIcon label="A source has a problem" />}
              {line.syncing
                ? "Syncing…"
                : line.count === 0
                  ? "None yet"
                  : line.syncable === 0
                    ? `${plural(line.count, "source")} · kept in Oriel`
                    : `${plural(line.count, "source")} · ${line.syncedAt === null ? "not synced" : synced(line.syncedAt)}`}
            </span>
          )
        }
      >
        Sources
      </FoldHead>
      {open && (
        <ul id="nav-sources" class="nav-sources">
          {openConnections(sources).map((source) => {
            const syncing = sources.syncing.includes(source.id);
            const problem = sources.problems[source.id];
            // Said under its last sync's time, unless a sync runs now or
            // the last one didn't work.
            const changes = syncing || problem ? null : syncChanges(source.lastSync);
            return (
              <li key={source.id} class="source-row" data-syncing={syncing || undefined}>
                <Link
                  route={{
                    page: "window",
                    grouping: props.browse.grouping,
                    addTo: null,
                    source: source.prefix,
                  }}
                  dispatch={dispatch}
                  class="nav-link nav-source"
                  title={source.about}
                >
                  {problem && <WarningIcon label="Its last sync didn't work" />}
                  <span class="nav-name">{source.name}</span>
                  <span class="nav-count" title={plural(source.items, "item")}>
                    {source.items}
                  </span>
                  <span class="source-synced">
                    {source.own
                      ? "kept in Oriel"
                      : syncing
                        ? "Syncing…"
                        : source.syncedAt === null
                          ? "not synced"
                          : synced(source.syncedAt)}
                  </span>
                </Link>
                {!source.own && (
                  <button
                    type="button"
                    class="quiet-action source-sync"
                    disabled={syncing}
                    aria-label={`Sync ${source.name}`}
                    onClick={() => send({ type: "syncClicked", connection: source.id })}
                  >
                    Sync
                  </button>
                )}
                {changes && !source.own && <p class="source-changes">{changes}</p>}
                {problem && (
                  <p class="source-problem" role="alert">
                    {problem}
                  </p>
                )}
              </li>
            );
          })}
          <li>
            <Link
              route={{ page: "settings", section: "connections" }}
              dispatch={dispatch}
              class="nav-link nav-more add-source"
            >
              Add a source
            </Link>
          </li>
        </ul>
      )}
    </section>
  );
}

export function MenuIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
  );
}

// A panel at the window's edge: the sidebar's on the left, or, `right`,
// the window chat's rail.
export function PanelIcon(props: { right?: boolean }) {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d={props.right ? "M10 2.5v11" : "M6 2.5v11"} />
    </svg>
  );
}

function WindowIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M2 6.5h12M5 9.5h6M5 11.5h4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h6.25M12.25 4.5h1.25M2.5 11.5h1.25M7.25 11.5h6.25" />
      <circle cx="10.5" cy="4.5" r="1.75" />
      <circle cx="5.5" cy="11.5" r="1.75" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function WarningIcon({ label }: { label: string }) {
  return (
    <svg class="icon warning-mark" viewBox="0 0 16 16" role="img" aria-label={label}>
      <path d="M8 2.5l6 10.5H2zM8 6.5v3M8 11.25v.25" />
    </svg>
  );
}
