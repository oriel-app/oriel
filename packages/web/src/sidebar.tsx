// The sidebar, on every page but a review link: the window and the inbox,
// the user's groups with their threads under them, and the connected folder.
// On a wide screen it folds to a strip of icons; on a narrow one it's a
// drawer the menu opens.
import { useLayoutEffect, useState } from "preact/hooks";
import type { FolderModel, FolderMsg } from "./folder.ts";
import { type Nav, type NavGroup, nav } from "./nav.ts";
import { Chevron, type Dispatch, Link, Mark, plural, stateNames } from "./parts.tsx";
import type { Model } from "./root.ts";

// A group shows this many of its threads; the rest are on its page.
const shown = 5;

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
          <span class="visually-hidden">{props.folded ? "Show sidebar" : "Hide sidebar"}</span>
        </button>
      </div>
      <nav class="sidebar-pages" aria-label="Pages">
        <Link
          route={{ page: "window", grouping: model.window?.grouping ?? "epic", addTo: null }}
          dispatch={dispatch}
          class="nav-link"
          aria-current={page === "window" ? "page" : undefined}
        >
          <WindowIcon />
          <span class="sidebar-label">Window</span>
        </Link>
        <Link
          route={{ page: "inbox" }}
          dispatch={dispatch}
          class="nav-link"
          aria-current={page === "inbox" ? "page" : undefined}
        >
          <InboxIcon />
          <span class="sidebar-label">Inbox</span>
          {where.working > 0 && (
            <span class="badge" title={`${where.working} working`}>
              {where.working}
            </span>
          )}
        </Link>
      </nav>
      <Groups where={where} dispatch={dispatch} />
      <Folder folder={model.folder} dispatch={dispatch} />
    </aside>
  );
}

const modKey = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";

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
  const working = threads.filter((thread) => thread.state === "working").length;
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
          {working > 0 && <span class="working-dot" title={plural(working, "working thread")} />}
          <span class="nav-count" title={plural(group.size, "item")}>
            {group.size}
          </span>
        </Link>
      </div>
      {open && (
        <ul id={listId} class="nav-threads">
          {threads.slice(0, shown).map((thread) => (
            <li key={thread.id}>
              <Link
                route={{ page: "thread", id: thread.id }}
                dispatch={dispatch}
                class="nav-link nav-thread"
                aria-current={thread.id === props.thread ? "page" : undefined}
              >
                <span
                  class="state-dot"
                  data-state={thread.state}
                  title={stateNames[thread.state]}
                />
                <span class="nav-name">{thread.title ?? "New thread"}</span>
              </Link>
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

// The folder, at the foot: one quiet line, and a path to type only when the
// user asks to add one.
function Folder({ folder, dispatch }: { folder: FolderModel; dispatch: Dispatch }) {
  const send = (msg: FolderMsg) => dispatch({ type: "folder", msg });
  const { view } = folder;
  const name = view?.path.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  return (
    <section class="folder" aria-label="Folder">
      {view && !folder.open && (
        <p class="folder-line" title={view.path}>
          <FolderIcon />
          <span class="folder-name">{name}</span>
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
        <p class="folder-problem" role="alert">
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

function InboxIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 9l1.6-5.2A1.5 1.5 0 0 1 5 2.75h6a1.5 1.5 0 0 1 1.4 1.05L14 9v3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z" />
      <path d="M2 9h3.5l1 1.75h3L10.5 9H14" />
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
