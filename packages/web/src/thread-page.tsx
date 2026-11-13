import { type ComponentChildren, Fragment } from "preact";
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { chipIds } from "./markdown.ts";
import { BlockFigure, ReviewTables, SketchFigure } from "./block.tsx";
import { namedOnce, type Observe, sourcesOf, watchStuck, writes } from "./change-set.ts";
import { ChatInput, type Composer, readsWith } from "./chat-input.tsx";
import { FoldedItem, PanelDockContext } from "./dock.tsx";
import { notLooking } from "./looking.ts";
import { watchLatest } from "./effects.ts";
import { kindOfItem } from "./item-id.ts";
import {
  addressOf,
  Chip,
  type Dispatch,
  DropZone,
  ItemKey,
  AnswerChip,
  ChipsContext,
  EntryContext,
  ItemLinksContext,
  ItemListContext,
  Member,
  OpenItemContext,
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
import { NewMessage } from "./new-message.tsx";
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
  unseen,
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
const fieldKinds: Record<string, string> = {
  "link:": "Link",
  "comment:": "Comment",
  "reply:": "Reply",
};
const fieldName = (name: string) =>
  fieldNames[name] ??
  Object.entries(fieldKinds).find(([prefix]) => name.startsWith(prefix))?.[1] ??
  name;

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
  useEffect(() => watchLatest(send), [model.id]);
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
            <FoldedItem />
            <ChatInput
              {...threadComposer(model, view, dispatch)}
              class="composer"
              elevation="raised"
              above={
                <div class="composer-pills">
                  <ToReview
                    ids={review.map((set) => set.id)}
                    onShow={(changeSetId) => send({ type: "toReviewClicked", changeSetId })}
                  />
                  {unseen(model) && <NewMessage onShow={() => send({ type: "latestClicked" })} />}
                </div>
              }
            />
          </Dock>
        </main>
        <Region view={view} syncing={model.syncing} onSync={() => send({ type: "syncClicked" })} />
      </DropZone>
    </ItemLinksContext.Provider>
  );
}

export function threadComposer(model: ThreadModel, view: ThreadView, dispatch: Dispatch): Composer {
  const send = (msg: ThreadMsg) => dispatch({ type: "thread", msg });
  // A held message's words send as they were held, about nothing, so it offers nothing while they're there.
  const looking = model.composing ? notLooking : model.lookingAt;
  return {
    label: "Message",
    draft: model.draft,
    busy: model.sending,
    running: view.running,
    notice: model.notice,
    placeholder:
      view.members.length === 0 ? planPrompt : `Ask about ${plural(view.members.length, "item")}…`,
    reads: readsWith(readsOf(view), looking),
    looking: model.composing
      ? undefined
      : {
          lookingAt: looking,
          readOnly: readOnlyIn(view),
          onLooking: (msg) => send({ type: "looking", msg }),
        },
    onDraft: (text) => send({ type: "draftChanged", text }),
    onSubmit: () => send({ type: "sendClicked" }),
    onStop: () => send({ type: "stopClicked" }),
  };
}

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
  const readOnly = () => picked === null;
  // CSS hides the other, so only one picker is ever in the accessibility tree.
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
            reads={readsWith(null, model.lookingAt)}
            looking={{
              lookingAt: model.lookingAt,
              readOnly,
              onLooking: (msg) => send({ type: "looking", msg }),
            }}
            onDraft={(text) => send({ type: "draftChanged", text })}
            onSubmit={() => send({ type: "sendClicked", workstream: picked?.id ?? null })}
          />
        </Dock>
      </main>
      <aside class="rail" aria-label="This thread's items">
        {picker("rail")}
        {named("rail")}
        {picked && picked.size > 0 && (
          <h2 key={picked.id} class="rail-title arrive">
            {plural(picked.size, "item")}
          </h2>
        )}
      </aside>
    </div>
  );
}

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

const startable = (workstreams: readonly WorkstreamSummary[] | null) =>
  (workstreams ?? []).filter(
    (workstream) => workstream.done === null && workstream.origin.kind !== "window",
  );

export function AnswerText({ text, view }: { text: string; view: ThreadView }) {
  const named = useMemo(
    () => chipIds(text).filter((id) => view.chips[id]?.kind === "item"),
    [text, view.chips],
  );
  return (
    <ChipsContext.Provider value={view.chips}>
      <QuotesContext.Provider value={view.quotes}>
        <ItemListContext.Provider value={named}>
          <Markdown text={text} linksTo={sites(view)} answer />
        </ItemListContext.Provider>
      </QuotesContext.Provider>
    </ChipsContext.Provider>
  );
}

function Reply({ text, view }: { text: string; view: ThreadView }) {
  return (
    <li class="reply">
      <AnswerText text={text} view={view} />
    </li>
  );
}

type EntryProps = {
  entry: Entry;
  model: ThreadModel;
  view: ThreadView;
  send: (msg: ThreadMsg) => void;
};

export function ChatEntryItem(props: EntryProps) {
  return (
    <EntryContext.Provider value={{ thread: props.model.id, seq: props.entry.seq }}>
      <EntryBody {...props} />
    </EntryContext.Provider>
  );
}

function EntryBody(props: EntryProps) {
  const { entry } = props;
  switch (entry.kind) {
    case "user":
      return (
        <li class="user-message">
          {entry.text}
          {entry.about && (
            <ChipsContext.Provider value={props.view.chips}>
              <span class="about">
                about{" "}
                {entry.about.map(({ id, outside }, i) => (
                  <Fragment key={id}>
                    {i > 0 && ", "}
                    <AnswerChip id={id} />
                    {outside && !props.view.windowChat && " (read-only)"}
                  </Fragment>
                ))}
              </span>
            </ChipsContext.Provider>
          )}
        </li>
      );
    case "reply":
      return <Reply text={entry.text} view={props.view} />;
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
    case "revised":
      return (
        <li class="oriel-note" role="note">
          <p>The agent revised this change.</p>
        </li>
      );
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
    case "continue":
      return entry.outcome === "discarded" ? null : (
        <li class="continue-block">
          <ContinueOffer block={entry} model={props.model} send={props.send} />
        </li>
      );
    case "note":
      return (
        <li class="oriel-note" role="note">
          <OrielNote note={entry.note} view={props.view} />
        </li>
      );
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
          {entry.tryAgain && !props.view.running && (
            <button
              type="button"
              class="button"
              disabled={props.model.sending}
              onClick={() => props.send({ type: "tryAgainClicked" })}
            >
              Try again
            </button>
          )}
        </li>
      );
  }
}

function OrielNote({ note, view }: { note: NoteView; view: ThreadView }) {
  if (note.kind === "continued-in")
    return <p>This conversation goes on in {threadChip(note.threadId, view)}.</p>;
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

export const readOnlyIn =
  (view: ThreadView) =>
  (id: string): boolean =>
    !view.windowChat && !view.members.some((member) => member.ref.id === id);

export const itemsOf = (view: ThreadView): ReadonlyMap<string, string> =>
  new Map(view.members.flatMap(({ ref }) => (ref.url ? [[addressOf(ref.url), ref.id]] : [])));

const threadChip = (id: string, view: ThreadView) => {
  const chip = view.chips[id];
  return chip ? <Chip id={id} view={chip} /> : "another thread";
};

function heldFrom(from: HeldFrom, view: ThreadView) {
  switch (from.kind) {
    case "thread":
      return <>From {threadChip(from.threadId, view)}:</>;
    case "review-link":
      return (
        <>
          <strong>{from.by}</strong> rejected this on the review link, and wrote:
        </>
      );
    case "window-chat":
      return <WindowChatLink id={from.chatId} />;
  }
}

function WindowChatLink({ id }: { id: string }) {
  const dispatch = useContext(ItemLinksContext)?.dispatch;
  const text = "From the window chat";
  return dispatch ? (
    <Link route={{ page: "thread", id }} dispatch={dispatch}>
      {text}
    </Link>
  ) : (
    text
  );
}

function ContinueOffer(props: {
  block: Extract<Entry, { kind: "continue" }>;
  model: ThreadModel;
  send: (msg: ThreadMsg) => void;
}) {
  const { block, model, send } = props;
  const dispatch = useContext(ItemLinksContext)?.dispatch;
  const where = block.workstream ?? "a new workstream";
  if (block.outcome === "applied" && block.thread && dispatch)
    return (
      <Link route={{ page: "thread", id: block.thread }} dispatch={dispatch} class="quiet-action">
        Continued in {where} ›
      </Link>
    );
  return (
    <button
      type="button"
      class="button primary"
      disabled={model.settling.includes(block.seq) || block.outcome !== null}
      onClick={() => send({ type: "continueClicked", seq: block.seq })}
    >
      Continue in {where}
    </button>
  );
}

// The agent never sees it until the user sends it, as it is or edited, as their own message.
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
  if (block.from.kind === "window-chat" && block.outcome === "sent")
    return <p class="held-from">{heldFrom(block.from, view)}</p>;
  return (
    <section class="held-message" aria-busy={busy}>
      <p class="held-by">
        <span>{heldFrom(block.from, view)}</span>
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

// Oriel draws it from its own data, never the agent's words.
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
  // While a second look shows, Approve and Reject would read as accepting or dismissing it.
  const look = shownLook(model, set);
  const stepButton = (step: (typeof steps)[number]) => {
    const forward = isForward(step.kind);
    const decides = forward && step.kind !== "retry";
    const disabled = busy || ((decides || step.kind === "reject") && (!diff || diff.stored));
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
  const shut = folded(model, set);
  const anchor = changeSetAnchor(set.id);
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
      <span id={`${anchor}-status`} class="change-set-status" role="status">
        {set.stalled ? waitingNames.stalled : statusName(set)}
        {set.decision &&
          set.decision.via === "review-link" &&
          ` by ${set.decision.by} via review link`}
        {reverts.some((revert) => revert.status === "applied") && ", then undone"}
        {set.revisedAt !== null && (
          <span class="change-set-revised">
            {" · revised "}
            <Stamp at={set.revisedAt} />
          </span>
        )}
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
          {/* Its diff reads each changed item's current values from its source,
          which a large change set takes seconds over. */}
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
          busy={busy || !diff || diff.stored === true}
          onAdd={(place) =>
            send({ type: "suggestionAdded", changeSetId: set.id, look: look.id, places: [place] })
          }
        />
      )}
      {/* Nothing can be done until its source answers or the writer gives up: a send may yet land. */}
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

export function Diff(props: {
  diff: DiffView;
  busy: boolean;
  members?: readonly MemberView[];
  removable?: readonly string[];
  onRemove?: (mutationId: string) => void;
}) {
  const offered = (id: string) =>
    props.onRemove !== undefined && (props.removable ?? []).includes(id);
  const shown = props.diff.lines.map((line) => ({
    ...line,
    stop: line.error ?? (line.check && "refused" in line.check ? line.check.refused : null),
    fields: line.fields.map(withUnits),
  }));
  const open = useContext(OpenItemContext);
  const named = [...new Set(shown.flatMap((line) => (line.target?.url ? [line.target.id] : [])))];
  return (
    <ItemListContext.Provider value={named}>
      <ul class="diff">
        {shown.map((line) => (
          <li
            key={line.mutationId}
            class="diff-line"
            data-open={(open !== null && line.target?.id === open) || undefined}
            data-kind={line.kind}
            data-applied={line.applied ? "" : undefined}
            data-stopped={line.stop ? "" : undefined}
            data-dismissed={line.dismissed ? "" : undefined}
            aria-busy={line.checking}
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
            {line.checking && <p class="line-note">Checking…</p>}
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
    </ItemListContext.Provider>
  );
}

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
  const docked = useContext(PanelDockContext);
  return (
    <div class="chat-dock" ref={dock} inert={(docked && !docked.folded) || undefined}>
      {children}
    </div>
  );
}

export function readsOf(view: ThreadView): string | null {
  if (view.regionVersion < view.workstream.version) return "Reads its workstream as it is now";
  if (view.members.length === 0) return null;
  return `Reads ${plural(view.members.length, "item")}`;
}

function Region(props: { view: ThreadView; syncing: boolean; onSync(): void }) {
  const { view } = props;
  const behind = view.regionVersion < view.workstream.version;
  const waits = view.running || props.syncing;
  const count = behind ? (view.workstream.items ?? 0) : view.members.length;
  // "Synced 2 min ago" stays true as the page sits open.
  const [, tick] = useState(0);
  useEffect(() => {
    const minute = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(minute);
  }, []);
  return (
    <aside class="rail" aria-label="This thread's items">
      <h2 class="rail-title">
        {plural(count, "item")} · v{view.workstream.version}
      </h2>
      <p class="rail-sync">
        Synced{" "}
        <span class="rail-sync-end">
          <Stamp at={view.syncedAt} />
          {behind && (
            <Tooltip
              text={
                props.syncing
                  ? "Syncing…"
                  : view.running
                    ? "Syncs once the agent has answered"
                    : "Sync workstream now"
              }
            >
              <button
                type="button"
                class="sync-now"
                aria-label="Sync workstream now"
                aria-disabled={waits || undefined}
                aria-busy={props.syncing || undefined}
                onClick={() => {
                  if (!waits) props.onSync();
                }}
              >
                <SyncIcon />
              </button>
            </Tooltip>
          )}
        </span>
      </p>
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
            <Member
              key={member.ref.id}
              member={member}
              carried={{
                kind: "item",
                id: member.ref.id,
                key: member.ref.key,
                title: member.row?.title ?? member.ref.title ?? null,
                from: { id: view.workstream.id, name: view.workstream.name },
              }}
            />
          ))}
        </ul>
      </ItemListContext.Provider>
    </aside>
  );
}

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

function SyncIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5" />
      <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
    </svg>
  );
}
