import { useEffect, useState } from "preact/hooks";
import { GroupPage } from "./group-page.tsx";
import { parseRoute } from "./route.ts";
import { InboxPage, ReviewPage } from "./other-pages.tsx";
import { type Dispatch, Link, Mark } from "./parts.tsx";
import { MenuIcon, Sidebar } from "./sidebar.tsx";
import type { Program } from "./program.ts";
import type { Effect } from "./http.ts";
import type { Model, Msg } from "./root.ts";
import { ThreadPage } from "./thread-page.tsx";
import { useProgram } from "./use-program.ts";
import { WindowPage } from "./window-page.tsx";

export function App({ program }: { program: Program<Model, Msg, Effect> }) {
  const [model, dispatch] = useProgram(program);
  // Back and forward re-route the app from the address bar.
  useEffect(() => {
    const routed = () =>
      dispatch({ type: "routed", route: parseRoute(location.pathname, location.search) });
    addEventListener("popstate", routed);
    return () => removeEventListener("popstate", routed);
  }, []);
  const [folded, setFolded] = useState(() => readFolded());
  const [drawer, setDrawer] = useState(false);
  const fold = () =>
    setFolded((was) => {
      writeFolded(!was);
      return !was;
    });
  // ⌘\ or Ctrl+\ folds the sidebar; Escape closes the drawer.
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (event.key === "\\" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        fold();
      } else if (event.key === "Escape") setDrawer(false);
    };
    addEventListener("keydown", pressed);
    return () => removeEventListener("keydown", pressed);
  }, []);
  // Going somewhere closes the drawer.
  useEffect(() => setDrawer(false), [model.route]);
  // A review link stands alone: no window, no threads, no navigation.
  if (model.route.page === "review")
    return model.review && <ReviewPage model={model.review} dispatch={dispatch} />;
  return (
    <div class="shell" data-folded={folded || undefined} data-drawer={drawer || undefined}>
      <Sidebar model={model} dispatch={dispatch} folded={folded} onFold={fold} />
      <button
        type="button"
        class="drawer-backdrop"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => setDrawer(false)}
      />
      <div class="shell-main">
        <Bar model={model} dispatch={dispatch} onMenu={() => setDrawer(true)} />
        <Page model={model} dispatch={dispatch} />
      </div>
    </div>
  );
}

// Whether the sidebar was left folded, kept in this browser only.
const foldedKey = "oriel.sidebar.folded";

function readFolded(): boolean {
  try {
    return localStorage.getItem(foldedKey) === "1";
  } catch {
    return false;
  }
}

function writeFolded(folded: boolean) {
  try {
    if (folded) localStorage.setItem(foldedKey, "1");
    else localStorage.removeItem(foldedKey);
  } catch {
    // Storage may be off; the sidebar just opens unfolded next time.
  }
}

function Page({ model, dispatch }: { model: Model; dispatch: Dispatch }) {
  switch (model.route.page) {
    case "window":
      return (
        model.window && (
          <WindowPage model={model.window} groups={model.groups} dispatch={dispatch} />
        )
      );
    case "group":
      return model.group && <GroupPage model={model.group} dispatch={dispatch} />;
    case "thread":
      return model.thread && <ThreadPage model={model.thread} dispatch={dispatch} />;
    case "inbox":
      return <InboxPage threads={model.threads} dispatch={dispatch} />;
    case "review":
      return null;
  }
}

// On a narrow screen only: the menu, which opens the sidebar as a drawer, and
// the brand. Wide screens have the sidebar instead.
function Bar({ model, dispatch, onMenu }: { model: Model; dispatch: Dispatch; onMenu(): void }) {
  const working = model.threads?.filter((thread) => thread.state === "working").length ?? 0;
  return (
    <header class="bar">
      <button type="button" class="bar-menu" aria-controls="sidebar" onClick={onMenu}>
        <MenuIcon />
        <span class="visually-hidden">Open the sidebar</span>
        {working > 0 && <span class="bar-working" title={`${working} working`} />}
      </button>
      <Link
        route={{ page: "window", grouping: model.window?.grouping ?? "epic", addTo: null }}
        dispatch={dispatch}
        class="brand"
      >
        <Mark />
        Oriel
      </Link>
    </header>
  );
}
