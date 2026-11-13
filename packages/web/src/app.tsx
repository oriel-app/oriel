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
  OpenItemContext,
  Mark,
  plural,
  SendKeyContext,
  TimeFormatContext,
} from "./parts.tsx";
import { ItemPanel, PanelDock } from "./item-panel.tsx";
import { type PanelDock as Docked, PanelDockContext } from "./dock.tsx";
import { MenuIcon, needsYouId, Sidebar } from "./sidebar.tsx";
import { Closing, closingProblem } from "./close-thread.tsx";
import { Endings } from "./end-workstream.tsx";
import type { Program } from "./program.ts";
import type { Effect } from "./http.ts";
import { askable, currentWorkstream, type Model, type Msg, onWindow } from "./root.ts";
import { panelName, placeIn } from "./panel.ts";
import { expected } from "./thread.ts";
import { addUndos } from "./panel-adds.ts";
import { editUndos } from "./panel-edits.ts";
import { approvedUndos } from "./approved.ts";
import { rejectedUndos } from "./rejected.ts";
import { movingUndos } from "./moving.ts";
import { NewThreadPage, ThreadPage, threadComposer } from "./thread-page.tsx";
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
import { OverviewComposer, WindowChat, windowChatComposer } from "./window-chat-view.tsx";
import { chatThread, type Question, questionsFrom } from "./window-chat.ts";
import { standingIn } from "./connections.ts";

export function App({ program }: { program: Program<Model, Msg, Effect> }) {
  const [model, dispatch] = useProgram(program, railMoved);
  useEffect(() => {
    const routed = () =>
      dispatch({ type: "routed", route: parseRoute(location.pathname, location.search) });
    addEventListener("popstate", routed);
    return () => removeEventListener("popstate", routed);
  }, []);
  const [folded, setFolded] = useState(() => readFolded());
  const [drawer, setDrawer] = useState(false);
  const dock = dockOf(model, useMatches(railRoom), dispatch);
  const itemFolded = dock?.folded === true;
  const chatOpen = onWindow(model.route) && model.chat.open;
  useComposerFocus([chatOpen, model.panel?.id, itemFolded]);
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
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (event.key === "\\" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        if (!document.getElementById("sidebar") || matchMedia(narrow).matches) return;
        event.preventDefault();
        fold();
      } else if (event.key === "Escape") {
        if (document.querySelector(".shell[data-drawer]")) closeDrawer();
        else if (document.querySelector(".item-panel")) dispatch({ type: "panelClosed" });
      }
    };
    addEventListener("keydown", pressed);
    return () => removeEventListener("keydown", pressed);
  }, []);
  useEffect(() => {
    // Focus left on a link in the closing drawer would vanish with it.
    if (matchMedia(narrow).matches && document.activeElement?.closest("#sidebar"))
      document.querySelector<HTMLElement>(".bar-menu")?.focus();
    setDrawer(false);
  }, [model.route]);
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
  if (model.route.page === "review")
    return (
      model.review && (
        <ConnectorsContext.Provider value={model.connectors}>
          <ReviewPage model={model.review} dispatch={dispatch} />
        </ConnectorsContext.Provider>
      )
    );
  if (model.route.page === "setup")
    return (
      <TimeFormatContext.Provider value={timeFormat(model.settings)}>
        <SetupPage model={model} dispatch={dispatch} />
      </TimeFormatContext.Provider>
    );
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
          <OpenItemContext.Provider value={model.panel?.id ?? null}>
            <PanelDockContext.Provider value={dock}>
              <div
                class="shell"
                data-folded={folded || undefined}
                data-drawer={drawer || undefined}
                data-panel={model.panel ? "" : undefined}
                data-chat={chatOpen ? "" : undefined}
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
                  <Bar
                    model={model}
                    dispatch={dispatch}
                    open={drawer}
                    onMenu={() => setDrawer(true)}
                  />
                  <ItemLinksContext.Provider value={{ dispatch, items: noItems }}>
                    <Page
                      model={model}
                      added={added}
                      onNeedsYou={showNeedsYou}
                      dispatch={dispatch}
                    />
                  </ItemLinksContext.Provider>
                </div>
                {chatOpen && (!model.panel || itemFolded) && (
                  <WindowChat
                    chat={model.chat}
                    thread={model.thread}
                    questions={startQuestions(model)}
                    dispatch={dispatch}
                  />
                )}
                {model.panel && !itemFolded && (
                  <ItemLinksContext.Provider value={{ dispatch, items: noItems }}>
                    <ItemPanel
                      dock={dock && <PanelDock />}
                      askable={askable(model)}
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
            </PanelDockContext.Provider>
          </OpenItemContext.Provider>
        </ConnectorsContext.Provider>
      </TimeFormatContext.Provider>
    </SendKeyContext.Provider>
  );
}

const noItems: ReadonlyMap<string, string> = new Map();

// window.css has the same breakpoint.
const narrow = "(max-width: 760px)";

function railMoved(before: Model, after: Model): boolean {
  const open = (model: Model) => onWindow(model.route) && model.chat.open && !model.panel;
  return (
    open(before) !== open(after) &&
    onWindow(before.route) &&
    onWindow(after.route) &&
    before.panel === null &&
    after.panel === null &&
    matchMedia(railRoom).matches
  );
}

// window.css has the same breakpoint.
const railRoom = "(min-width: 1100px)";

function dockOf(model: Model, wide: boolean, dispatch: Dispatch): Docked | null {
  const { panel, route } = model;
  if (!panel) return null;
  const chat = onWindow(route) && model.chat.open;
  const thread = chat ? chatThread(model.thread) : model.thread;
  const view = thread && expected(thread);
  const composer = chat
    ? windowChatComposer(model.chat, model.thread, dispatch)
    : route.page === "thread" && thread && view && !wide
      ? threadComposer(thread, view, dispatch)
      : null;
  if (!composer) return null;
  return {
    composer,
    view,
    asked: chat ? model.chat.asked : null,
    folded: model.panelFolded,
    item: panelName(panel),
    onFold: (folded) => dispatch({ type: "panelFolded", folded }),
    onClose: () => dispatch({ type: "panelClosed" }),
  };
}

// A composer gone takes the focus with it, which leaves it on the body.
function useComposerFocus(moved: unknown[]) {
  const had = useRef(false);
  useEffect(() => {
    const seen = (event: FocusEvent) => {
      had.current =
        event.target instanceof HTMLElement &&
        event.target.matches(":is(.composer, .panel-dock) .chat-input-field");
    };
    addEventListener("focusin", seen);
    return () => removeEventListener("focusin", seen);
  }, []);
  useEffect(() => {
    const lost = !document.activeElement || document.activeElement === document.body;
    if (!had.current || !lost) return;
    document
      .querySelector<HTMLTextAreaElement>(
        ":is(.panel-dock, .window-chat, .overview-dock) .chat-input-field",
      )
      ?.focus();
  }, moved);
}

function useMatches(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const changed = () => setMatches(list.matches);
    changed();
    list.addEventListener("change", changed);
    return () => list.removeEventListener("change", changed);
  }, [query]);
  return matches;
}

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

function startQuestions(model: Model): Question[] {
  const view = model.overview?.view;
  if (!view || noAi(model.settings)) return [];
  const firstRun = model.setup.view?.firstRun?.firstRun === true;
  return questionsFrom(view, firstRun, standingIn(model.connectors, model.connections).length > 0);
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
            thread={model.thread}
            ongoing={model.thread !== null}
            questions={startQuestions(model)}
            firstRun={{ line: model.setup.view?.firstRun?.line === true }}
            noAi={noAi(model.settings)}
            onNeedsYou={props.onNeedsYou}
            dispatch={dispatch}
          />
        )
      );
    case "window":
      return (
        model.window && (
          <>
            <WindowPage
              model={model.window}
              workstreams={model.workstreams}
              connect={
                <ConnectNotices connections={model.connections} connectors={model.connectors} />
              }
              dispatch={dispatch}
            />
            {model.chat.hiddenOnBrowse && (
              <OverviewComposer
                chat={model.chat}
                thread={model.thread}
                ongoing={model.thread !== null}
                questions={[]}
                noAi={noAi(model.settings)}
                dispatch={dispatch}
              />
            )}
          </>
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
            adds={model.panelAdds}
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
            threads={model.threads}
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
