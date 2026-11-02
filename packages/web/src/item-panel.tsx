// The panel beside the page: an item in its source's own view, read live, as
// Oriel's own elements. Source text is always text here: a file's markdown is
// read into the same blocks an agent's reply is, and anything else shows as
// written, line by line, or in the blocks its source's side read it into.
// Nothing here sets HTML.
import { Fragment } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { clickTo } from "./nav.ts";
import {
  behind,
  type CurrentWorkstream,
  daysOf,
  type PanelModel,
  type PanelMsg,
  paragraphsOf,
} from "./panel.ts";
import {
  type Dispatch,
  initials,
  Inlines,
  ItemKey,
  keyLabel,
  Markdown,
  plural,
  ProseBlocks,
  when,
} from "./parts.tsx";
import { safeHref } from "./route.ts";
import type { ItemPanelView, PanelBlock, PanelInline, PanelMessage } from "./view.ts";

export function ItemPanel(props: {
  model: PanelModel;
  // Where the item is in the list it was opened from, if it was.
  place: { index: number; count: number } | null;
  workstream: CurrentWorkstream | null;
  dispatch: Dispatch;
}) {
  const { model, place, dispatch } = props;
  const { view } = model;
  const heading = useRef<HTMLHeadingElement>(null);
  const steps = useRef<HTMLElement>(null);
  // Closing gives focus back to what had it when the panel opened.
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);
  // Opening an item moves focus to it, unless the user is stepping with the
  // buttons, which keep it.
  useEffect(() => {
    if (!steps.current?.contains(document.activeElement)) heading.current?.focus();
  }, [model.id]);
  const step = (by: 1 | -1) => dispatch({ type: "panelStepped", by });
  // Up and down step through the list, wherever focus is but in a field or a
  // menu, which have their own uses for them.
  const listed = place !== null;
  useEffect(() => {
    if (!listed) return;
    const pressed = (event: KeyboardEvent) => {
      const by = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (by === 0 || event.defaultPrevented || event.altKey || event.ctrlKey) return;
      if (event.metaKey || event.shiftKey || typing(event.target)) return;
      event.preventDefault();
      step(by);
    };
    addEventListener("keydown", pressed);
    return () => removeEventListener("keydown", pressed);
  }, [listed]);
  const shown = view?.id === model.id ? view : null;
  const href = safeHref(shown?.url ?? null);
  const readAgain = () => dispatch({ type: "panel", msg: { type: "readAgainClicked" } });
  const leave = (event: MouseEvent) => {
    if (clickTo(event) !== "browser")
      dispatch({ type: "sourceOpened", id: model.id, via: "panel" });
  };
  // The panel arrives once; its contents are drawn afresh for each item it
  // shows, so they fade in again where the panel itself stays put.
  return (
    <aside
      class="item-panel"
      aria-labelledby="item-panel-title"
      aria-busy={model.status === "loading"}
      data-steps={listed || undefined}
    >
      {place && (
        <nav class="panel-steps" aria-label="This list's items" ref={steps}>
          <button
            type="button"
            class="panel-step"
            aria-label="Previous item"
            title="Previous (↑)"
            disabled={place.index === 0}
            onClick={() => step(-1)}
          >
            <StepIcon up />
          </button>
          <span class="panel-place">
            {place.index + 1} of {place.count}
          </span>
          <button
            type="button"
            class="panel-step"
            aria-label="Next item"
            title="Next (↓)"
            disabled={place.index === place.count - 1}
            onClick={() => step(1)}
          >
            <StepIcon />
          </button>
        </nav>
      )}
      <Fragment key={model.id}>
        <header class="panel-head">
          <p class="panel-source">{shown ? `${shown.source} · ${keyLabel(shown)}` : "Item"}</p>
          <button
            type="button"
            class="panel-close"
            aria-label="Close the panel"
            title="Close (Esc)"
            onClick={() => dispatch({ type: "panelClosed" })}
          >
            ×
          </button>
          <h2 id="item-panel-title" class="panel-title" tabIndex={-1} ref={heading}>
            {shown?.title ?? (model.status === "failed" ? "Couldn't read this item" : "Reading…")}
          </h2>
          {shown && (href || props.workstream) && (
            <div class="panel-actions">
              {href && (
                <a
                  class="button panel-open"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={leave}
                  onAuxClick={leave}
                >
                  Open in {shown.source}
                </a>
              )}
              {props.workstream && (
                <AddTo model={model} workstream={props.workstream} dispatch={dispatch} />
              )}
            </div>
          )}
        </header>
        {model.status === "failed" && (
          <p class="panel-problem" role="alert">
            {model.problem}{" "}
            <button type="button" class="quiet-action" onClick={readAgain}>
              Try again
            </button>
          </p>
        )}
        {shown && (
          <p class="panel-read" role="status">
            {model.status === "loading" ? "Reading again…" : `Read ${when(shown.readAt)}`}
            {behind(model) && model.status !== "loading" && (
              <>
                {" · "}
                <strong class="panel-behind">{shown.source} has changed since.</strong>{" "}
                <button type="button" class="quiet-action" onClick={readAgain}>
                  Read again
                </button>
              </>
            )}
          </p>
        )}
        {shown && <PanelBody view={shown} />}
      </Fragment>
    </aside>
  );
}

// Adding the item to the workstream the page is about, and then what came of
// it, with its Undo; or that it's in the workstream already.
function AddTo(props: { model: PanelModel; workstream: CurrentWorkstream; dispatch: Dispatch }) {
  const { model, workstream, dispatch } = props;
  const send = (msg: PanelMsg) => dispatch({ type: "panel", msg });
  const added = model.add?.added ?? null;
  const adding = model.add?.adding ?? false;
  const said =
    added?.workstreamId === workstream.id
      ? added.undo
        ? `Added to “${added.name}”.`
        : `Already in “${added.name}”.`
      : workstream.members?.has(model.id)
        ? `In “${workstream.name}”.`
        : null;
  return (
    <>
      {said === null ? (
        <button
          type="button"
          class="button panel-add"
          title={`Add to “${workstream.name}”`}
          disabled={adding}
          onClick={() => send({ type: "addClicked", workstream })}
        >
          Add to workstream
        </button>
      ) : (
        <p class="panel-added" role="status">
          <span>{said}</span>
          {added?.workstreamId === workstream.id && added.undo && (
            <button
              type="button"
              class="undo-action"
              disabled={adding}
              aria-label={`Undo: ${said}`}
              onClick={() => send({ type: "addUndoClicked" })}
            >
              Undo
            </button>
          )}
        </p>
      )}
      {model.add?.problem && (
        <p class="panel-problem" role="alert">
          {model.add.problem}
        </p>
      )}
    </>
  );
}

// Whether a key goes to something the user is typing in, a menu or a dialog.
const typing = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest(
      "input, textarea, select, dialog, [role=dialog], [role=menu], [role=listbox], [role=combobox]",
    ) !== null);

function StepIcon({ up }: { up?: boolean }) {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={up ? "M4.5 9.75L8 6.25l3.5 3.5" : "M4.5 6.25L8 9.75l3.5-3.5"} />
    </svg>
  );
}

function PanelBody({ view }: { view: ItemPanelView }) {
  const { read } = view;
  switch (read.status) {
    case "ok":
      return (
        <div class="panel-body">
          {read.blocks.map((block, i) => (
            <Block key={i} block={block} before={lastSaid(read.blocks.slice(0, i))} />
          ))}
        </div>
      );
    case "moved":
      return (
        <p class="panel-note">
          This item moved to <ItemKey item={read.to} />
          {read.to.title !== null && ` ${read.to.title}`}.
        </p>
      );
    case "gone":
      return (
        <p class="panel-note">
          {read.reason === "deleted"
            ? `This item isn't in ${view.source} any more.`
            : `Oriel can't read this item in ${view.source} now.`}
        </p>
      );
    case "unreadable":
      return <p class="panel-note">{view.source} sent this item in a shape Oriel can't show.</p>;
  }
}

// When the last message above was said, in any block, so a conversation's
// days read on across its message and its replies.
const lastSaid = (blocks: PanelBlock[]): string | null =>
  blocks.flatMap((block) => (block.kind === "messages" ? block.messages : [])).at(-1)?.at ?? null;

function Block({ block, before }: { block: PanelBlock; before: string | null }) {
  switch (block.kind) {
    case "facts":
      return (
        <dl class="panel-facts">
          {block.facts.map((fact) => (
            <div key={fact.name} class="panel-fact">
              <dt>{fact.name}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "text":
      return (
        <section class="panel-text">
          {block.heading !== null && <h3 class="panel-heading">{block.heading}</h3>}
          {block.format === "markdown" ? (
            <div class="reply panel-prose">
              <Markdown text={block.text} linksTo="any" />
            </div>
          ) : (
            <Plain spans={[{ kind: "text", text: block.text }]} />
          )}
        </section>
      );
    case "rich":
      return (
        <section class="panel-text">
          {block.heading !== null && <h3 class="panel-heading">{block.heading}</h3>}
          <div class="reply panel-prose">
            <ProseBlocks prose={block.prose} linksTo="any" />
          </div>
        </section>
      );
    case "messages":
      return (
        <section class="panel-messages">
          {block.heading !== null && <h3 class="panel-heading">{block.heading}</h3>}
          {block.messages.length === 0 ? (
            <p class="panel-empty">{block.empty}</p>
          ) : (
            <Messages messages={block.messages} before={before} />
          )}
        </section>
      );
    case "note":
      return <p class="panel-note">{block.text}</p>;
  }
}

const minute = 60_000;

// Messages as a conversation reads: one header for each day, saying how long
// after the message before it was when that's a day or more; each message
// with who wrote it and when, a run by one person within a few minutes under
// their name once. Mentions are set apart, files listed apart from the text,
// and an edit marked after it.
function Messages({ messages, before }: { messages: PanelMessage[]; before: string | null }) {
  const days = daysOf(messages, before);
  return (
    <ol class="panel-thread">
      {messages.map((message, i) => {
        const above = messages[i - 1];
        const newDay = days[i];
        const run =
          above?.author === message.author &&
          !newDay &&
          !message.labels?.length &&
          Date.parse(message.at) - Date.parse(above.at) < 5 * minute;
        return (
          <li key={i} class="panel-message" data-run={run || undefined}>
            {newDay && (
              <p class="panel-day">
                <span>
                  <time dateTime={message.at}>{dayName(message.at)}</time>
                  {newDay.later > 0 && ` · ${plural(newDay.later, "day")} later`}
                </span>
              </p>
            )}
            {!run && (
              <>
                <span class="avatar" aria-hidden="true">
                  {initials(message.author)}
                </span>
                <p class="panel-said">
                  <span class="panel-author">{message.author}</span>
                  <time dateTime={message.at} title={when(message.at)}>
                    {clock(message.at)}
                  </time>
                  {message.labels?.map((label) => (
                    <span key={label} class="panel-label">
                      {label}
                    </span>
                  ))}
                </p>
              </>
            )}
            <Plain spans={message.spans ?? [{ kind: "text", text: message.text }]} />
            {message.files && message.files.length > 0 && (
              <ul class="panel-files" aria-label="Files">
                {message.files.map((file, j) => (
                  <li key={j} class="panel-file">
                    <FileIcon />
                    {file}
                  </li>
                ))}
              </ul>
            )}
            {message.edited && (
              <p class="panel-edited">
                <time dateTime={message.edited} title={`Edited ${when(message.edited)}`}>
                  (edited)
                </time>
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// A day as a header names it, in the reader's zone and words.
const dayName = (instant: string): string =>
  new Date(instant).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

// The time of day alone, under a header that names the day.
const clock = (instant: string): string =>
  new Date(instant).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

// Text as written: blank lines part paragraphs, and each line stays a line.
function Plain({ spans }: { spans: PanelInline[] }) {
  return (
    <div class="panel-plain">
      {paragraphsOf(spans).map((paragraph, i) => (
        <p key={i}>
          <Inlines inlines={paragraph} linksTo="any" />
        </p>
      ))}
    </div>
  );
}

function FileIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.25 2.25h5l2.5 2.5v9h-7.5zM9.25 2.25v2.5h2.5" />
    </svg>
  );
}
