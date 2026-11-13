// Source text is always text here. Nothing here sets HTML.
import { type ComponentChildren, Fragment } from "preact";
import { useContext, useEffect, useId, useRef } from "preact/hooks";
import { ChatInput } from "./chat-input.tsx";
import { latestOf, PanelDockContext } from "./dock.tsx";
import { dragMove } from "./drag-move.ts";
import { clickTo } from "./nav.ts";
import { AnswerText } from "./thread-page.tsx";
import { behind, type CurrentWorkstream, daysOf, type PanelModel, paragraphsOf } from "./panel.ts";
import { addedText, addOf, type PanelAddMsg, type PanelAdds, undoable } from "./panel-adds.ts";
import { type EditForm, type PanelEditMsg, type PanelEdits, textOf } from "./panel-edits.ts";
import type { Connectors } from "./connectors.ts";
import {
  ConnectorsContext,
  type Dispatch,
  initials,
  Inlines,
  ItemKey,
  keyLabel,
  Markdown,
  plural,
  ProseBlocks,
  Stamp,
} from "./parts.tsx";
import { safeHref } from "./route.ts";
import { when } from "./time.ts";
import { UndoButton } from "./undo-stack.tsx";
import type { ItemPanelView, PanelBlock, PanelInline, PanelMessage } from "./view.ts";
import { Tooltip } from "./tooltip.tsx";

export function ItemPanel(props: {
  model: PanelModel;
  place: { index: number; count: number } | null;
  workstream: CurrentWorkstream | null;
  adds: PanelAdds;
  edits: PanelEdits;
  dock?: ComponentChildren;
  askable?: boolean;
  dispatch: Dispatch;
}) {
  const { model, place, dispatch } = props;
  const { view } = model;
  const connectors = useContext(ConnectorsContext);
  const heading = useRef<HTMLHeadingElement>(null);
  const steps = useRef<HTMLElement>(null);
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);
  useEffect(() => {
    if (!steps.current?.contains(document.activeElement)) heading.current?.focus();
  }, [model.id]);
  const step = (by: 1 | -1) => dispatch({ type: "panelStepped", by });
  // Not in a field or a menu, which have their own uses for the arrow keys.
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
  const glimpse = shown ? null : model.glimpse;
  const href = safeHref(shown?.url ?? null);
  const readAgain = () => dispatch({ type: "panel", msg: { type: "readAgainClicked" } });
  const leave = (event: MouseEvent) => {
    if (clickTo(event) !== "browser")
      dispatch({ type: "sourceOpened", id: model.id, via: "panel" });
  };
  // Its contents are drawn afresh for each item, so they fade in again where the panel itself stays put.
  return (
    <aside
      class="item-panel"
      aria-labelledby="item-panel-title"
      aria-busy={model.status === "loading"}
      data-steps={listed || undefined}
    >
      {place && (
        <nav class="panel-steps" aria-label="This list's items" ref={steps}>
          <Tooltip text="Previous (↑)">
            <button
              type="button"
              class="panel-step"
              aria-label="Previous item"
              disabled={place.index === 0}
              onClick={() => step(-1)}
            >
              <StepIcon up />
            </button>
          </Tooltip>
          <span class="panel-place">
            {place.index + 1} of {place.count}
          </span>
          <Tooltip text="Next (↓)">
            <button
              type="button"
              class="panel-step"
              aria-label="Next item"
              disabled={place.index === place.count - 1}
              onClick={() => step(1)}
            >
              <StepIcon />
            </button>
          </Tooltip>
        </nav>
      )}
      <Fragment key={model.id}>
        <header
          class="panel-head"
          {...(shown
            ? dragMove({
                kind: "item",
                id: shown.id,
                key: keyLabel(shown, connectors),
                title: shown.title,
                from: null,
              })
            : {})}
        >
          <p class="panel-source">
            {shown ? `${shown.source} · ${keyLabel(shown, connectors)}` : (glimpse?.key ?? "Item")}
          </p>
          <Tooltip text="Close (Esc)">
            <button
              type="button"
              class="panel-close"
              aria-label="Close the panel"
              onClick={() => dispatch({ type: "panelClosed" })}
            >
              ×
            </button>
          </Tooltip>
          <h2 id="item-panel-title" class="panel-title" tabIndex={-1} ref={heading}>
            {shown?.title ??
              glimpse?.title ??
              (model.status === "failed" ? "Couldn't read this item" : "Reading…")}
          </h2>
          {shown && (href || props.askable || props.workstream || editable(shown)) && (
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
              {props.askable && (
                <button
                  type="button"
                  class="button panel-ask"
                  onClick={() => dispatch({ type: "askAboutClicked" })}
                >
                  Ask about this
                </button>
              )}
              {editable(shown) && props.edits.form?.item !== shown.id && (
                <button
                  type="button"
                  class="button"
                  onClick={() =>
                    dispatch({
                      type: "panelEdit",
                      msg: {
                        type: "editClicked",
                        item: shown.id,
                        edit: editable(shown) ?? { fields: [] },
                      },
                    })
                  }
                >
                  Edit
                </button>
              )}
              {props.workstream && (
                <AddTo
                  view={shown}
                  adds={props.adds}
                  workstream={props.workstream}
                  dispatch={dispatch}
                />
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
        {glimpse && model.status === "loading" && (
          <p class="panel-read" role="status">
            {glimpse.status && `${glimpse.status} · `}Reading…
          </p>
        )}
        {shown && (
          <p class="panel-read" role="status">
            {model.status === "loading" ? (
              "Reading again…"
            ) : (
              <>
                Read <Stamp at={shown.readAt} />
              </>
            )}
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
        {shown && props.edits.form?.item === shown.id ? (
          <EditFields
            form={props.edits.form}
            name={keyLabel(shown, connectors)}
            send={(msg) => dispatch({ type: "panelEdit", msg })}
          />
        ) : (
          shown && <PanelBody view={shown} />
        )}
      </Fragment>
      {props.dock}
    </aside>
  );
}

export function PanelDock() {
  const dock = useContext(PanelDockContext);
  if (!dock) return null;
  const latest =
    latestOf(dock.view) ?? (dock.asked ? { kind: "sent" as const, text: dock.asked } : null);
  const working = dock.asked !== null || dock.view?.running === true;
  return (
    <section class="panel-dock" aria-label="The conversation">
      <div class="panel-dock-head">
        <div class="panel-dock-latest">
          {latest?.kind === "sent" && <p class="panel-dock-you">You: {latest.text}</p>}
          {latest?.kind === "answer" && dock.view && (
            <AnswerText text={latest.text} view={dock.view} />
          )}
          {working && latest?.kind !== "answer" && <p class="panel-dock-working">Working…</p>}
        </div>
        <button
          type="button"
          class="quiet-action panel-dock-chat"
          onClick={() => dock.onFold(true)}
        >
          <StepIcon up /> Chat
        </button>
      </div>
      <ChatInput {...dock.composer} elevation="flat" />
    </section>
  );
}

function AddTo(props: {
  view: ItemPanelView;
  adds: PanelAdds;
  workstream: CurrentWorkstream;
  dispatch: Dispatch;
}) {
  const { view, workstream, dispatch } = props;
  const connectors = useContext(ConnectorsContext);
  const send = (msg: PanelAddMsg) => dispatch({ type: "panelAdd", msg });
  const add = addOf(props.adds, { item: view.id, workstreamId: workstream.id });
  const said =
    (add && addedText(add)) ??
    (workstream.members?.has(view.id) ? `In “${workstream.name}”.` : null);
  return (
    <>
      {said === null ? (
        <Tooltip text={`Add to “${workstream.name}”`}>
          <button
            type="button"
            class="button panel-add"
            disabled={add?.pending != null}
            onClick={() =>
              send({
                type: "addClicked",
                item: { id: view.id, key: itemName(view, connectors) },
                workstream: { id: workstream.id, name: workstream.name },
              })
            }
          >
            Add to workstream
          </button>
        </Tooltip>
      ) : (
        <p class="panel-added" role="status">
          <span>{said}</span>
          {add && undoable(add) && (
            <UndoButton
              label={`Undo: ${said}`}
              disabled={add.pending !== null}
              onClick={() =>
                send({ type: "undoClicked", item: add.item, workstreamId: add.workstreamId })
              }
            />
          )}
        </p>
      )}
      {/* A failed Undo is read out from the stack, which says it too. */}
      {add?.problem && (
        <p class="panel-problem" role={add.done ? undefined : "alert"}>
          {add.problem}
        </p>
      )}
    </>
  );
}

const itemName = (view: ItemPanelView, connectors: Connectors): string => {
  const key = keyLabel(view, connectors);
  return key === view.key || view.title === null ? key : `“${view.title}”`;
};

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

const editable = (view: ItemPanelView) => (view.read.status === "ok" ? view.read.edit : undefined);

function EditFields(props: { form: EditForm; name: string; send(msg: PanelEditMsg): void }) {
  const { form, send } = props;
  const id = useId();
  const typed = (name: string) => (text: string) => send({ type: "fieldTyped", name, text });
  return (
    <form
      class="panel-edit"
      aria-label={`Edit ${props.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: "saveClicked", key: props.name });
      }}
    >
      {form.fields.map((field) => {
        const value = form.typed[field.name] ?? textOf(field);
        const input = `${id}-${field.name}`;
        const changed = (event: Event) =>
          typed(field.name)((event.currentTarget as HTMLInputElement).value);
        return (
          <div class="panel-edit-field" key={field.name}>
            <label class="panel-edit-label" for={input}>
              {field.label}
            </label>
            {field.kind === "text" ? (
              <textarea
                id={input}
                class="panel-edit-input panel-edit-text"
                rows={6}
                value={value}
                disabled={form.saving}
                onInput={changed}
              />
            ) : field.kind === "choice" ? (
              <select
                id={input}
                class="panel-edit-input"
                value={value}
                disabled={form.saving}
                onChange={changed}
              >
                {field.choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={input}
                class="panel-edit-input"
                type="text"
                inputMode={field.kind === "number" ? "decimal" : "text"}
                placeholder={
                  field.kind === "number" || field.kind === "person"
                    ? field.empty
                    : field.kind === "list"
                      ? "Separate them with commas"
                      : undefined
                }
                value={value}
                disabled={form.saving}
                onInput={changed}
              />
            )}
          </div>
        );
      })}
      {form.problem !== null && (
        <p class="panel-problem" role="alert">
          {form.problem}
        </p>
      )}
      <div class="panel-edit-actions">
        <button type="submit" class="button primary" disabled={form.saving}>
          {form.saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          class="button"
          disabled={form.saving}
          onClick={() => send({ type: "cancelClicked" })}
        >
          Cancel
        </button>
      </div>
    </form>
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
                  <Stamp at={message.at} absolute={clock} />
                  {message.labels?.map((label) => (
                    <span key={label} class="panel-label">
                      {label}
                    </span>
                  ))}
                </p>
              </>
            )}
            {message.prose ? (
              <div class="reply panel-prose">
                <ProseBlocks prose={message.prose} linksTo="any" />
              </div>
            ) : (
              <Plain spans={message.spans ?? [{ kind: "text", text: message.text }]} />
            )}
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

const dayName = (instant: string): string =>
  new Date(instant).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

const clock = (instant: string): string =>
  new Date(instant).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

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
