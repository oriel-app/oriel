// A thread: the chat in the middle, the region it works in on the right.
// Runs stay folded until opened; a search is its own block; a change set is
// a diff with what can be done with it.
import { type ComponentChildren, Fragment } from "preact";
import {
  addressOf,
  type Dispatch,
  DropZone,
  ItemKey,
  ItemLinksContext,
  Link,
  Markdown,
  plural,
  points,
  Replies,
  StateChip,
  TypeMark,
} from "./parts.tsx";
import { planPrompt } from "./group.ts";
import { lines, type Piece } from "./text-diff.ts";
import {
  type Block,
  blocks,
  expected,
  type NewThreadModel,
  removable,
  stepLabel,
  type ThreadModel,
  type ThreadMsg,
} from "./thread.ts";
import {
  type ChangeSetView,
  type DiffView,
  type ItemRef,
  type ItemValue,
  type MemberView,
  type RunView,
  type ThreadView,
  holding,
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
// One of several of a kind, such as a link or a reply, by its prefix.
const fieldKinds: Record<string, string> = { "link:": "Link", "reply:": "Reply" };
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

export function ThreadPage({ model, dispatch }: { model: ThreadModel; dispatch: Dispatch }) {
  const send = (msg: ThreadMsg) => dispatch({ type: "thread", msg });
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
  return (
    <ItemLinksContext.Provider value={{ dispatch, items: itemsOf(view) }}>
      <DropZone
        class="thread-layout"
        label={`Drop to add to ${view.group.name}`}
        onDrop={(dropped) => send({ type: "dropped", dropped })}
      >
        <main class="thread" aria-busy={view.running}>
          <header class="thread-head">
            <Link route={{ page: "group", id: view.group.id }} dispatch={dispatch} class="crumb">
              {view.group.name}
            </Link>
            <div class="thread-title-row">
              <h1 class="thread-title">{view.title ?? "New thread"}</h1>
              <StateChip
                state={view.state}
                waitingOn={waitingOn({
                  state: view.state,
                  running: view.running,
                  held: holding(view.entries),
                  changeSets: view.changeSets,
                })}
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
            {blocks(view.entries).map((block) => (
              <ChatBlock key={block.seq} block={block} model={model} view={view} send={send} />
            ))}
            {view.running && (
              <li class="working" role="status">
                <span class="working-dot" /> Working…
              </li>
            )}
          </ol>
          <Composer
            draft={model.draft}
            sending={model.sending}
            running={view.running}
            notice={model.notice}
            placeholder={
              view.members.length === 0
                ? planPrompt
                : `Ask about ${plural(view.members.length, "item")}…`
            }
            onDraft={(text) => send({ type: "draftChanged", text })}
            onSend={() => send({ type: "sendClicked" })}
            onStop={() => send({ type: "stopClicked" })}
          />
        </main>
        <Region view={view} />
      </DropZone>
    </ItemLinksContext.Provider>
  );
}

// A thread from nothing, before its first message: only the composer. There
// is no group yet; sending makes it, with the thread.
export function NewThreadPage({ model, dispatch }: { model: NewThreadModel; dispatch: Dispatch }) {
  return (
    <div class="thread-layout">
      <main class="thread">
        <header class="thread-head">
          <div class="thread-title-row">
            <h1 class="thread-title">New thread</h1>
          </div>
        </header>
        <ol class="chat" />
        <Composer
          draft={model.draft}
          sending={model.sending}
          running={false}
          notice={model.notice}
          placeholder={planPrompt}
          onDraft={(text) => dispatch({ type: "newThread", msg: { type: "draftChanged", text } })}
          onSend={() => dispatch({ type: "newThread", msg: { type: "sendClicked" } })}
        />
      </main>
      <aside class="rail" aria-label="This thread's items">
        <h2 class="rail-title">No items</h2>
        <p class="rail-note">
          No group yet: your first message makes one, with this thread. What a change set here
          creates joins it.
        </p>
      </aside>
    </div>
  );
}

function ChatBlock(props: {
  block: Block;
  model: ThreadModel;
  view: ThreadView;
  send: (msg: ThreadMsg) => void;
}) {
  const { block } = props;
  switch (block.kind) {
    case "user":
      return <li class="user-message">{block.text}</li>;
    case "reply":
      return (
        <li class="reply">
          <Markdown text={block.text} linksTo={sites(props.view)} />
        </li>
      );
    case "marker":
      return (
        <li class="marker" role="note">
          <span>
            {block.added.length > 0 && <>Added {refList(block.added)}</>}
            {block.added.length > 0 && block.removed.length > 0 && " · "}
            {block.removed.length > 0 && <>Removed {refList(block.removed)}</>}
          </span>
          <span class="marker-version">
            v{block.from} → v{block.to}
          </span>
        </li>
      );
    case "run":
      return (
        <li class="run-block">
          <Run script={block.script} run={block.run} stopped={block.stopped} />
        </li>
      );
    case "search":
      return (
        <li class="search-block">
          <p class="search-label">
            Searched outside this group · {plural(block.hits.length, "result")} · read-only
          </p>
          <ul class="hits">
            {block.hits.map((hit) => (
              <li key={hit.id}>
                <ItemKey item={hit} />
                <span class="hit-title">{hit.title}</span>
                {hit.inRegion && <span class="in-region">in this group</span>}
              </li>
            ))}
          </ul>
        </li>
      );
    case "change-set": {
      const set = props.view.changeSets.find((s) => s.id === block.changeSetId);
      if (!set) return null;
      return (
        <li class="change-set-block">
          <ChangeSet set={set} model={props.model} view={props.view} send={props.send} />
        </li>
      );
    }
    case "held":
      return (
        <li class="held-block" data-outcome={block.outcome ?? "held"}>
          <HeldReason block={block} model={props.model} view={props.view} send={props.send} />
        </li>
      );
    // A limit is a per-thread cap that ended the turn; a run's own cap stays
    // inside its folded transcript.
    case "notice":
      return (
        <li
          class="notice"
          data-tone={block.tone}
          role={block.tone === "limit" ? "status" : undefined}
        >
          {block.tone === "limit" && (
            <strong>This thread has hit its limit, so the agent stopped here. </strong>
          )}
          {block.text}
        </li>
      );
  }
}

// The thread's items by address, so a link to one in a reply, or in a diff's
// value, opens its panel.
const itemsOf = (view: ThreadView): ReadonlyMap<string, string> =>
  new Map(view.members.flatMap(({ ref }) => (ref.url ? [[addressOf(ref.url), ref.id]] : [])));

// A review-link holder's reason for rejecting a change set. Whoever holds a
// link may be anyone, so the agent never sees it until the person sends it,
// as it is or edited, as their own message; or they discard it.
function HeldReason(props: {
  block: Extract<Block, { kind: "held" }>;
  model: ThreadModel;
  view: ThreadView;
  send: (msg: ThreadMsg) => void;
}) {
  const { block, model, view, send } = props;
  const { changeSetId } = block;
  // Settled, here or elsewhere, it is shown as it was held.
  const editing = block.outcome === null ? model.editing[changeSetId] : undefined;
  const busy = model.busy.includes(changeSetId);
  const sendable = !busy && !view.running && editing?.trim() !== "";
  return (
    <section class="held-reason" aria-busy={busy}>
      <p class="held-by">
        <strong>{block.by}</strong> rejected this on the review link:
      </p>
      {editing === undefined ? (
        <blockquote class="held-text">{block.text}</blockquote>
      ) : (
        <textarea
          class="held-field"
          value={editing}
          rows={3}
          maxLength={8000}
          aria-label={`Edit ${block.by}'s reason`}
          disabled={busy}
          onInput={(event) =>
            send({ type: "heldEdited", changeSetId, text: event.currentTarget.value })
          }
        />
      )}
      {block.outcome === null ? (
        <div class="held-actions">
          <span class="held-note">The agent won't see this until you send it.</span>
          <button
            type="button"
            class="button primary"
            disabled={!sendable}
            onClick={() => send({ type: "heldSendClicked", changeSetId })}
          >
            Send to agent
          </button>
          {editing === undefined ? (
            <button
              type="button"
              class="button"
              disabled={busy}
              onClick={() => send({ type: "heldEditClicked", changeSetId })}
            >
              Edit
            </button>
          ) : (
            <button
              type="button"
              class="button"
              disabled={busy}
              onClick={() => send({ type: "heldEditCancelled", changeSetId })}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            class="quiet-action"
            disabled={busy}
            onClick={() => send({ type: "heldDiscardClicked", changeSetId })}
          >
            Discard
          </button>
        </div>
      ) : (
        <p class="held-note">
          {block.outcome === "sent" ? "Sent to the agent." : "Discarded. The agent never saw it."}
        </p>
      )}
    </section>
  );
}

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
          plural(run.reads.length, "read"),
          run.mutations > 0 ? plural(run.mutations, "change") : null,
          `${Math.round(run.wallMs)} ms`,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <details class="run" data-outcome={run?.outcome ?? (stopped ? "stopped" : "running")}>
      <summary>{summary}</summary>
      <div class="run-body">
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
  const notes = model.notes[set.id] ?? [];
  const link = model.links[set.id];
  const reverts = set.reverts.flatMap((id) => view.changeSets.find((s) => s.id === id) ?? []);
  // Only what the change set engine offers, in its order.
  const steps = set.nextSteps.flatMap((step) => (step.kind === "remove" ? [] : [step]));
  const dismissing = set.nextSteps.find((step) => step.kind === "dismiss");
  const approvable = set.nextSteps.some((step) => step.kind === "approve");
  return (
    <section class="change-set" data-status={set.status} aria-busy={busy}>
      <header class="change-set-head">
        <h2>{set.revertOf ? "Undo" : "Proposed change"}</h2>
        {/* Announced as it moves, as when Approve and apply turns it to applying. */}
        <span class="change-set-status" role="status">
          {statusNames[set.status]}
          {set.decision &&
            set.decision.via === "review-link" &&
            ` by ${set.decision.by} via review link`}
        </span>
      </header>
      {diff ? (
        <Diff
          diff={diff}
          busy={busy}
          removable={removable(model, set.id)}
          onRemove={(mutationId) => send({ type: "lineRemoved", changeSetId: set.id, mutationId })}
        />
      ) : (
        <>
          <p class="loading">Reading current values…</p>
          {set.errors.length > 0 && (
            <ul class="apply-errors">
              {set.errors.map((e) => (
                <li key={e.mutationId}>{e.error}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {dismissing?.kind === "dismiss" && dismissing.warnings.length > 0 && (
        <ul class="may-have-landed">
          {dismissing.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <footer class="change-set-actions">
        {steps.map((step) => {
          const forward =
            step.kind === "approve" || step.kind === "approve-rest" || step.kind === "retry";
          const decides = forward && step.kind !== "retry";
          const disabled = busy || ((decides || step.kind === "reject") && !diff);
          const click = () =>
            send({ type: "changeSetClicked", changeSetId: set.id, step: step.kind });
          const button = (
            <button
              key={step.kind}
              type="button"
              class={
                forward ? "button primary" : step.kind === "dismiss" ? "quiet-action" : "button"
              }
              disabled={disabled}
              onClick={click}
            >
              {stepLabel(step.kind, set)}
            </button>
          );
          // A reason is optional: it goes to the thread as the next message.
          // An Undo is Oriel's, not the agent's, so it has nothing to revise.
          if (step.kind !== "reject" || set.revertOf) return button;
          return (
            <span key={step.kind} class="reject-with">
              <input
                class="reason-field"
                value={model.reasons[set.id] ?? ""}
                placeholder="What's wrong? (optional)"
                aria-label="Why reject it (optional)"
                maxLength={8000}
                disabled={busy}
                onInput={(event) =>
                  send({
                    type: "reasonChanged",
                    changeSetId: set.id,
                    text: event.currentTarget.value,
                  })
                }
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.isComposing || disabled) return;
                  event.preventDefault();
                  click();
                }}
              />
              {button}
            </span>
          );
        })}
        {set.status === "open" && (set.readOnly ?? !view.writable) && (
          <span class="read-only-note">
            Live writes aren't configured here, so this can be reviewed and rejected, not approved.
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
      {problem && (
        <p class="change-set-problem" role="alert">
          {problem}
        </p>
      )}
      {notes.length > 0 && (
        <ul class="may-have-landed" role="note">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {reverts.map((revert) => (
        <ChangeSet key={revert.id} set={revert} model={model} view={view} send={send} />
      ))}
    </section>
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

// A change set's lines: a new item as a card, an edit as each field's old
// and new text with only the changed words marked, and a delete as every
// field it empties. The lines the change set engine says can be left out
// (`removable`) offer it: quietly, or plainly beside a change that stopped,
// as the reason it stopped says.
export function Diff(props: {
  diff: DiffView;
  busy: boolean;
  removable?: readonly string[];
  onRemove?: (mutationId: string) => void;
}) {
  const offered = (id: string) =>
    props.onRemove !== undefined && (props.removable ?? []).includes(id);
  const shown = props.diff.lines.map((line) => ({
    ...line,
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
          data-stopped={line.error ? "" : undefined}
        >
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
                <span class="sentence">
                  {line.sentence} {line.target?.url && <ItemKey item={line.target} />}
                </span>
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
          {line.error && (
            <p class="line-error" role="note">
              {line.error}
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
          {!line.error && offered(line.mutationId) && (
            <button
              type="button"
              class="remove-line"
              disabled={props.busy}
              title="Leave this change out"
              aria-label="Leave this change out"
              onClick={() => props.onRemove?.(line.mutationId)}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Composer(props: {
  draft: string;
  sending: boolean;
  running: boolean;
  notice: string | null;
  placeholder: string;
  onDraft(text: string): void;
  onSend(): void;
  onStop?(): void;
}) {
  return (
    <form
      class="composer"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSend();
      }}
    >
      <textarea
        rows={2}
        value={props.draft}
        placeholder={props.placeholder}
        aria-label="Message"
        onInput={(event) => props.onDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            props.onSend();
          }
        }}
      />
      {props.running ? (
        <button type="button" class="button" onClick={props.onStop}>
          Stop
        </button>
      ) : (
        <button
          type="submit"
          class="button primary"
          disabled={props.sending || props.draft.trim() === ""}
        >
          Send
        </button>
      )}
      {props.notice && (
        <p class="composer-notice" role="alert">
          {props.notice}
        </p>
      )}
    </form>
  );
}

// The region the thread works in: its group at one version.
function Region({ view }: { view: ThreadView }) {
  const behind = view.regionVersion < view.group.version;
  return (
    <aside class="rail" aria-label="This thread's items">
      <h2 class="rail-title">
        {plural(view.members.length, "item")} · v{view.regionVersion}
      </h2>
      {behind && (
        <p class="rail-note">
          The group is at v{view.group.version}. This thread catches up when you write again.
        </p>
      )}
      {view.members.length === 0 && !behind && (
        <p class="rail-note">No items yet. What a change set here creates joins this group.</p>
      )}
      <ul class="members compact">
        {view.members.map((member) => (
          <Member key={member.ref.id} member={member} />
        ))}
      </ul>
    </aside>
  );
}

export function Member({ member, onRemove }: { member: MemberView; onRemove?: () => void }) {
  const { ref, row } = member;
  return (
    <li class={row ? "member" : "member gone"} data-item={ref.id}>
      <TypeMark row={row} />
      <ItemKey item={ref} />
      <span class="member-title">{row?.title ?? ref.title ?? "Not in the index"}</span>
      {row?.status ? (
        <span class="status" data-category={row.status.category}>
          {row.status.name}
        </span>
      ) : (
        row?.replies && <Replies id={ref.id} replies={row.replies} />
      )}
      {onRemove && (
        <button
          type="button"
          class="remove-member"
          title={`Remove ${ref.key} from this group`}
          aria-label={`Remove ${ref.key}`}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </li>
  );
}
