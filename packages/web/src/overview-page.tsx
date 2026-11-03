// The overview (decision 0027), laid out as the window-explore spike's round
// 14 found best: the counts strip, then the ask bar's place, then the review
// links nobody has opened, the headlines and the workstreams; beside them,
// what no workstream holds yet and who has work in progress. The threads
// waiting on the user are in the sidebar, on every page, which the strip's
// count of them points to (OA-185). Every number and line is the server's,
// computed, never generated; each derived one shows its rule.
import type { ComponentChildren } from "preact";
import type { OverviewSection } from "@oriel/core/overview";
import { WindowUndos } from "./end-workstream.tsx";
import type { EndingModel } from "./ending.ts";
import type { JiraModel } from "./jira.ts";
import type { OverviewModel, OverviewMsg } from "./overview.ts";
import type { Route } from "./route.ts";
import { shown } from "./overview.ts";
import { needsYouId } from "./sidebar.tsx";
import { type Dispatch, ItemLink, ItemListContext, keyLabel, Link, plural } from "./parts.tsx";
import type { UndoNote, Undos } from "./undos.ts";
import type {
  CandidateView,
  HeadlineView,
  ItemRef,
  OverviewView,
  PersonRowView,
  WorkstreamRowView,
} from "./view.ts";
import { ConnectJira, StatusBar } from "./window-page.tsx";
import { AskBar } from "./window-chat-view.tsx";
import type { WindowChatModel } from "./window-chat.ts";

export function OverviewPage(props: {
  model: OverviewModel;
  // A workstream marked done, reopened or deleted, from the sidebar: its
  // Undo shares this page's one stack.
  ending: EndingModel;
  // The panel's adds, whose Undos share it too.
  added: Undos;
  jira: JiraModel;
  // Browse as the user last left it.
  browse: Route;
  chat: WindowChatModel;
  // Whether the window chat has a conversation.
  ongoing: boolean;
  // The first run's overview (decision 0038): its one-time line, and its
  // top question an instruction; and whether any AI is set up.
  firstRun: { line: boolean; questions: boolean };
  noAi: boolean;
  // Only a folder is connected, which Oriel only reads.
  folderOnly: boolean;
  // Shows the sidebar's list of the threads waiting on the user.
  onNeedsYou(): void;
  dispatch: Dispatch;
}) {
  const { model, ending, added, jira, browse, dispatch } = props;
  const { view } = model;
  const send = (msg: OverviewMsg) => dispatch({ type: "overview", msg });
  return (
    <main class="overview" aria-busy={view === null && model.problem === null}>
      <div class="overview-top">
        <ViewTabs current="overview" browse={browse} dispatch={dispatch} />
        {view && (
          <Counts view={view} model={model} onNeedsYou={props.onNeedsYou} dispatch={dispatch} />
        )}
      </div>
      {view && model.opened.includes("changed") && <Changed view={view} dispatch={dispatch} />}
      {props.firstRun.line && (
        <FirstRunLine
          jira={jira.view?.connected != null}
          folder={props.folderOnly || jira.view?.connected == null}
          ask={!props.noAi}
          dispatch={dispatch}
        />
      )}
      <AskBar
        chat={props.chat}
        view={view}
        ongoing={props.ongoing}
        firstRun={props.firstRun.questions}
        noAi={props.noAi}
        dispatch={dispatch}
      />
      {jira.view?.connectable && (
        <ConnectJira jira={jira} folderOnly={props.folderOnly} dispatch={dispatch} />
      )}
      {view === null ? (
        model.problem === null ? (
          <p class="overview-loading">Loading the overview…</p>
        ) : (
          <p class="overview-problem" role="alert">
            {model.problem}{" "}
            <button
              type="button"
              class="quiet-action"
              onClick={() => send({ type: "retryClicked" })}
            >
              Try again
            </button>
          </p>
        )
      ) : (
        <div class="overview-columns">
          <div class="overview-main">
            <Unopened view={view} dispatch={dispatch} />
            <Headlines view={view} dispatch={dispatch} />
            <PinnedSlot />
            <Workstreams view={view} model={model} browse={browse} dispatch={dispatch} />
          </div>
          <div class="overview-side">
            <Candidates view={view} model={model} dispatch={dispatch} />
            <People view={view} dispatch={dispatch} />
          </div>
        </div>
      )}
      {/* One stack: a workstream ended from the sidebar, the panel's adds,
          and the workstreams made here. */}
      <WindowUndos
        ending={ending}
        more={{
          notes: [
            ...added.notes,
            ...model.made.map((made): UndoNote => ({
              key: made.key,
              said: `Made the workstream ${made.workstream.name}, of ${plural(made.workstream.size, "item")}.`,
              label: `Undo making ${made.workstream.name}`,
              onUndo: made.workstream.undo && (() => send({ type: "undoClicked", key: made.key })),
              disabled: made.undoing,
            })),
          ],
          problem:
            model.failed === null
              ? added.problem
              : { said: model.failed, onDismiss: () => send({ type: "failedDismissed" }) },
        }}
        dispatch={dispatch}
      />
    </main>
  );
}

// The first run's one-time line (decision 0038): what the window and a
// workstream are, until it's dismissed or the first workstream is made.
function FirstRunLine(props: { jira: boolean; folder: boolean; ask: boolean; dispatch: Dispatch }) {
  const what =
    props.jira && props.folder
      ? "your Jira and your notes"
      : props.jira
        ? "your Jira"
        : "your notes";
  return (
    <aside class="first-run-line" aria-label="About the window">
      <p>
        <strong>This is your window:</strong> {what} in one place. To follow{" "}
        {props.jira ? "an epic" : "something"}, make it a <strong>workstream</strong>: Oriel keeps
        its items, your questions and its changes together.
        {props.ask && " Start with the first question below."}
      </p>
      <button
        type="button"
        class="quiet-action"
        onClick={() => props.dispatch({ type: "setup", msg: { type: "lineDismissed" } })}
      >
        Dismiss
      </button>
    </aside>
  );
}

// Where answers the user pinned go, under the headlines (decision 0030,
// a later story). Empty until then.
function PinnedSlot() {
  return null;
}

// The window's two views, side by side at the top of each.
export function ViewTabs(props: {
  current: "overview" | "browse";
  browse: Route;
  dispatch: Dispatch;
}) {
  const { current, browse, dispatch } = props;
  return (
    <nav class="tabs view-tabs" aria-label="Window">
      <Link
        route={{ page: "overview" }}
        dispatch={dispatch}
        aria-current={current === "overview" ? "page" : undefined}
      >
        Overview
      </Link>
      <Link
        route={browse}
        dispatch={dispatch}
        aria-current={current === "browse" ? "page" : undefined}
      >
        Browse
      </Link>
    </nav>
  );
}

const day = (instant: string) =>
  new Date(instant).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

// What changed since the user last looked, in four counts. The first opens
// what changed, by workstream; the third shows the threads waiting on the
// user, in the sidebar.
function Counts(props: {
  view: OverviewView;
  model: OverviewModel;
  onNeedsYou(): void;
  dispatch: Dispatch;
}) {
  const { view, model, dispatch } = props;
  const { counts } = view;
  const open = model.opened.includes("changed");
  return (
    <p class="overview-counts" data-section="strip">
      <span class="overview-since">
        {view.lastSeen === null
          ? "In the last 90 days:"
          : `Since you looked ${day(view.lastSeen)}:`}
      </span>
      <button
        type="button"
        class="overview-stat"
        aria-expanded={open}
        disabled={counts.changed === 0}
        onClick={() =>
          dispatch({
            type: "overview",
            msg: { type: "moreOpened", section: "changed", to: null },
          })
        }
      >
        <strong>{counts.changed}</strong> {counts.changed === 1 ? "item" : "items"} changed
      </button>
      <span class="overview-stat">
        <strong>{counts.workstreamsMoved}</strong>{" "}
        {counts.workstreamsMoved === 1 ? "workstream" : "workstreams"} moved
      </span>
      <button
        type="button"
        class="overview-stat"
        aria-controls={needsYouId}
        disabled={counts.needsYou === 0}
        onClick={props.onNeedsYou}
      >
        <strong>{counts.needsYou}</strong> {counts.needsYou === 1 ? "needs" : "need"} you
      </button>
      <span class="overview-stat">
        <strong>{counts.notInWorkstream}</strong> not in a workstream
      </span>
    </p>
  );
}

// What changed, by workstream, most first, and what no workstream holds.
function Changed({ view, dispatch }: { view: OverviewView; dispatch: Dispatch }) {
  const { elsewhere } = view.changed;
  const workstreams = view.changed.workstreams.slice(0, shown.workstreams);
  const rest = view.changed.workstreams.length - workstreams.length;
  return (
    <section class="overview-changed" aria-label="What changed, by workstream">
      <ul class="overview-rows">
        {workstreams.map((each) => (
          <li key={each.id} class="overview-row">
            <Link
              route={{ page: "workstream", id: each.id }}
              dispatch={dispatch}
              class="overview-title"
            >
              {each.name}
            </Link>
            <span class="overview-sub">{plural(each.moved, "item")} moved</span>
          </li>
        ))}
        {rest > 0 && (
          <li class="overview-row">
            <span class="overview-sub">and {plural(rest, "more workstream")}, below</span>
          </li>
        )}
        {elsewhere > 0 && (
          <li class="overview-row">
            <span class="overview-title">Not in a workstream</span>
            <span class="overview-sub">{plural(elsewhere, "item")} changed</span>
          </li>
        )}
      </ul>
    </section>
  );
}

function Section(props: {
  id: OverviewSection | "headlines";
  title: string;
  count?: number;
  more?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <section class="overview-section" data-section={props.id} aria-label={props.title}>
      <h2 class="overview-head">
        <span>{props.title}</span>
        {props.count !== undefined && <span class="overview-count">{props.count}</span>}
        {props.more && <span class="overview-head-more">{props.more}</span>}
      </h2>
      {props.children}
    </section>
  );
}

// "N more", in place.
function More(props: { section: OverviewSection; hidden: number; dispatch: Dispatch }) {
  if (props.hidden <= 0) return null;
  return (
    <button
      type="button"
      class="overview-more"
      onClick={() =>
        props.dispatch({
          type: "overview",
          msg: { type: "moreOpened", section: props.section, to: null },
        })
      }
    >
      {props.hidden} more
    </button>
  );
}

// The review links sent that nobody has opened yet, oldest first: the
// threads they are from wait on others, so they aren't in Needs you.
function Unopened({ view, dispatch }: { view: OverviewView; dispatch: Dispatch }) {
  const { unopened } = view.needsYou;
  return (
    <>
      {unopened.length > 0 && (
        <p class="overview-note">
          {plural(unopened.length, "review link")} sent and not opened yet:{" "}
          {unopened.slice(0, 3).map((link, at) => (
            <>
              {at > 0 && "; "}
              <Link
                key={link.changeSetId}
                route={{ page: "thread", id: link.thread.id, changeSet: link.changeSetId }}
                dispatch={dispatch}
              >
                {link.thread.title ?? link.workstream.name}
              </Link>
            </>
          ))}
          {unopened.length > 3 && "…"}
        </p>
      )}
    </>
  );
}

// The standing questions, one computed line each, with its rule on hover.
function Headlines({ view, dispatch }: { view: OverviewView; dispatch: Dispatch }) {
  if (view.headlines.length === 0) return null;
  const items = view.headlines.flatMap((line) =>
    line.subject.kind === "item" ? [line.subject.item.id] : [],
  );
  return (
    <section class="overview-headlines" data-section="headlines" aria-label="Headlines">
      <ItemListContext.Provider value={items}>
        {view.headlines.map((line) => (
          <Headline key={line.id} line={line} lastSeen={view.lastSeen} dispatch={dispatch} />
        ))}
      </ItemListContext.Provider>
    </section>
  );
}

function Headline(props: { line: HeadlineView; lastSeen: string | null; dispatch: Dispatch }) {
  const { line, lastSeen, dispatch } = props;
  const label =
    line.id === "moved" && lastSeen !== null ? `Moved most since ${day(lastSeen)}` : line.label;
  return (
    <p class="overview-headline" data-headline={line.id}>
      <span class="overview-headline-label" title={`Oriel rule: ${line.rule}`}>
        {label}
      </span>
      <span class="overview-headline-body">
        {line.subject.kind === "workstream" ? (
          <Link
            route={{ page: "workstream", id: line.subject.id }}
            dispatch={dispatch}
            class="overview-title"
          >
            {line.subject.name}
          </Link>
        ) : (
          <Item item={line.subject.item} />
        )}{" "}
        <span class="overview-sub">{line.detail}</span>
      </span>
    </p>
  );
}

// An item, by its key and title, opening in the panel.
function Item({ item }: { item: ItemRef }) {
  return (
    <ItemLink item={item} class="overview-title">
      <span class="key">{keyLabel(item)}</span> {item.title ?? "Not in the window"}
    </ItemLink>
  );
}

// Every open workstream, a line each: the ones that moved most, and a few
// gone quiet, which a cap would hide, until "more".
function Workstreams(props: {
  view: OverviewView;
  model: OverviewModel;
  browse: Route;
  dispatch: Dispatch;
}) {
  const { view, model, browse, dispatch } = props;
  const all = view.workstreams;
  const open = model.opened.includes("workstreams");
  // The first few, and then any gone quiet, which a cap would hide, a few
  // more at most.
  const quiet = all.slice(shown.workstreams).filter((row) => row.quiet);
  const rows = open ? all : [...all.slice(0, shown.workstreams), ...quiet.slice(0, shown.quiet)];
  return (
    <Section id="workstreams" title="Workstreams" count={all.length}>
      {all.length === 0 ? (
        <p class="overview-quiet">
          No workstreams yet. Make one from what isn't in a workstream yet, or from{" "}
          <Link route={browse} dispatch={dispatch}>
            Browse
          </Link>
          .
        </p>
      ) : (
        <ItemListContext.Provider value={rows.flatMap((row) => row.movedItems.map((i) => i.id))}>
          <ul class="overview-rows">
            {rows.map((row) => (
              <WorkstreamRow key={row.id} row={row} dispatch={dispatch} />
            ))}
          </ul>
        </ItemListContext.Provider>
      )}
      <More section="workstreams" hidden={all.length - rows.length} dispatch={dispatch} />
    </Section>
  );
}

function WorkstreamRow({ row, dispatch }: { row: WorkstreamRowView; dispatch: Dispatch }) {
  const threads = [
    row.threads.waiting > 0 && `${row.threads.waiting} waiting on you`,
    row.threads.working > 0 && `${row.threads.working} working`,
    row.threads.done > 0 && `${row.threads.done} done`,
    row.threads.dropped > 0 && `${row.threads.dropped} dropped`,
  ].filter(Boolean);
  return (
    <li class="overview-row overview-workstream" data-workstream={row.id}>
      <Link
        route={{ page: "workstream", id: row.id }}
        dispatch={dispatch}
        class="overview-title overview-workstream-name"
      >
        {row.name}
      </Link>
      <Spark values={row.activity} />
      <StatusBar status={row.status} />
      <span class="overview-moved">
        {row.moved > 0 ? (
          <>
            <strong>{row.moved}</strong> moved{row.movedDone > 0 && `, ${row.movedDone} done`}
          </>
        ) : (
          <span class="overview-quiet">none moved</span>
        )}
      </span>
      <span class="overview-last" title="Latest member update or thread activity">
        {row.idleDays === 0 ? "today" : `${row.idleDays}d ago`}
      </span>
      <span class="overview-workstream-detail">
        <span>
          {row.bySource.map((each) => `${each.count} ${each.source}`).join(" · ") || "No items"}
        </span>
        {threads.length > 0 && <span>{threads.join(" · ")}</span>}
        {row.movedItems.length > 0 && (
          <span class="overview-moved-items">
            {row.movedItems.map((item) => (
              <Item key={item.id} item={item} />
            ))}
          </span>
        )}
        {row.signals.map((signal) => (
          <span key={signal.rule} class="overview-signal" title={`Oriel rule: ${signal.rule}`}>
            {signal.text}
          </span>
        ))}
      </span>
    </li>
  );
}

// Changes logged on each of the last 14 days, as a line.
function Spark({ values }: { values: readonly number[] }) {
  const max = Math.max(1, ...values);
  const last = Math.max(1, values.length - 1);
  const points = values.map((v, at) => `${(at / last) * 56},${16 - (v / max) * 14}`).join(" ");
  const total = values.reduce((sum, v) => sum + v, 0);
  return (
    <svg
      class="overview-spark"
      data-quiet={total === 0 || undefined}
      viewBox="0 0 56 17"
      role="img"
      aria-label={`${plural(total, "change")} in the last 14 days`}
    >
      <title>{`${plural(total, "change")} in the last 14 days`}</title>
      <polyline points={points} />
    </svg>
  );
}

// Browse, filtered to what no workstream holds: all of Not in a workstream yet.
const unheld: Route = { page: "window", grouping: "epic", addTo: null, workstream: "none" };

// Every source's candidates and the most linked clusters, ranked together:
// the top few, each under the rule that found it, with its source; a
// cluster's row offers Make a workstream.
function Candidates(props: { view: OverviewView; model: OverviewModel; dispatch: Dispatch }) {
  const { view, model, dispatch } = props;
  const { rows, total } = view.candidates;
  const groups = [...Map.groupBy(rows, (row) => row.rule)];
  const items = rows.flatMap((row) =>
    row.subject.kind === "item"
      ? [row.subject.item.id]
      : row.subject.lead
        ? [row.subject.lead.id]
        : [],
  );
  return (
    <Section
      id="candidates"
      title="Not in a workstream yet"
      count={total}
      more={
        total > rows.length && (
          <Link
            route={unheld}
            dispatch={dispatch}
            msg={{
              type: "overview",
              msg: { type: "moreOpened", section: "candidates", to: unheld },
            }}
            class="overview-more"
          >
            {total - rows.length} more
          </Link>
        )
      }
    >
      {rows.length === 0 ? (
        <p class="overview-quiet">Every item a rule finds is in a workstream.</p>
      ) : (
        <ItemListContext.Provider value={items}>
          <div class="overview-rows overview-candidates">
            {groups.map(([rule, list]) => (
              <div key={rule} class="overview-group">
                <p class="overview-rule">
                  <span class="derived-tag">Oriel rule</span> {rule}
                </p>
                <ul>
                  {list.map((row) => (
                    <CandidateRow
                      key={candidateKey(row)}
                      row={row}
                      making={model.making}
                      made={model.made.some((each) => each.key === candidateKey(row))}
                      dispatch={dispatch}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ItemListContext.Provider>
      )}
    </Section>
  );
}

const candidateKey = (row: CandidateView) =>
  row.subject.kind === "item" ? row.subject.item.id : row.subject.key;

function CandidateRow(props: {
  row: CandidateView;
  making: string | null;
  made: boolean;
  dispatch: Dispatch;
}) {
  const { row, making, made, dispatch } = props;
  const { subject } = row;
  const sub = [row.source, row.detail].filter(Boolean).join(" · ");
  if (subject.kind === "item")
    return (
      <li class="overview-candidate" data-rule={row.rule}>
        <Item item={subject.item} />
        <span class="overview-sub">{sub}</span>
      </li>
    );
  const title = subject.lead ? (
    <ItemLink item={subject.lead} class="overview-title">
      {subject.label}
    </ItemLink>
  ) : (
    <span class="overview-title">{subject.label}</span>
  );
  return (
    <li class="overview-candidate" data-rule={row.rule}>
      {title}
      <span class="overview-sub">
        {plural(subject.size, "item")} · {sub}
      </span>
      <button
        type="button"
        class="quiet-action overview-make"
        disabled={making !== null || made}
        aria-label={`Make a workstream of ${subject.label}`}
        onClick={() =>
          dispatch({
            type: "overview",
            msg: { type: "makeClicked", grouping: subject.grouping, key: subject.key },
          })
        }
      >
        {making === subject.key ? "Making…" : "Make a workstream"}
      </button>
    </li>
  );
}

// Browse by assignee, in progress only: everyone's work in progress.
const everyone: Route = {
  page: "window",
  grouping: "assignee",
  addTo: null,
  status: "in-progress",
};

// Who has work in progress, most first: the top few, and "N more" into
// Browse by assignee.
function People({ view, dispatch }: { view: OverviewView; dispatch: Dispatch }) {
  const { rows, total } = view.people;
  return (
    <Section
      id="people"
      title="In progress, by person"
      count={total}
      more={
        total > rows.length && (
          <Link
            route={everyone}
            dispatch={dispatch}
            msg={{ type: "overview", msg: { type: "moreOpened", section: "people", to: everyone } }}
            class="overview-more"
          >
            {total - rows.length} more
          </Link>
        )
      }
    >
      {rows.length === 0 ? (
        <p class="overview-quiet">Nobody has work in progress.</p>
      ) : (
        <ul class="overview-rows overview-people">
          {rows.map((person) => (
            <PersonRow key={person.id} person={person} dispatch={dispatch} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function PersonRow({ person, dispatch }: { person: PersonRowView; dispatch: Dispatch }) {
  return (
    <li class="overview-row overview-person">
      <Link
        route={{
          page: "window",
          grouping: "assignee",
          addTo: null,
          assignee: person.id,
          status: "in-progress",
        }}
        dispatch={dispatch}
        class="overview-title"
      >
        {person.name}
      </Link>
      <span class="overview-sub">
        {person.inProgress}
        {person.top && ` · ${person.top.name} (${person.top.count})`}
      </span>
    </li>
  );
}
