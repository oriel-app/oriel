// The sidebar, on every page but a review link: the window, the threads
// waiting on the user, the user's groups with their threads under them, the
// latest done threads, and the sources: Jira and the connected folder.
// On a wide screen it folds to a strip of icons, where the fold button counts
// the threads waiting on the user; on a narrow one it's a drawer the menu
// opens.
import { useLayoutEffect, useState } from "preact/hooks";
import { ThreadMenu } from "./close-thread.tsx";
import type { FolderModel, FolderMsg } from "./folder.ts";
import type { JiraModel } from "./jira.ts";
import { doneRoute, doneTabs, type Nav, type NavGroup, nav } from "./nav.ts";
import { Chevron, type Dispatch, Link, Mark, plural, stateNames, waitingNames } from "./parts.tsx";
import type { Model } from "./root.ts";

// A group shows this many of its threads; the rest are on its page.
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
        <Link
          route={{ page: "window", grouping: model.window?.grouping ?? "epic", addTo: null }}
          dispatch={dispatch}
          class="brand"
        >
          <Mark />
          <span class="sidebar-label">Oriel</span>
        </Link>
        <button
          type="button"
          class="sidebar-fold"
          aria-controls="sidebar"
          aria-expanded={!props.folded}
          title={`${props.folded ? "Show" : "Hide"} the sidebar (${modKey}\\)`}
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
      </div>
      <nav class="sidebar-pages" aria-label="Pages">
        <Link
          route={{ page: "new-thread" }}
          dispatch={dispatch}
          class="nav-link"
          title="Start a thread from nothing, such as a plan for a new epic"
          aria-current={page === "new-thread" ? "page" : undefined}
        >
          <PlusIcon />
          <span class="sidebar-label">New thread</span>
        </Link>
        <Link
          route={{ page: "window", grouping: model.window?.grouping ?? "epic", addTo: null }}
          dispatch={dispatch}
          class="nav-link"
          aria-current={page === "window" ? "page" : undefined}
        >
          <WindowIcon />
          <span class="sidebar-label">Window</span>
        </Link>
      </nav>
      <NeedsYou where={where} loaded={model.threads !== null} dispatch={dispatch} />
      <Groups where={where} dispatch={dispatch} />
      <Done where={where} loaded={model.threads !== null} dispatch={dispatch} />
      <div class="sources">
        <Jira jira={model.jira} dispatch={dispatch} />
        <Folder folder={model.folder} dispatch={dispatch} />
      </div>
    </aside>
  );
}

const modKey = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";

// What needs the user, in sight on every page: each thread waiting on a
// review or a reply, with what it waits on and its group. The groups below
// say which page this is.
// Past a few, the rest show here when asked for.
function NeedsYou(props: { where: Nav; loaded: boolean; dispatch: Dispatch }) {
  const { where, dispatch } = props;
  const [all, setAll] = useState(false);
  if (!props.loaded) return null;
  const shown = all ? where.waiting : where.waiting.slice(0, shownWaiting);
  return (
    <nav class="sidebar-needs" aria-label="Needs you">
      <h2 class="rail-title">Needs you</h2>
      {where.waiting.length === 0 && <p class="rail-empty">Nothing is waiting on you.</p>}
      <ul class="nav-waiting">
        {shown.map((thread) => (
          <li key={thread.id}>
            <ThreadMenu thread={thread} dispatch={dispatch} swipe>
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
                    <span class="nav-waiting-group">{thread.group.name}</span>
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

function Groups({ where, dispatch }: { where: Nav; dispatch: Dispatch }) {
  // Groups the user opened or closed by hand. Any other is open while it's
  // the current one, and arriving at a group opens it whatever was set.
  const [set, setSet] = useState<ReadonlyMap<string, boolean>>(new Map());
  const current = where.groups?.find((entry) => entry.current)?.group.id ?? null;
  // Before paint, so an arrival never shows the group closed for a frame.
  useLayoutEffect(() => {
    if (current === null) return;
    setSet((was) => {
      if (!was.has(current)) return was;
      const next = new Map(was);
      next.delete(current);
      return next;
    });
  }, [current]);
  const isOpen = (entry: NavGroup) => set.get(entry.group.id) ?? entry.current;
  const toggle = (entry: NavGroup) =>
    setSet((was) => new Map(was).set(entry.group.id, !(was.get(entry.group.id) ?? entry.current)));
  return (
    <nav class="sidebar-groups" aria-label="Groups">
      <h2 class="rail-title">Groups</h2>
      {where.groups !== null && where.groups.length === 0 && (
        <p class="rail-empty">Pick items in the window, or make a group from a cluster.</p>
      )}
      <ul class="nav-groups">
        {where.groups?.map((entry) => (
          <GroupEntry
            key={entry.group.id}
            entry={entry}
            open={isOpen(entry)}
            thread={where.thread}
            onToggle={() => toggle(entry)}
            dispatch={dispatch}
          />
        ))}
      </ul>
    </nav>
  );
}

function GroupEntry(props: {
  entry: NavGroup;
  open: boolean;
  thread: string | null;
  onToggle(): void;
  dispatch: Dispatch;
}) {
  const { entry, dispatch } = props;
  const { group, threads } = entry;
  const open = props.open && threads.length > 0;
  const busy = threads.filter((thread) => thread.waitingOn === "agent").length;
  const listId = `nav-threads-${group.id}`;
  return (
    <li class="nav-group" data-current={entry.current || undefined}>
      <div class="nav-group-row">
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
              {open ? "Hide" : "Show"} threads in {group.name}
            </span>
          </button>
        ) : (
          <span class="nav-disclose" aria-hidden="true" />
        )}
        <Link
          route={{ page: "group", id: group.id }}
          dispatch={dispatch}
          class="nav-link"
          aria-current={entry.current && props.thread === null ? "page" : undefined}
        >
          <span class="nav-name">{group.name}</span>
          {busy > 0 && <span class="working-dot" title={`${plural(busy, "agent")} working`} />}
          <span class="nav-count" title={plural(group.size, "item")}>
            {group.size}
          </span>
        </Link>
      </div>
      {open && (
        <ul id={listId} class="nav-threads">
          {threads.slice(0, shown).map((thread) => (
            <li key={thread.id}>
              <ThreadMenu thread={thread} dispatch={dispatch} swipe>
                <Link
                  route={{ page: "thread", id: thread.id }}
                  dispatch={dispatch}
                  class="nav-link nav-thread"
                  aria-current={thread.id === props.thread ? "page" : undefined}
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
                route={{ page: "group", id: group.id }}
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
  const [open, setOpen] = useState(readDoneOpen);
  if (!props.loaded) return null;
  const { done, dropped } = doneTabs(where.finished);
  const toggle = () => {
    writeDoneOpen(!open);
    setOpen(!open);
  };
  return (
    <nav class="sidebar-done" aria-label="Done">
      <h2 class="rail-title">
        <button
          type="button"
          class="done-toggle"
          aria-expanded={open}
          aria-controls="nav-done"
          onClick={toggle}
        >
          <Chevron />
          Done
          {done.length > 0 && <span class="nav-count">{done.length}</span>}
        </button>
      </h2>
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
                  title={thread.group.name}
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

// Whether the Done section was left open, kept in this browser only.
const doneOpenKey = "oriel.sidebar.done";

function readDoneOpen(): boolean {
  try {
    return localStorage.getItem(doneOpenKey) === "1";
  } catch {
    return false;
  }
}

function writeDoneOpen(open: boolean) {
  try {
    if (open) localStorage.setItem(doneOpenKey, "1");
    else localStorage.removeItem(doneOpenKey);
  } catch {
    // Storage may be off; the section just opens folded next time.
  }
}

// Jira, at the foot: its project as one quiet line, and Sync, which looks
// for what was made or deleted there since. While Jira can't be reached the
// window keeps what it had, and the line says so.
function Jira({ jira, dispatch }: { jira: JiraModel; dispatch: Dispatch }) {
  const connected = jira.view?.connected;
  if (!connected) return null;
  return (
    <section class="jira" aria-label="Jira">
      <p class="source-line" title={`${connected.project} on ${new URL(connected.site).host}`}>
        <TrackerIcon />
        <span class="source-name">{connected.project}</span>
        <span class="nav-count">{plural(connected.items, "item")}</span>
        <button
          type="button"
          class="quiet-action"
          disabled={jira.syncing}
          onClick={() => dispatch({ type: "jira", msg: { type: "syncClicked" } })}
        >
          {jira.syncing ? "Syncing…" : "Sync"}
        </button>
      </p>
      {jira.problem && (
        <p class="source-problem" role="alert">
          {jira.problem}
        </p>
      )}
    </section>
  );
}

// The folder, at the foot: one quiet line, and a path to type only when the
// user asks to add one.
function Folder({ folder, dispatch }: { folder: FolderModel; dispatch: Dispatch }) {
  const send = (msg: FolderMsg) => dispatch({ type: "folder", msg });
  const { view } = folder;
  const name = view?.path.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  return (
    <section class="folder" aria-label="Folder">
      {view && !folder.open && (
        <p class="source-line" title={view.path}>
          <FolderIcon />
          <span class="source-name">{name}</span>
          <span class="nav-count">{plural(view.items, "file")}</span>
          <button
            type="button"
            class="quiet-action"
            disabled={folder.pending}
            onClick={() => send({ type: "syncClicked" })}
          >
            {folder.pending ? "Syncing…" : "Sync"}
          </button>
        </p>
      )}
      {!folder.open ? (
        <button
          type="button"
          class="quiet-action add-folder"
          onClick={() => send({ type: "opened" })}
        >
          {view ? "Use another folder" : "Add a folder"}
        </button>
      ) : (
        <form
          class="folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            send({ type: "connectClicked" });
          }}
        >
          <label class="folder-label">
            A folder of markdown files, by its path
            <input
              value={folder.path}
              placeholder="~/notes"
              spellcheck={false}
              autoComplete="off"
              onInput={(event) => send({ type: "pathChanged", path: event.currentTarget.value })}
            />
          </label>
          <span class="folder-actions">
            <button
              type="submit"
              class="button primary"
              disabled={folder.pending || folder.path.trim() === ""}
            >
              {folder.pending ? "Reading…" : "Add"}
            </button>
            <button type="button" class="quiet-action" onClick={() => send({ type: "closed" })}>
              Cancel
            </button>
          </span>
          <span class="folder-note">Oriel reads its .md files and never changes them.</span>
        </form>
      )}
      {folder.problem && (
        <p class="source-problem" role="alert">
          {folder.problem}
        </p>
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

function PanelIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6 2.5v11" />
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

function PlusIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function TrackerIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5 6l1 1 2-2M5 10.5h6M9.5 6.5H11" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
    </svg>
  );
}
