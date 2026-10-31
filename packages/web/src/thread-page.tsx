// A thread: the chat in the middle, the region it works in on the right.
// Runs stay folded until opened; a search is its own block; a change set is
// a diff with what can be done with it.
import { type Dispatch, DropZone, ItemKey, Link, plural, StateChip, TypeMark } from "./parts.tsx";
import {
  type Block,
  blocks,
  removable,
  stepLabel,
  type ThreadModel,
  type ThreadMsg,
} from "./thread.ts";
import type { ChangeSetView, DiffView, ItemRef, MemberView, RunView, ThreadView } from "./view.ts";

const fieldNames: Record<string, string> = {
  summary: "Title",
  description: "Description",
  points: "Estimate",
  assignee: "Assignee",
  epic: "Epic",
};
const fieldName = (name: string) => fieldNames[name] ?? (name.startsWith("link:") ? "Link" : name);

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
  const { view } = model;
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
            <StateChip state={view.state} />
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
        <Composer model={model} view={view} send={send} />
      </main>
      <Region view={view} />
    </DropZone>
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
      return <li class="reply">{block.text}</li>;
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
        <span class="change-set-status">
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
          return (
            <button
              key={step.kind}
              type="button"
              class={
                forward ? "button primary" : step.kind === "dismiss" ? "quiet-action" : "button"
              }
              disabled={busy || ((decides || step.kind === "reject") && !diff)}
              onClick={() =>
                send({ type: "changeSetClicked", changeSetId: set.id, step: step.kind })
              }
            >
              {stepLabel(step.kind, set)}
            </button>
          );
        })}
        {set.status === "open" && !view.writable && (
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

// A change set's lines. The lines the change set engine says can be left
// out (`removable`) offer it: quietly, or plainly beside a change that
// stopped, as the reason it stopped says.
export function Diff(props: {
  diff: DiffView;
  busy: boolean;
  removable?: readonly string[];
  onRemove?: (mutationId: string) => void;
}) {
  const offered = (id: string) =>
    props.onRemove !== undefined && (props.removable ?? []).includes(id);
  return (
    <ul class="diff">
      {props.diff.lines.map((line) => (
        <li
          key={line.mutationId}
          class="diff-line"
          data-applied={line.applied ? "" : undefined}
          data-stopped={line.error ? "" : undefined}
        >
          <p class="sentence">
            {line.sentence} {line.target?.url && <ItemKey item={line.target} />}
          </p>
          {line.fields.length > 0 && (
            <dl class="fields">
              {line.fields.map((field) => (
                <div key={field.name} class="field">
                  <dt>{fieldName(field.name)}</dt>
                  <dd>
                    <del>{field.before ?? "—"}</del>
                    <span class="arrow" aria-hidden="true">
                      →
                    </span>
                    <ins>{field.after ?? "—"}</ins>
                  </dd>
                </div>
              ))}
            </dl>
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

function Composer(props: { model: ThreadModel; view: ThreadView; send: (msg: ThreadMsg) => void }) {
  const { model, view, send } = props;
  return (
    <form
      class="composer"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: "sendClicked" });
      }}
    >
      <textarea
        rows={2}
        value={model.draft}
        placeholder={`Ask about ${plural(view.members.length, "item")}…`}
        aria-label="Message"
        onInput={(event) => send({ type: "draftChanged", text: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            send({ type: "sendClicked" });
          }
        }}
      />
      {view.running ? (
        <button type="button" class="button" onClick={() => send({ type: "stopClicked" })}>
          Stop
        </button>
      ) : (
        <button
          type="submit"
          class="button primary"
          disabled={model.sending || model.draft.trim() === ""}
        >
          Send
        </button>
      )}
      {model.notice && (
        <p class="composer-notice" role="alert">
          {model.notice}
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
    <li class={row ? "member" : "member gone"}>
      <TypeMark row={row} />
      <ItemKey item={ref} />
      <span class="member-title">{row?.title ?? ref.title ?? "Not in the index"}</span>
      {row?.status && (
        <span class="status" data-category={row.status.category}>
          {row.status.name}
        </span>
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
