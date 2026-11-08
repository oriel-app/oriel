import { useEffect, useRef, useState } from "preact/hooks";
import { WorkstreamPage } from "./workstream-page.tsx";
import { parseRoute } from "./route.ts";
import { DonePage, ReviewPage } from "./other-pages.tsx";
import { doneTab, workstreamThreads, nav } from "./nav.ts";
import {
  ConnectorsContext,
  type Dispatch,
  ItemLinksContext,
  Link,
  Mark,
  plural,
  SendKeyContext,
  TimeFormatContext,
} from "./parts.tsx";
import { ItemPanel } from "./item-panel.tsx";
import { MenuIcon, needsYouId, Sidebar } from "./sidebar.tsx";
import { Closing, closingProblem } from "./close-thread.tsx";
import { Endings } from "./end-workstream.tsx";
import type { Program } from "./program.ts";
import type { Effect } from "./http.ts";
import { currentWorkstream, type Model, type Msg } from "./root.ts";
import { placeIn } from "./panel.ts";
import { addUndos } from "./panel-adds.ts";
import { editUndos } from "./panel-edits.ts";
import { approvedUndos } from "./approved.ts";
import { rejectedUndos } from "./rejected.ts";
import { movingUndos } from "./moving.ts";
import { NewThreadPage, ThreadPage } from "./thread-page.tsx";
import { BeadStatus } from "./undo-stack.tsx";
import type { Undos } from "./undos.ts";
import { useProgram } from "./use-program.ts";
import { OverviewPage } from "./overview-page.tsx";
import { noAi, sendKey, timeFormat } from "./settings.ts";
import { SettingsPage } from "./settings-page.tsx";
import { SetupPage } from "./setup-page.tsx";
import { windowRoute } from "./update.ts";
import { WindowPage } from "./window-page.tsx";
import { ConnectNotices } from "./connect-steps.tsx";
import { WindowChat } from "./window-chat-view.tsx";

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
  // The overview's count of the threads waiting on the user shows them: the
  // sidebar opens, if it's folded or a drawer, a search in it clears, and
  // their list takes focus, marked for a moment, once it shows.
  const needsYouAsked = useRef(false);
  const showNeedsYou = () => {
    needsYouAsked.current = true;
    if (model.search.query !== "") dispatch({ type: "search", msg: { type: "cleared" } });
    if (matchMedia(narrow).matches) setDrawer(true);
    else if (folded) fold();
    else markNeedsYou();
  };
  const markNeedsYou = () => {
    const list = document.getElementById(needsYouId);
    if (!list) return;
    needsYouAsked.current = false;
    list.focus();
    list.removeAttribute("data-shown");
    void list.offsetWidth;
    list.setAttribute("data-shown", "");
  };
  useEffect(() => {
    if (drawer && !needsYouAsked.current)
      document.querySelector<HTMLElement>("#sidebar a")?.focus();
  }, [drawer]);
  useEffect(() => {
    if (needsYouAsked.current) markNeedsYou();
  }, [drawer, folded, model.search.query]);
  // A review link stands alone: no window, no threads, no navigation.
  if (model.route.page === "review")
    return (
      model.review && (
        <ConnectorsContext.Provider value={model.connectors}>
          <ReviewPage model={model.review} dispatch={dispatch} />
        </ConnectorsContext.Provider>
      )
    );
  // So does the first run, until it has finished (decision 0038), in the
  // person's time format, as every page but a review link's.
  if (model.route.page === "setup")
    return (
      <TimeFormatContext.Provider value={timeFormat(model.settings)}>
        <SetupPage model={model} dispatch={dispatch} />
      </TimeFormatContext.Provider>
    );
  // The panel's adds, where an approval took the page and how its apply
  // ended, and a close that failed, as notes in whichever stack of Undos is
  // on screen: the bead.
  const adds = addUndos(model.panelAdds, (msg) => dispatch({ type: "panelAdd", msg }));
  const edits = editUndos(model.panelEdits, (msg) => dispatch({ type: "panelEdit", msg }));
  const approved = approvedUndos(model.approved, (msg) => dispatch({ type: "approved", msg }));
  const rejected = rejectedUndos(model.rejected, (msg) => dispatch({ type: "rejected", msg }));
  const moved = movingUndos(model.moving, (msg) => dispatch({ type: "moving", msg }));
  const added = {
    notes: [...adds.notes, ...edits.notes, ...approved.notes, ...rejected.notes, ...moved.notes],
    problem:
      moved.problem ??
      adds.problem ??
      edits.problem ??
      approved.problem ??
      rejected.problem ??
      closingProblem(model.closing, dispatch),
  };
  return (
    <SendKeyContext.Provider value={sendKey(model.settings)}>
      <TimeFormatContext.Provider value={timeFormat(model.settings)}>
        <ConnectorsContext.Provider value={model.connectors}>
          <div
            class="shell"
            data-folded={folded || undefined}
            data-drawer={drawer || undefined}
            data-panel={model.panel ? "" : undefined}
            data-chat={model.route.page === "overview" && model.chat.open ? "" : undefined}
          >
            <Sidebar model={model} dispatch={dispatch} folded={folded} onFold={fold} />
            <div class="frame" aria-hidden="true" />
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
                <Page model={model} added={added} onNeedsYou={showNeedsYou} dispatch={dispatch} />
              </ItemLinksContext.Provider>
            </div>
            {model.route.page === "overview" && model.chat.open && !model.panel && (
              <WindowChat chat={model.chat} thread={model.thread} dispatch={dispatch} />
            )}
            {model.panel && (
              <ItemLinksContext.Provider value={{ dispatch, items: noItems }}>
                <ItemPanel
                  model={model.panel}
                  place={placeIn(model.panelList, model.panel.id)}
                  workstream={currentWorkstream(model)}
                  adds={model.panelAdds}
                  edits={model.panelEdits}
                  dispatch={dispatch}
                />
              </ItemLinksContext.Provider>
            )}
            <Closing model={model.closing} dispatch={dispatch} />
            <BeadStatus />
            <Endings
              model={model.ending}
              added={added}
              shownByPage={
                model.route.page === "workstream" ||
                (model.route.page === "overview" && model.overview !== null)
              }
              dispatch={dispatch}
            />
          </div>
        </ConnectorsContext.Provider>
      </TimeFormatContext.Provider>
    </SendKeyContext.Provider>
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

function Page(props: { model: Model; added: Undos; onNeedsYou(): void; dispatch: Dispatch }) {
  const { model, dispatch } = props;
  switch (model.route.page) {
    case "overview":
      return (
        model.overview && (
          <OverviewPage
            model={model.overview}
            added={props.added}
            ending={model.ending}
            connections={model.connections}
            connectors={model.connectors}
            browse={windowRoute(model.window)}
            chat={model.chat}
            ongoing={model.thread !== null}
            firstRun={{
              line: model.setup.view?.firstRun?.line === true,
              questions: model.setup.view?.firstRun?.firstRun === true,
            }}
            noAi={noAi(model.settings)}
            onNeedsYou={props.onNeedsYou}
            dispatch={dispatch}
          />
        )
      );
    case "window":
      return (
        model.window && (
          <WindowPage
            model={model.window}
            workstreams={model.workstreams}
            connect={
              <ConnectNotices connections={model.connections} connectors={model.connectors} />
            }
            dispatch={dispatch}
          />
        )
      );
    case "workstream":
      return (
        model.workstream && (
          <WorkstreamPage
            model={model.workstream}
            workstreams={model.workstreams}
            threads={workstreamThreads(model, model.workstream.id)}
            ending={model.ending}
            added={props.added}
            dispatch={dispatch}
          />
        )
      );
    case "thread":
      return model.thread && <ThreadPage model={model.thread} dispatch={dispatch} />;
    case "new-thread":
      return (
        model.newThread && (
          <NewThreadPage
            model={model.newThread}
            workstreams={model.workstreams}
            dispatch={dispatch}
          />
        )
      );
    case "done": {
      const where = nav(model);
      return (
        <DonePage
          finished={model.threads && where.finished}
          workstreams={where.done}
          tab={doneTab(model.route)}
          number={model.route.number ?? 1}
          dispatch={dispatch}
        />
      );
    }
    case "settings":
      return (
        <SettingsPage
          model={model.settings}
          connections={model.connections}
          connectors={model.connectors}
          setup={model.setup}
          section={model.route.section}
          dispatch={dispatch}
        />
      );
    case "review":
    case "setup":
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
      <Link route={{ page: "overview" }} dispatch={dispatch} class="brand">
        <Mark />
        Oriel
      </Link>
    </header>
  );
}
