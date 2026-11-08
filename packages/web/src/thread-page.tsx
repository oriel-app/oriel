// A thread: the chat in the middle, the region it works in on the right.
// Runs stay folded until opened; a search is its own block; a change set is
// a diff with what can be done with it.
import { type ComponentChildren, Fragment } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";
import { BlockFigure, ReviewTables, SketchFigure } from "./block.tsx";
import { namedOnce, type Observe, sourcesOf, watchStuck, writes } from "./change-set.ts";
import { ChatInput } from "./chat-input.tsx";
import { watchLatest } from "./effects.ts";
import { kindOfItem } from "./item-id.ts";
import {
  addressOf,
  Chip,
  type Dispatch,
  DropZone,
  ItemKey,
  ChipsContext,
  ItemLinksContext,
  ItemListContext,
  Member,
  Link,
  Markdown,
  plural,
  points,
  QuotesContext,
  Stamp,
  StateChip,
  waitingNames,
} from "./parts.tsx";
import { changeSetAnchor } from "./route.ts";
import { planPrompt } from "./workstream.ts";
import { Tooltip } from "./tooltip.tsx";
import { ToReview } from "./to-review.tsx";
import { SecondLook } from "./second-look.tsx";
import { lines, type Piece } from "./text-diff.ts";
import {
  type Entry,
  entriesOf,
  expected,
  foldable,
  folded,
  type NewThreadModel,
  type NewThreadMsg,
  optionKey,
  optionText,
  removable,
  type SetStep,
  shownLook,
  stepLabel,
  lineKey,
  type ThreadModel,
  type ThreadMsg,
  blankWorkstreamName,
} from "./thread.ts";
import { maxNameChars } from "./update.ts";
import {
  type ActionLineView,
  type ChangeSetView,
  type DiffView,
  type HeldFrom,
  type ItemRef,
  type ItemValue,
  type MemberView,
  type NoteView,
  type RunView,
  type SecondLookView,
  type ThreadSummaryView,
  type ThreadView,
  type WorkstreamRef,
  type WorkstreamSummary,
  holding,
  toReview,
  waitingOn,
} from "./view.ts";

const fieldNames: Record<string, string> = {
  summary: "Title",
  description: "Description",
  points: "Estimate",
  assignee: "Assignee",
  epic: "Epic",
  status: "Status",
  replies: "Replies",
};
// One of several of a kind, such as a link, a comment or a reply, by its
// prefix.
const fieldKinds: Record<string, string> = {
  "link:": "Link",
  "comment:": "Comment",
  "reply:": "Reply",
};
const fieldName = (name: string) =>
  fieldNames[name] ??
  Object.entries(fieldKinds).find(([prefix]) => name.startsWith(prefix))?.[1] ??
  name;

// An estimate reads in points; any other value as the server sent it.
function withUnits(field: Field): Field {
  if (field.name !== "points") return field;
  const shown = (text: string | null) =>
    text !== null && text.trim() !== "" && Number.isFinite(Number(text))
      ? points(Number(text))
      : text;
  return { ...field, before: shown(field.before), after: shown(field.after) };
}

const statusNames: Record<ChangeSetView["status"], string> = {
  open: "Awaiting review",
  approved: "Ready to apply",
  stopped: "Stopped",
  rejected: "Rejected",
  applied: "Applied",
  partial: "Partly applied",
  applying: "Applying…",
};

// A set that started applying and went no further says which way it ended:
// stopped partway, waiting on the person, or the rest dismissed.
const statusName = (set: ChangeSetView): string =>
  set.status !== "partial"
    ? statusNames[set.status]
    : set.decision?.kind === "rejected"
      ? "Partly applied, the rest dismissed"
      : set.errors.length > 0
        ? "Stopped partway"
        : statusNames.partial;

export function ThreadPage({ model, dispatch }: { model: ThreadModel; dispatch: Dispatch }) {
  const send = (msg: ThreadMsg) => dispatch({ type: "thread", msg });
  // Where the page is, for as long as this thread is on screen.
  useEffect(() => watchLatest(send), [model.id]);
  // A decision sent from here shows before the server answers it.
  const view = expected(model);
  if (model.deleted)
    return (
      <main class="page">
        <p class="failed" role="status">
          This thread was deleted.
        </p>
        <Link
          route={{ page: "window", grouping: "epic", addTo: null }}
          dispatch={dispatch}
          class="quiet-action"
        >
          Go to the window
        </Link>
      </main>
    );
  if (view === null)
    return (
      <main class="page">
        {model.status === "failed" ? (
          <p class="failed" role="alert">
            This thread didn't load.
          </p>
        ) : (
          <p class="loading">Loading…</p>
        )}
      </main>
    );
  const waiting = waitingOn({
    state: view.state,
    running: view.running,
    held: holding(view.entries),
    changeSets: view.changeSets,
    windowChat: view.windowChat === true,
  });
  const review = view.changeSets.filter(toReview);
  return (
    <ItemLinksContext.Provider value={{ dispatch, items: itemsOf(view) }}>
      <DropZone
        class="thread-layout"
        label={`Drop to add to ${view.workstream.name}`}
        onDrop={(dropped) => send({ type: "dropped", dropped })}
      >
        <main class="thread" aria-busy={view.running}>
          <header class="thread-head">
            <Link
              route={{ page: "workstream", id: view.workstream.id }}
              dispatch={dispatch}
              class="crumb"
            >
              {view.workstream.name}
            </Link>
            <div class="thread-title-row">
              <h1 class="thread-title" tabIndex={-1}>
                {view.title ?? "New thread"}
              </h1>
              <StateChip
                state={view.state}
                waitingOn={waiting}
                onJump={
                  waiting === "review" && review[0]
                    ? () => send({ type: "toReviewClicked", changeSetId: review[0]?.id ?? "" })
                    : undefined
                }
              />
              {view.state !== "done" && (
                <button
                  type="button"
                  class="quiet-action"
                  onClick={() => send({ type: "doneClicked" })}
                >
                  Mark done
                </button>
              )}
            </div>
          </header>
          <ol class="chat">
            {entriesOf(view.entries).map((entry) => (
              <ChatEntryItem key={entry.seq} entry={entry} model={model} view={view} send={send} />
            ))}
            {view.running && (
              <li class="working" role="status">
                <span class="working-dot" /> Working…
              </li>
            )}
          </ol>
          <Dock>
            <ChatInput
              class="composer"
              elevation="raised"
              label="Message"
              above={
                <ToReview
                  ids={review.map((set) => set.id)}
                  onShow={(changeSetId) => send({ type: "toReviewClicked", changeSetId })}
                />
              }
              draft={model.draft}
              busy={model.sending}
              running={view.running}
              notice={model.notice}
              placeholder={
                view.members.length === 0
                  ? planPrompt
                  : `Ask about ${plural(view.members.length, "item")}…`
              }
              reads={readsOf(view)}
              onDraft={(text) => send({ type: "draftChanged", text })}
              onSubmit={() => send({ type: "sendClicked" })}
              onStop={() => send({ type: "stopClicked" })}
            />
          </Dock>
        </main>
        <Region view={view} syncing={model.syncing} onSync={() => send({ type: "syncClicked" })} />
      </DropZone>
    </ItemLinksContext.Provider>
  );
}

// A thread from nothing, before its first message: the composer, and the
// workstream it starts in, at the top of the rail where a thread's items
// will be, or beside the title where the rail waits below the chat. "New
// workstream" is the default, which sending makes, with the thread; or the
// person picks one already open, and its items are the thread's. While it's
// the default, the person may name the new workstream, under the picker;
// left as it is, Oriel names it. Either way,
// what a change set here creates joins it. A new thread has no items of its
// own, so the rail says nothing of them until a workstream is picked.
export function NewThreadPage({
  model,
  workstreams,
  threads,
  dispatch,
}: {
  model: NewThreadModel;
  workstreams: readonly WorkstreamSummary[] | null;
  threads: readonly ThreadSummaryView[] | null;
  dispatch: Dispatch;
}) {
  const send = (msg: NewThreadMsg) => dispatch({ type: "newThread", msg });
  const open = startable(workstreams);
  const labels = pickerLabels(open, threads ?? []);
  const picked = open.find((workstream) => workstream.id === model.workstream) ?? null;
  // One picker, shown in one place at a time: CSS hides the other, so only
  // one is ever in the accessibility tree.
  const named = (at: "head" | "rail") =>
    !picked && (
      <label class="name-field new-workstream-name" data-at={at}>
        Workstream title
        <input
          type="text"
          value={model.workstreamName}
          maxLength={maxNameChars}
          disabled={model.sending}
          onInput={(event) => send({ type: "workstreamNamed", name: event.currentTarget.value })}
        />
      </label>
    );
  const picker = (at: "head" | "rail") => (
    <label class="filter new-thread-workstream" data-at={at}>
      <span class="visually-hidden">Workstream</span>
      <select
        value={picked?.id ?? ""}
        data-set={picked ? "" : undefined}
        disabled={model.sending}
        onChange={(event) =>
          send({ type: "workstreamPicked", workstream: event.currentTarget.value || null })
        }
      >
        <option value="">{blankWorkstreamName}</option>
        {open.map((workstream) => (
          <option key={workstream.id} value={workstream.id}>
            {labels.get(workstream.id)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div class="thread-layout">
      <main class="thread">
        <header class="thread-head">
          <div class="thread-title-row">
            <h1 class="thread-title">New thread</h1>
            {picker("head")}
          </div>
          {named("head")}
        </header>
        <ol class="chat" />
        <Dock>
          <ChatInput
            class="composer"
            elevation="raised"
            label="Message"
            draft={model.draft}
            busy={model.sending}
            notice={model.notice}
            placeholder={
              picked && picked.size > 0 ? `Ask about ${plural(picked.size, "item")}…` : planPrompt
            }
            onDraft={(text) => send({ type: "draftChanged", text })}
            onSubmit={() => send({ type: "sendClicked", workstream: picked?.id ?? null })}
          />
        </Dock>
      </main>
      <aside class="rail" aria-label="This thread's items">
        {picker("rail")}
        {named("rail")}
        {/* Picked, what the workstream holds arrives (window.css). */}
        {picked && picked.size > 0 && (
          <h2 key={picked.id} class="rail-title arrive">
            {plural(picked.size, "item")}
          </h2>
        )}
      </aside>
    </div>
  );
}

// Each workstream in the picker under a name a person can tell apart, never
// the default's: one a thread from nothing made and nobody named yet goes by
// its newest thread's title, as the sidebar lists that thread. A name that
// still repeats gets its place among them.
function pickerLabels(
  open: readonly WorkstreamSummary[],
  threads: readonly ThreadSummaryView[],
): Map<string, string> {
  const titleOf = (id: string) =>
    threads
      .filter((thread) => thread.workstream.id === id && thread.title)
      .sort((a, b) => b.activityAt.localeCompare(a.activityAt))[0]?.title ?? "Untitled thread";
  const named = open.map((workstream) => ({
    id: workstream.id,
    name:
      workstream.origin.kind === "thread" && workstream.name === blankWorkstreamName
        ? titleOf(workstream.id)
        : workstream.name,
  }));
  // The default's label and each name's first holder keep theirs; the rest
  // take the first "(n)" nobody has.
  const taken = new Set([blankWorkstreamName]);
  const labels = new Map<string, string>();
  for (const { id, name } of named) {
    if (taken.has(name)) continue;
    taken.add(name);
    labels.set(id, name);
  }
  for (const { id, name } of named) {
    if (labels.has(id)) continue;
    let nth = 2;
    while (taken.has(`${name} (${nth})`)) nth++;
    taken.add(`${name} (${nth})`);
    labels.set(id, `${name} (${nth})`);
  }
  return labels;
}

// The workstreams a new thread can start in: those still open, but the
// window chat's, which only the window chat asks in.
const startable = (workstreams: readonly WorkstreamSummary[] | null) =>
  (workstreams ?? []).filter(
    (workstream) => workstream.done === null && workstream.origin.kind !== "window",
  );

export function ChatEntryItem(props: {
  entry: Entry;
  model: ThreadModel;
  view: ThreadView;
  send: (msg: ThreadMsg) => void;
}) {
  const { entry } = props;
  switch (entry.kind) {
    case "user":
      return <li class="user-message">{entry.text}</li>;
    case "reply":
      return (
        <li class="reply">
          <ChipsContext.Provider value={props.view.chips}>
            <QuotesContext.Provider value={props.view.quotes}>
              <Markdown text={entry.text} linksTo={sites(props.view)} answer />
            </QuotesContext.Provider>
          </ChipsContext.Provider>
        </li>
      );
    case "marker":
      return (
        <li class="marker" role="note">
          <span>
            {entry.added.length > 0 && <>Added {refList(entry.added)}</>}
            {entry.added.length > 0 && entry.removed.length > 0 && " · "}
            {entry.removed.length > 0 && <>Removed {refList(entry.removed)}</>}
          </span>
        </li>
      );
    case "run":
      return (
        <li class="run-block">
          <Run script={entry.script} run={entry.run} stopped={entry.stopped} />
        </li>
      );
    case "block":
      return (
        <li class="block-entry">
          <BlockFigure block={entry.block} />
        </li>
      );
    case "sketch":
      return (
        <li class="sketch-entry">
          <SketchFigure sketch={entry.sketch} />
        </li>
      );
    case "change-set": {
      const set = props.view.changeSets.find((s) => s.id === entry.changeSetId);
      if (!set) return null;
      return (
        <li class="change-set-block">
          <ChangeSet set={set} model={props.model} view={props.view} send={props.send} />
        </li>
      );
    }
    case "actions":
      return (
        <li class="actions-block" aria-label="What the agent did in Oriel">
          <ActionLines seq={entry.seq} lines={entry.lines} model={props.model} send={props.send} />
        </li>
      );
    case "held":
      return (
        <li class="held-block" data-outcome={entry.outcome ?? "held"}>
          <HeldMessage block={entry} model={props.model} view={props.view} send={props.send} />
        </li>
      );
    case "draft":
      return (
        <li class="held-block" data-outcome={entry.outcome ?? (entry.stale ? "stale" : "held")}>
          <DraftCard block={entry} model={props.model} send={props.send} />
        </li>
      );
    case "note":
      return (
        <li class="oriel-note" role="note">
          <OrielNote note={entry.note} />
        </li>
      );
    // A limit is a per-thread cap that ended the turn; a run's own cap stays
    // inside its folded transcript.
    case "notice":
      return (
        <li
          class="notice"
          data-tone={entry.tone}
          role={entry.tone === "limit" ? "status" : undefined}
        >
          {entry.tone === "limit" && (
            <strong>This thread has hit its limit, so the agent stopped here. </strong>
          )}
          {entry.text}
        </li>
      );
  }
}

// One of Oriel's own lines, never the agent's (OA-91): after a rejection,
// what the user can do next; once they undid it, that it awaits them again.
function OrielNote({ note }: { note: NoteView }) {
  if (note.kind === "unrejected") return <p>Rejection undone. The change awaits your review.</p>;
  if (note.kind === "moving")
    return (
      <p>
        {note.into} is on. This change makes{" "}
        {note.items === 1 ? "the issue" : `the ${note.items} issues`} in {note.from} again in{" "}
        {note.into}, and your workstreams follow them there. Approve it, and {note.from} steps
        aside; reject it, and both stay.
      </p>
    );
  if (note.kind === "moved")
    return (
      <p>
        Your issues are in {note.into} now, and your workstreams follow them there. This workstream
        had nothing else, so it's done.
      </p>
    );
  return (
    <p>
      {note.via === "thread" ? "Change rejected." : "Change rejected on its review link."} You can
      ask the agent to make changes or close the thread.
    </p>
  );
}

// What Oriel did with the actions the agent asked for, as the host says it,
// under the agent's reply (decision 0024): each sentence links where it
// changed something, and each that applied has its Undo, or once undone,
// its Redo, if it can be done again.
function ActionLines(props: {
  seq: number;
  lines: ActionLineView[];
  model: ThreadModel;
  send: (msg: ThreadMsg) => void;
}) {
  const dispatch = useContext(ItemLinksContext)?.dispatch;
  const { seq, model, send } = props;
  return (
    <ul class="action-lines">
      {props.lines.map((line, index) => (
        <li
          key={index}
          data-applied={line.applied ? "yes" : "no"}
          data-undone={line.undone ? "yes" : undefined}
        >
          <span class="action-text">
            {line.touched && dispatch ? (
              <Link
                route={
                  line.touched.kind === "thread"
                    ? { page: "thread", id: line.touched.id }
                    : { page: "workstream", id: line.touched.id }
                }
                dispatch={dispatch}
              >
                {line.text}
              </Link>
            ) : (
              line.text
            )}
          </span>
          {line.undo && (
            <button
              type="button"
              class="undo-action"
              disabled={model.undoing.includes(lineKey(seq, index))}
              onClick={() => send({ type: "lineUndoClicked", seq, index })}
            >
              {line.undone ? "Redo" : "Undo"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// The thread's items by address, so a link to one in a reply, or in a diff's
// value, opens its panel.
export const itemsOf = (view: ThreadView): ReadonlyMap<string, string> =>
  new Map(view.members.flatMap(({ ref }) => (ref.url ? [[addressOf(ref.url), ref.id]] : [])));

// Who a held message is from, each kind of sender in its own words. A
// review link may be held by anyone.
function heldFrom(from: HeldFrom) {
  switch (from.kind) {
    case "review-link":
      return (
        <>
          <strong>{from.by}</strong> rejected this on the review link, and wrote:
        </>
      );
  }
}

// A message from anyone but the user, tinted and edged as their move. The
// agent never sees it until the user sends it, as it is or edited, as their
// own message; or they discard it (decision 0024). Edit puts its words in
// the composer, the one field the user writes in, and Send there sends it.
function HeldMessage(props: {
  block: Extract<Entry, { kind: "held" }>;
  model: ThreadModel;
  view: ThreadView;
  send: (msg: ThreadMsg) => void;
}) {
  const { block, model, view, send } = props;
  const { seq } = block;
  const editing = block.outcome === null && model.composing?.seq === seq;
  const busy = model.settling.includes(seq);
  const sendable = !busy && !view.running && (!editing || model.draft.trim() !== "");
  return (
    <section class="held-message" aria-busy={busy}>
      <p class="held-by">
        <span>{heldFrom(block.from)}</span>
        {block.outcome === null && (
          <span class="state-chip" data-waiting="held">
            {waitingNames.held}
          </span>
        )}
      </p>
      <blockquote class="held-text">{block.text}</blockquote>
      {block.outcome === null ? (
        <div class="held-actions">
          <button
            type="button"
            class="button primary"
            disabled={!sendable}
            onClick={() => send({ type: "heldSendClicked", seq })}
          >
            Send to agent
          </button>
          {editing ? (
            <button
              type="button"
              class="button"
              disabled={busy}
              onClick={() => send({ type: "heldEditCancelled", seq })}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              class="button"
              disabled={busy}
              onClick={() => send({ type: "heldEditClicked", seq })}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            class="quiet-action"
            disabled={busy}
            onClick={() => send({ type: "heldDiscardClicked", seq })}
          >
            Discard
          </button>
          <span class="held-note">
            {editing
              ? "Editing in the message box. Send there sends it as yours."
              : "The agent won't see this until you send it."}
          </span>
        </div>
      ) : (
        <p class="held-note">
          {block.outcome === "sent" ? "Sent to the agent." : "Discarded. The agent never saw it."}
        </p>
      )}
    </section>
  );
}

// A draft of the agent's (decision 0051): one of the user's own actions,
// which only they apply, as it is or edited, or discard. Oriel draws it from
// its own data: the connection it sets, by name, and each option it
// changes, as it is and as drafted, never the agent's words; and, before
// Apply, what applying it does to the items the connection has (OA-232).
function DraftCard(props: {
  block: Extract<Entry, { kind: "draft" }>;
  model: ThreadModel;
  send: (msg: ThreadMsg) => void;
}) {
  const { block, model, send } = props;
  const { seq } = block;
  const waits = block.outcome === null;
  const editing =
    waits && block.changes.some((change) => optionKey(seq, change.option) in model.editing);
  const busy = model.settling.includes(seq);
  const undo = model.applied[seq];
  const name = block.connection?.name ?? "A connection that's gone";
  return (
    <section class="held-message draft-card" aria-busy={busy}>
      <p class="held-by">
        <strong>The agent drafted</strong> how {name} reads its source.
        {waits && " Nothing changes until you apply it."}
      </p>
      {block.tables && !editing ? (
        <ReviewTables tables={block.tables} />
      ) : (
        <dl class="draft-changes">
          {block.changes.map((change) => (
            <div key={change.option}>
              <dt>{change.option}</dt>
              {editing ? (
                <dd>
                  <textarea
                    class="held-field"
                    rows={Math.min(Math.max(optionText(change.drafted).split("\n").length, 2), 8)}
                    value={model.editing[optionKey(seq, change.option)] ?? ""}
                    aria-label={`Edit ${change.option}`}
                    disabled={busy}
                    onInput={(event) =>
                      send({
                        type: "heldOptionEdited",
                        seq,
                        option: change.option,
                        text: event.currentTarget.value,
                      })
                    }
                  />
                </dd>
              ) : (
                <dd>
                  <span class="draft-was">{shownValue(change.was)}</span>
                  <span aria-hidden="true"> → </span>
                  <span class="visually-hidden"> becomes </span>
                  <span class="draft-to">{shownValue(change.drafted)}</span>
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
      {waits &&
        !block.stale &&
        block.said.map((line) => (
          <p key={line} class="connect-said">
            {line}
          </p>
        ))}
      {waits && block.stale ? (
        <div class="held-actions">
          <span class="held-note">
            {block.connection
              ? `${name}'s options changed since this was drafted, so it can't apply.`
              : "Its connection is gone, so it can't apply."}
          </span>
          <button
            type="button"
            class="quiet-action"
            disabled={busy}
            onClick={() => send({ type: "heldDiscardClicked", seq })}
          >
            Discard
          </button>
        </div>
      ) : waits ? (
        <div class="held-actions">
          <span class="held-note">Only you can apply it.</span>
          <button
            type="button"
            class="button primary"
            disabled={busy}
            onClick={() => send({ type: "heldApplyClicked", seq })}
          >
            Apply
          </button>
          <button
            type="button"
            class="button"
            disabled={busy}
            onClick={() => send({ type: editing ? "heldEditCancelled" : "heldEditClicked", seq })}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            type="button"
            class="quiet-action"
            disabled={busy}
            onClick={() => send({ type: "heldDiscardClicked", seq })}
          >
            Discard
          </button>
        </div>
      ) : (
        <div class="held-actions">
          <span class="held-note">
            {block.outcome === "applied" ? `Applied. ${name} reads this way now.` : "Discarded."}
          </span>
          {block.outcome === "applied" && undo && (
            <button
              type="button"
              class="undo-action"
              disabled={busy}
              onClick={() => send({ type: "heldUndoClicked", seq })}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// A drafted value as the card shows it: a list joined, nothing as a dash.
const shownValue = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(String).join(", ") || "—"
    : value === null || value === undefined
      ? "—"
      : typeof value === "string"
        ? value
        : JSON.stringify(value);

// Where the thread's items live: the only sites a reply's links open to.
const sites = (view: ThreadView): ReadonlySet<string> =>
  new Set(view.members.flatMap(({ ref }) => URL.parse(ref.url ?? "")?.origin ?? []));

function refList(refs: readonly ItemRef[]) {
  return refs.map((ref, i) => (
    <span key={ref.id}>
      {i > 0 && ", "}
      <ItemKey item={ref} />
      {ref.title !== null && <span class="ref-title"> {ref.title}</span>}
    </span>
  ));
}

// A run, folded: what it did in one line, the script and its output inside.
function Run({ script, run, stopped }: { script: string; run: RunView | null; stopped: boolean }) {
  const summary =
    run === null
      ? stopped
        ? "Script stopped before it finished"
        : "Running a script…"
      : [
          run.outcome === "ok" ? "Ran a script" : `Script ${outcomeNames[run.outcome]}`,
          run.reads.length > 0 ? plural(run.reads.length, "read") : null,
          run.mutations > 0 ? plural(run.mutations, "change") : "no changes",
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <details class="run" data-outcome={run?.outcome ?? (stopped ? "stopped" : "running")}>
      <summary>{summary}</summary>
      <div class="run-body">
        {run && (
          <p class="run-meta">
            {plural(run.reads.length, "read")} · {Math.round(run.wallMs)} ms
          </p>
        )}
        <pre class="code">{script}</pre>
        {run && run.logs.length > 0 && <pre class="output">{run.logs.join("\n")}</pre>}
        {run?.returned && <pre class="output">{run.returned}</pre>}
        {run?.error && (
          <p class="run-error">
            {run.error.message}
            {run.error.hint && <span class="hint"> {run.error.hint}</span>}
          </p>
        )}
      </div>
    </details>
  );
}

const outcomeNames: Record<RunView["outcome"], string> = {
  ok: "ran",
  threw: "failed",
  timeout: "timed out",
  limit: "hit a limit",
};

function ChangeSet(props: {
  set: ChangeSetView;
  model: ThreadModel;
  view: ThreadView;
  send: (msg: ThreadMsg) => void;
}) {
  const { set, model, view, send } = props;
  const diff = model.diffs[set.id];
  const busy = model.busy.includes(set.id);
  const problem = model.problems[set.id];
  const link = model.links[set.id];
  const reverts = set.reverts.flatMap((id) => view.changeSets.find((s) => s.id === id) ?? []);
  // Only what the change set engine offers, in its order.
  const steps = set.nextSteps.flatMap((step) => (step.kind === "remove" ? [] : [step]));
  const dismissing = set.nextSteps.find((step) => step.kind === "dismiss");
  const approvable = set.nextSteps.some((step) => step.kind === "approve");
  // While a second look shows, Approve and Reject would read as accepting
  // or dismissing it: the change set offers only what pertains to the look,
  // and Dismiss, one click, gives them back (OA-257).
  const look = shownLook(model, set);
  // Approve and apply is the one primary action. Reject is one click: the
  // thread then asks what was wrong, and the message box waits for the
  // answer. Second look sits between them (decision 0054).
  const stepButton = (step: (typeof steps)[number]) => {
    const forward = isForward(step.kind);
    const decides = forward && step.kind !== "retry";
    const disabled = busy || ((decides || step.kind === "reject") && !diff);
    return (
      <button
        key={step.kind}
        type="button"
        class={forward ? "button primary" : step.kind === "dismiss" ? "quiet-action" : "button"}
        disabled={disabled}
        onClick={() => send({ type: "changeSetClicked", changeSetId: set.id, step: step.kind })}
      >
        {stepLabel(step.kind, set)}
      </button>
    );
  };
  const firstBack = steps.findIndex((step) => !isForward(step.kind));
  const between = firstBack === -1 ? steps.length : firstBack;
  // One that can fold says what it did and when as one line, and opens on a
  // click anywhere on it, to its diff and Revert.
  const shut = folded(model, set);
  const anchor = changeSetAnchor(set.id);
  // Awaiting review, it's the user's move: its head says what Approve
  // writes, and its actions stay in reach while any of it is on screen.
  const awaits = set.status === "open" && !set.stalled;
  const counted = awaits && diff ? writes(diff) : null;
  const card = useRef<HTMLElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!awaits || shut || !card.current || !foot.current || !bar.current) return;
    const actions = bar.current;
    return stickTo(card.current, foot.current, actions, (on) =>
      actions.toggleAttribute("data-stuck", on),
    );
  }, [awaits, shut, diff !== undefined, look !== null]);
  const head = (
    <header class="change-set-head">
      <h2 id={`${anchor}-title`} tabIndex={-1}>
        {set.revertOf ? "Undo" : "Proposed change"}
      </h2>
      {counted && <span class="change-set-writes">{counted}</span>}
      {/* Announced as it moves, as when Approve and apply turns it to applying. */}
      <span id={`${anchor}-status`} class="change-set-status" role="status">
        {set.stalled ? waitingNames.stalled : statusName(set)}
        {set.decision &&
          set.decision.via === "review-link" &&
          ` by ${set.decision.by} via review link`}
        {reverts.some((revert) => revert.status === "applied") && ", then undone"}
        {/* Said once, as it folds itself after its apply ended here. */}
        {shut && model.landed.includes(set.id) && (
          <span class="visually-hidden">
            , folded. Show it to see it
            {set.nextSteps.some((step) => step.kind === "revert") && " or revert it"}.
          </span>
        )}
      </span>
      {shut && (
        <span id={`${anchor}-count`} class="change-set-count">
          {diff && `${plural(diff.lines.length, "change")} · `}
          <Stamp at={set.decision?.at ?? set.createdAt} />
        </span>
      )}
      {foldable(model, set) && (
        <button
          type="button"
          class="quiet-action"
          aria-expanded={!shut}
          aria-describedby={`${anchor}-title ${anchor}-status ${anchor}-count`}
          onClick={() => send({ type: "foldToggled", changeSetId: set.id })}
        >
          {shut ? "Show" : "Hide"}
        </button>
      )}
    </header>
  );
  if (shut)
    return (
      <section id={anchor} class="change-set" data-status={set.status} data-folded tabIndex={-1}>
        {head}
      </section>
    );
  return (
    <section
      id={anchor}
      ref={card}
      class="change-set"
      data-status={set.status}
      data-awaits={awaits || undefined}
      data-opened={model.at?.changeSet === set.id || undefined}
      data-closing={model.landing[set.id] === "closing" || undefined}
      aria-busy={busy}
      tabIndex={-1}
    >
      {head}
      {diff ? (
        <Diff
          diff={diff}
          busy={busy}
          members={view.members}
          removable={removable(model, set.id)}
          onRemove={(mutationId) => send({ type: "lineRemoved", changeSetId: set.id, mutationId })}
        />
      ) : (
        <>
          {/* Its diff reads each changed item's current values from its
              source, which a large change set takes seconds over: nothing
              can be done with it meanwhile (OA-257). */}
          {!problem && (
            <p class="loading change-set-loading" role="status">
              <span class="spinner" aria-hidden="true" />
              Reading what each change would replace in its source…
            </p>
          )}
          {set.errors.length > 0 && (
            <ul class="apply-errors">
              {set.errors.map((e) => (
                <li key={e.mutationId}>{e.error}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {look && (
        <SecondLook
          look={look}
          diff={diff}
          view={view}
          busy={busy || !diff}
          onAdd={(place) =>
            send({ type: "suggestionAdded", changeSetId: set.id, look: look.id, places: [place] })
          }
        />
      )}
      {/* Nothing can be done with it until its source answers or the
          writer gives up: a send may yet land (OA-82). */}
      {set.stalled && (
        <p class="apply-stuck">
          Its source hasn't answered for a while. Try again or dismiss it once it answers or Oriel
          gives up waiting.
        </p>
      )}
      {dismissing?.kind === "dismiss" && dismissing.warnings.length > 0 && (
        <ul class="may-have-landed">
          {dismissing.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {!diff && !problem ? null : look ? (
        <LookActions set={set} look={look} model={model} busy={busy} bar={bar} send={send} />
      ) : (
        <footer class="change-set-actions" ref={bar}>
          {steps.slice(0, between).map(stepButton)}
          <SecondLookButton set={set} model={model} send={send} />
          {steps.slice(between).map(stepButton)}
          {set.status === "open" && (set.readOnly ?? !view.writable) && (
            <span class="read-only-note">
              Live writes aren't configured here, so this can be reviewed and rejected, not
              approved.
            </span>
          )}
          {approvable &&
            (link ? (
              <span class="review-link">
                <input class="link-field" readOnly value={link} aria-label="Review link" />
                <button
                  type="button"
                  class="quiet-action"
                  onClick={() => send({ type: "linkCopied", changeSetId: set.id })}
                >
                  Copy
                </button>
              </span>
            ) : (
              <button
                type="button"
                class="quiet-action"
                onClick={() => send({ type: "linkClicked", changeSetId: set.id })}
              >
                Share review link
              </button>
            ))}
        </footer>
      )}
      {awaits && approvable && !look && diff && diff.lines.length > 0 && (
        <p class="change-set-foot">Nothing is written to {sourcesOf(diff)} until you approve.</p>
      )}
      {/* Applied, with no Revert, since its source can't take one change back. */}
      {set.cannotUndo && !shut && <p class="change-set-foot">{set.cannotUndo}.</p>}
      {/* Where the actions belong, which tells whether they're stuck. */}
      <div class="change-set-end" ref={foot} aria-hidden="true" />
      {problem && (
        <p class="change-set-problem" role="alert">
          {problem}
        </p>
      )}
      {reverts.map((revert) => (
        <ChangeSet key={revert.id} set={revert} model={model} view={view} send={send} />
      ))}
    </section>
  );
}

// The window's own observer, in `root` (null for the window itself).
const intersecting =
  (root: Element | null): Observe<Element> =>
  (target, margin, seen) => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const bottom = entry.rootBounds?.bottom ?? innerHeight;
          seen(entry.isIntersecting, entry.boundingClientRect.top >= bottom);
        }
      },
      { root, rootMargin: `0px 0px ${-Math.round(margin)}px 0px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
  };

// A card's actions stick above the composer while it shows (`watchStuck`):
// in the window chat's list, against the list's foot; on a thread's page,
// against the composer's top. Measured again as the composer grows.
function stickTo(card: Element, foot: Element, bar: Element, onChange: (on: boolean) => void) {
  const list = card.closest(".window-chat-entries");
  const dock = list ? null : document.querySelector(".chat-dock .chat-input");
  let stop = () => {};
  const measure = () => {
    stop();
    onChange(false);
    const hidden = dock ? Math.max(0, innerHeight - dock.getBoundingClientRect().top) : 0;
    const height = bar.getBoundingClientRect().height;
    stop = watchStuck({ card, foot, hidden, bar: height, observe: intersecting(list), onChange });
  };
  measure();
  const resized = new ResizeObserver(measure);
  if (dock) resized.observe(dock);
  addEventListener("resize", measure);
  return () => {
    resized.disconnect();
    removeEventListener("resize", measure);
    stop();
  };
}

const isForward = (kind: SetStep): boolean =>
  kind === "approve" || kind === "approve-rest" || kind === "retry";

// While a second look shows, what pertains to it, and nothing that reads as
// accepting or dismissing it (OA-257): Look again once it went stale or
// failed; adding every suggestion not yet added, when it made any; and
// Dismiss, after which Approve and Reject are back.
function LookActions(props: {
  set: ChangeSetView;
  look: SecondLookView;
  model: ThreadModel;
  busy: boolean;
  bar: { current: HTMLElement | null };
  send: (msg: ThreadMsg) => void;
}) {
  const { set, look, model, busy, send } = props;
  const left =
    look.state === "ready"
      ? look.companions.filter((change) => !change.added).map((change) => change.place)
      : [];
  return (
    <footer class="change-set-actions" ref={props.bar}>
      <SecondLookButton set={set} model={model} send={send} />
      {left.length > 0 && (
        <button
          type="button"
          class="button"
          disabled={busy}
          onClick={() =>
            send({ type: "suggestionAdded", changeSetId: set.id, look: look.id, places: left })
          }
        >
          {left.length === 1 ? "Add its suggestion" : `Add its ${left.length} suggestions`}
        </button>
      )}
      <Tooltip text="Close the second look to approve or reject the change.">
        <button
          type="button"
          class="button"
          onClick={() => send({ type: "lookDismissed", changeSetId: set.id, look: look.id })}
        >
          Dismiss
        </button>
      </Tooltip>
    </footer>
  );
}

// Second look, or Look again once the last went stale or failed (decision
// 0054): only when the person presses it. It says Looking… from the press
// until the look shows. One dismissed while still current shows again, with
// no model call (OA-257).
function SecondLookButton(props: {
  set: ChangeSetView;
  model: ThreadModel;
  send: (msg: ThreadMsg) => void;
}) {
  const { set, model, send } = props;
  const look = set.secondLook;
  if (look === undefined) return null;
  const shown = shownLook(model, set);
  const running = set.id in model.looking || shown?.state === "running";
  const stale = look !== null && (look.stale.diff || look.stale.items.length > 0);
  const current = look?.state === "ready" && !stale;
  if (!running && current && shown) return null;
  return (
    <Tooltip
      text={
        running
          ? "Oriel is reading what this change touches."
          : look === null
            ? "Oriel reads what else this change could affect, in a run of its own. It never approves."
            : current
              ? "Shows the look you dismissed. Nothing it read has changed since."
              : look.state === "failed"
                ? "The last look didn't finish. Take another."
                : "What it read changed since. Take another look."
      }
    >
      <button
        type="button"
        class="button second-look-button"
        disabled={running}
        aria-busy={running || undefined}
        onClick={() => send({ type: "secondLookClicked", changeSetId: set.id })}
      >
        {running ? "Looking…" : look === null || current ? "Second look" : "Look again"}
      </button>
    </Tooltip>
  );
}

type Line = DiffView["lines"][number];
type Field = Line["fields"][number];

// A field's value: an item by its title and key (or as new, when a line
// above creates it), anything else as its text.
function Value({ text, item }: { text: string | null; item: ItemValue | null | undefined }) {
  if (!item) return <>{text}</>;
  return (
    <span class="item-value">
      {item.title ?? item.key}
      {item.created ? (
        <span class="new-mark">new</span>
      ) : (
        item.key && <ItemKey item={{ id: null, key: item.key, url: item.url }} />
      )}
    </span>
  );
}

// One side of a change: what was there, or what will be. Only the words
// that differ from the other side are marked; a side that differs
// throughout reads as it is.
function Side({
  side,
  children,
}: {
  side: "before" | "after" | "same";
  children: ComponentChildren;
}) {
  const said = { before: "Before: ", after: "After: ", same: "" }[side];
  return (
    <div class="side" data-side={side}>
      <span class="side-sign" aria-hidden="true">
        {{ before: "−", after: "+", same: "" }[side]}
      </span>
      <span class="side-text">
        {said && <span class="visually-hidden">{said}</span>}
        {children}
      </span>
    </div>
  );
}

function Pieces({ pieces, side }: { pieces: Piece[]; side: "before" | "after" }) {
  if (pieces.every((piece) => piece.changed)) return <>{pieces.map((p) => p.text).join("")}</>;
  const Mark = side === "before" ? "del" : "ins";
  return (
    <>
      {pieces.map((piece, i) => (piece.changed ? <Mark key={i}>{piece.text}</Mark> : piece.text))}
    </>
  );
}

// Unchanged lines around a change: one line of context on each side of it,
// and the rest folded.
function Unchanged({ lines, first, last }: { lines: string[]; first: boolean; last: boolean }) {
  const context = 1;
  const head = first ? 0 : context;
  const tail = last ? 0 : context;
  const folded = lines.length > head + tail + 1 ? lines.slice(head, lines.length - tail) : [];
  if (folded.length === 0) return <Side side="same">{lines.join("\n")}</Side>;
  return (
    <>
      {head > 0 && <Side side="same">{lines.slice(0, head).join("\n")}</Side>}
      <details class="fold">
        <summary>{plural(folded.length, "unchanged line")}</summary>
        <Side side="same">{folded.join("\n")}</Side>
      </details>
      {tail > 0 && <Side side="same">{lines.slice(-tail).join("\n")}</Side>}
    </>
  );
}

// An edited field: what it held and what it will hold, as rows.
function Edited({ field }: { field: Field }) {
  const { items } = field;
  if (items)
    return (
      <>
        {field.before !== null && (
          <Side side="before">
            <Value text={field.before} item={items.before} />
          </Side>
        )}
        {field.after !== null && (
          <Side side="after">
            <Value text={field.after} item={items.after} />
          </Side>
        )}
      </>
    );
  const hunks = lines(field.before ?? "", field.after ?? "");
  // Empty before and after: it stays empty.
  if (hunks.length === 0) return <Side side="same">—</Side>;
  return (
    <>
      {hunks.map((hunk, i) =>
        hunk.kind === "same" ? (
          <Unchanged key={i} lines={hunk.lines} first={i === 0} last={i === hunks.length - 1} />
        ) : (
          <Fragment key={i}>
            {hunk.before && (
              <Side side="before">
                <Pieces pieces={hunk.before} side="before" />
              </Side>
            )}
            {hunk.after && (
              <Side side="after">
                <Pieces pieces={hunk.after} side="after" />
              </Side>
            )}
          </Fragment>
        ),
      )}
    </>
  );
}

// A new item, as one card: its title, its description, and the fields it
// is made with. An empty field isn't shown. One with no title of its own, as
// a message has none, leads with the line's sentence, and shows what it says
// in full, as a quote.
function NewItem({ line }: { line: Line }) {
  const field = (name: string) => line.fields.find((f) => f.name === name);
  const title = field("summary")?.after ?? null;
  const description = field("description")?.after ?? null;
  const rest = line.fields.filter(
    (f) => f.name !== "summary" && f.name !== "description" && f.after !== null,
  );
  return (
    <>
      <p class="line-head">
        <span class="line-mark" data-kind="create">
          {line.makes ? `New ${line.makes}` : "New"}
        </span>
        {title === null ? (
          <span class="sentence">{line.sentence}</span>
        ) : (
          <span class="new-title">{title}</span>
        )}
      </p>
      {description && (
        <p class="new-description" data-body={title === null ? "" : undefined}>
          {description}
        </p>
      )}
      {rest.length > 0 && (
        <dl class="fields">
          {rest.map((f) => (
            <div key={f.name} class="field">
              <dt>{fieldName(f.name)}</dt>
              <dd>
                <Value text={f.after} item={f.items?.after} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

// Who put the items a line names in the workstream, when it wasn't a person:
// an approver who doesn't know the workstream can then tell (decision 0024).
function Brought({ brought }: { brought: Line["brought"] }) {
  const who = { agent: "The agent", tool: "An outside tool" } as const;
  return (["agent", "tool"] as const).map((by) => {
    const keys = brought.filter((item) => item.by === by).map((item) => item.key);
    return keys.length ? (
      <p key={by} class="brought">
        {who[by]} put {keys.join(", ")} in this workstream.
      </p>
    ) : null;
  });
}

// A line's sentence, naming its item once, by its chip, where the sentence
// named it; or the chip after the sentence, where it didn't.
function Sentence({ line, members }: { line: Line; members?: readonly MemberView[] }) {
  const { target } = line;
  if (!target?.url) return <span class="sentence">{line.sentence}</span>;
  const row = members?.find((member) => member.ref.id === target.id)?.row ?? null;
  const chip = (
    <Chip
      id={target.id}
      view={{
        kind: "item",
        source: kindOfItem(target.id) ?? "",
        key: target.key,
        name: target.title ?? row?.title ?? target.key,
        url: target.url,
        state: row?.status ?? null,
      }}
    />
  );
  const around = namedOnce(line);
  if (!around)
    return (
      <span class="sentence">
        {line.sentence} {chip}
      </span>
    );
  return (
    <span class="sentence">
      {around[0]}
      {chip}
      {around[1]}
    </span>
  );
}

// A change set's lines: a new item as a card, an edit as each field's old
// and new text with only the changed words marked, and a delete as every
// field it empties. The lines the change set engine says can be left out
// (`removable`) offer it: quietly, or plainly beside a change that stopped,
// as the reason it stopped says.
export function Diff(props: {
  diff: DiffView;
  busy: boolean;
  // The thread's items, for where each a line names stands.
  members?: readonly MemberView[];
  removable?: readonly string[];
  onRemove?: (mutationId: string) => void;
}) {
  const offered = (id: string) =>
    props.onRemove !== undefined && (props.removable ?? []).includes(id);
  // Why it stopped or won't go: apply's reason, or, before a decision, its
  // source's (`check`).
  const shown = props.diff.lines.map((line) => ({
    ...line,
    stop: line.error ?? (line.check && "refused" in line.check ? line.check.refused : null),
    fields: line.fields.map(withUnits),
  }));
  return (
    <ul class="diff">
      {shown.map((line) => (
        <li
          key={line.mutationId}
          class="diff-line"
          data-kind={line.kind}
          data-applied={line.applied ? "" : undefined}
          data-stopped={line.stop ? "" : undefined}
          data-dismissed={line.dismissed ? "" : undefined}
        >
          <Brought brought={line.brought} />
          {line.kind === "create" && line.fields.length > 0 ? (
            <NewItem line={line} />
          ) : (
            <>
              <p class="line-head">
                {line.kind === "delete" && (
                  <span class="line-mark" data-kind="delete">
                    Delete
                  </span>
                )}
                <Sentence line={line} members={props.members} />
              </p>
              {line.fields.length > 0 && (
                <dl class="fields">
                  {line.fields.map((field) => (
                    <div key={field.name} class="field">
                      <dt>{fieldName(field.name)}</dt>
                      {line.kind === "delete" ? (
                        <dd>
                          <del>
                            {field.before === null ? (
                              "—"
                            ) : (
                              <Value text={field.before} item={field.items?.before} />
                            )}
                          </del>
                          <span class="arrow" aria-hidden="true">
                            →
                          </span>
                          <ins>{field.after ?? "—"}</ins>
                        </dd>
                      ) : (
                        <dd class="edited">
                          <Edited field={field} />
                        </dd>
                      )}
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
          {line.check && "later" in line.check && (
            <p class="line-note" role="note">
              {line.check.later}
            </p>
          )}
          {line.dismissed && (
            <p class="line-note" role="note">
              Not applied: the rest was dismissed.
            </p>
          )}
          {line.stop && (
            <p class="line-error" role="note">
              {line.stop}
              {offered(line.mutationId) && (
                <button
                  type="button"
                  class="quiet-action"
                  disabled={props.busy}
                  onClick={() => props.onRemove?.(line.mutationId)}
                >
                  Remove this change
                </button>
              )}
            </p>
          )}
          {!line.stop && offered(line.mutationId) && (
            <Tooltip text="Leave this change out">
              <button
                type="button"
                class="remove-line"
                disabled={props.busy}
                aria-label="Leave this change out"
                onClick={() => props.onRemove?.(line.mutationId)}
              >
                ×
              </button>
            </Tooltip>
          )}
        </li>
      ))}
    </ul>
  );
}

// The composer's dock at the thread's foot: it fades from the page's colour
// over what scrolls under it, and says how much of the window's foot it
// covers (`--dock-cover`), so what sticks above it clears it.
function Dock({ children }: { children: ComponentChildren }) {
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = dock.current;
    const thread = element?.closest<HTMLElement>(".thread");
    if (!element || !thread) return;
    const measure = () => {
      const input = element.querySelector(".chat-input")?.getBoundingClientRect();
      const cover = input ? element.getBoundingClientRect().bottom - input.top : 0;
      thread.style.setProperty("--dock-cover", `${Math.round(cover)}px`);
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    return () => resized.disconnect();
  }, []);
  return (
    <div class="chat-dock" ref={dock}>
      {children}
    </div>
  );
}

// What the agent will read, for the composer's foot: the thread's items at
// the version it works in; behind its workstream, the workstream as it is
// now, which the next message catches up with.
export function readsOf(view: ThreadView): string | null {
  if (view.regionVersion < view.workstream.version)
    return `Reads its workstream at v${view.workstream.version}`;
  if (view.members.length === 0) return null;
  return `Reads ${plural(view.members.length, "item")} · v${view.regionVersion}`;
}

// The region the thread works in: its workstream at one version. Behind
// it, the thread catches up with the next message, or with Sync now, which
// waits while a turn runs: the turn works in the version it started in.
function Region(props: { view: ThreadView; syncing: boolean; onSync(): void }) {
  const { view } = props;
  const behind = view.regionVersion < view.workstream.version;
  const waits = view.running || props.syncing;
  return (
    <aside class="rail" aria-label="This thread's items">
      <h2 class="rail-title">
        {plural(view.members.length, "item")} · v{view.regionVersion}
      </h2>
      {behind && (
        <p class="rail-note">
          Workstream will update on next{" "}
          <span class="rail-note-end">
            send
            <Tooltip
              text={
                props.syncing
                  ? "Syncing…"
                  : view.running
                    ? "Syncs once the agent has answered"
                    : "Sync this thread with its workstream"
              }
            >
              <button
                type="button"
                class="sync-now"
                aria-label="Sync this thread with its workstream"
                aria-disabled={waits || undefined}
                aria-busy={props.syncing || undefined}
                onClick={() => {
                  if (!waits) props.onSync();
                }}
              >
                <SyncIcon />
              </button>
            </Tooltip>
          </span>
        </p>
      )}
      {view.move ? (
        <MovedTo went={view.move.went} />
      ) : (
        view.members.length === 0 &&
        !behind && (
          <p class="rail-note">
            No items yet. What a change set here creates joins this workstream.
          </p>
        )
      )}
      <ItemListContext.Provider value={view.members.map((member) => member.ref.id)}>
        <ul class="members compact">
          {view.members.map((member) => (
            <Member key={member.ref.id} member={member} />
          ))}
        </ul>
      </ItemListContext.Provider>
    </aside>
  );
}

// Where a move's items go: the workstreams that held the stand-in's, by
// name once it applied.
function MovedTo({ went }: { went: readonly WorkstreamRef[] | null }) {
  const names = went?.map((workstream) => workstream.name) ?? [];
  return (
    <p class="rail-note">
      {went === null
        ? "What this change creates goes to the workstreams that hold the issues it makes again."
        : names.length === 0
          ? "No workstream held the issues it made again, so its items went to none."
          : `Its items went to ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`}.`}
    </p>
  );
}

// Two arrows chasing round a circle.
function SyncIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5" />
      <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
    </svg>
  );
}
