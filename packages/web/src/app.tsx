import { useEffect, useState } from "preact/hooks";
import { WorkstreamPage } from "./workstream-page.tsx";
import { parseRoute } from "./route.ts";
import { DonePage, ReviewPage } from "./other-pages.tsx";
import { doneTab, workstreamThreads, nav } from "./nav.ts";
import { type Dispatch, ItemLinksContext, Link, Mark, plural } from "./parts.tsx";
import { ItemPanel } from "./item-panel.tsx";
import { MenuIcon, Sidebar } from "./sidebar.tsx";
import { Closing } from "./close-thread.tsx";
import type { Program } from "./program.ts";
import type { Effect } from "./http.ts";
import type { Model, Msg } from "./root.ts";
import { NewThreadPage, ThreadPage } from "./thread-page.tsx";
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
  // Closing the drawer by hand gives focus back to the menu that opened it.
  const closeDrawer = () => {
    if (!document.querySelector(".shell[data-drawer]")) return;
    setDrawer(false);
    document.querySelector<HTMLElement>(".bar-menu")?.focus();
  };
  const fold = () =>
    setFolded((was) => {
      writeFolded(!was);
      return !was;
    });
  // ⌘\ or Ctrl+\ folds the sidebar, where there is one to fold: not on a
  // review link, and not on a narrow screen, where it's a drawer. Escape
  // closes the drawer.
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (event.key === "\\" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        if (!document.getElementById("sidebar") || matchMedia(narrow).matches) return;
        event.preventDefault();
        fold();
      } else if (event.key === "Escape") {
        // The drawer closes first, over the panel; then the panel.
        if (document.querySelector(".shell[data-drawer]")) closeDrawer();
        else if (document.querySelector(".item-panel")) dispatch({ type: "panelClosed" });
      }
    };
    addEventListener("keydown", pressed);
    return () => removeEventListener("keydown", pressed);
  }, []);
  // Going somewhere closes the drawer. Opening it moves focus into it.
  useEffect(() => {
    // Focus left on a link in the closing drawer would vanish with it.
    if (matchMedia(narrow).matches && document.activeElement?.closest("#sidebar"))
      document.querySelector<HTMLElement>(".bar-menu")?.focus();
    setDrawer(false);
  }, [model.route]);
  useEffect(() => {
    if (drawer) document.querySelector<HTMLElement>("#sidebar a")?.focus();
  }, [drawer]);
  // A review link stands alone: no window, no threads, no navigation.
  if (model.route.page === "review")
    return model.review && <ReviewPage model={model.review} dispatch={dispatch} />;
  return (
    <div
      class="shell"
      data-folded={folded || undefined}
      data-drawer={drawer || undefined}
      data-panel={model.panel ? "" : undefined}
    >
      <Sidebar model={model} dispatch={dispatch} folded={folded} onFold={fold} />
      <button
        type="button"
        class="drawer-backdrop"
        tabIndex={-1}
        aria-hidden="true"
        onClick={closeDrawer}
      />
      <div class="shell-main">
        <Bar model={model} dispatch={dispatch} open={drawer} onMenu={() => setDrawer(true)} />
        <ItemLinksContext.Provider value={{ dispatch, items: noItems }}>
          <Page model={model} dispatch={dispatch} />
        </ItemLinksContext.Provider>
      </div>
      {model.panel && (
        <ItemLinksContext.Provider value={{ dispatch, items: noItems }}>
          <ItemPanel model={model.panel} dispatch={dispatch} />
        </ItemLinksContext.Provider>
      )}
      <Closing model={model.closing} dispatch={dispatch} />
    </div>
  );
}

// Links to items on any page, and in the panel, open the panel; a thread's
// page knows its items' addresses too.
const noItems: ReadonlyMap<string, string> = new Map();

// Where the sidebar is a drawer; window.css says the same.
const narrow = "(max-width: 760px)";

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
          <WindowPage
            model={model.window}
            workstreams={model.workstreams}
            jira={model.jira}
            dispatch={dispatch}
          />
        )
      );
    case "workstream":
      return (
        model.workstream && (
          <WorkstreamPage
            model={model.workstream}
            threads={workstreamThreads(model, model.workstream.id)}
            dispatch={dispatch}
          />
        )
      );
    case "thread":
      return model.thread && <ThreadPage model={model.thread} dispatch={dispatch} />;
    case "new-thread":
      return model.newThread && <NewThreadPage model={model.newThread} dispatch={dispatch} />;
    case "done":
      return (
        <DonePage
          finished={model.threads && nav(model).finished}
          tab={doneTab(model.route)}
          number={model.route.number ?? 1}
          dispatch={dispatch}
        />
      );
    case "review":
      return null;
  }
}

// On a narrow screen only: the menu, which opens the sidebar as a drawer and
// counts the threads waiting on the user, and the brand. Wide screens have
// the sidebar instead.
function Bar(props: { model: Model; dispatch: Dispatch; open: boolean; onMenu(): void }) {
  const { model, dispatch } = props;
  const { needsYou } = nav(model);
  return (
    <header class="bar">
      <button
        type="button"
        class="bar-menu"
        aria-controls="sidebar"
        aria-expanded={props.open}
        onClick={props.onMenu}
      >
        <MenuIcon />
        <span class="visually-hidden">
          Open the sidebar
          {needsYou > 0 && `, ${plural(needsYou, "thread")} waiting on you`}
        </span>
        {needsYou > 0 && (
          <span class="bar-count" aria-hidden="true">
            {needsYou}
          </span>
        )}
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
