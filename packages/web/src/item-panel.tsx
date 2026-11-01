// The panel beside the page: an item in its source's own view, read live, as
// Oriel's own elements. Source text is always text here: a file's markdown is
// read into the same blocks an agent's reply is, and anything else shows as
// written, line by line. Nothing here sets HTML.
import { Fragment } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { clickTo } from "./nav.ts";
import { behind, type PanelModel } from "./panel.ts";
import { type Dispatch, initials, ItemKey, keyLabel, Markdown, plural, when } from "./parts.tsx";
import { safeHref } from "./route.ts";
import type { ItemPanelView, PanelBlock } from "./view.ts";

export function ItemPanel({ model, dispatch }: { model: PanelModel; dispatch: Dispatch }) {
  const { view } = model;
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening an item moves focus to it; closing gives focus back to what had it.
  useEffect(() => {
    const before = document.activeElement;
    heading.current?.focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [model.id]);
  const shown = view?.id === model.id ? view : null;
  const href = safeHref(shown?.url ?? null);
  const readAgain = () => dispatch({ type: "panel", msg: { type: "readAgainClicked" } });
  const leave = (event: MouseEvent) => {
    if (clickTo(event) !== "browser")
      dispatch({ type: "sourceOpened", id: model.id, via: "panel" });
  };
  return (
    <aside
      class="item-panel"
      aria-labelledby="item-panel-title"
      aria-busy={model.status === "loading"}
    >
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
        {shown && href && (
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
    </aside>
  );
}

function PanelBody({ view }: { view: ItemPanelView }) {
  const { read } = view;
  switch (read.status) {
    case "ok":
      return (
        <div class="panel-body">
          {read.blocks.map((block, i) => (
            <Block key={i} block={block} />
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

function Block({ block }: { block: PanelBlock }) {
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
            <Plain text={block.text} />
          )}
        </section>
      );
    case "messages":
      return (
        <section class="panel-messages">
          {block.heading !== null && <h3 class="panel-heading">{block.heading}</h3>}
          {block.messages.length === 0 ? (
            <p class="panel-empty">{block.empty}</p>
          ) : (
            <Messages messages={block.messages} />
          )}
        </section>
      );
    case "note":
      return <p class="panel-note">{block.text}</p>;
  }
}

type Message = Extract<PanelBlock, { kind: "messages" }>["messages"][number];

const minute = 60_000;
const day = 24 * 60 * minute;

// Messages as a conversation reads: each with who wrote it, a run by one
// person within a few minutes under their name once, and a long pause marked.
function Messages({ messages }: { messages: Message[] }) {
  return (
    <ol class="panel-thread">
      {messages.map((message, i) => {
        const before = messages[i - 1];
        const gap = before ? Date.parse(message.at) - Date.parse(before.at) : 0;
        const later = gap >= day ? Math.floor(gap / day) : 0;
        const run = before?.author === message.author && later === 0 && gap < 5 * minute;
        return (
          <li key={i} class="panel-message" data-run={run || undefined}>
            {later > 0 && <p class="panel-later">{plural(later, "day")} later</p>}
            {!run && (
              <>
                <span class="avatar" aria-hidden="true">
                  {initials(message.author)}
                </span>
                <p class="panel-said">
                  <span class="panel-author">{message.author}</span>
                  <time dateTime={message.at}>{when(message.at)}</time>
                </p>
              </>
            )}
            <Plain text={message.text} />
          </li>
        );
      })}
    </ol>
  );
}

// Text as written: blank lines part paragraphs, and each line stays a line.
function Plain({ text }: { text: string }) {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim() !== "");
  return (
    <div class="panel-plain">
      {paragraphs.map((paragraph, i) => (
        <p key={i}>
          {paragraph.split("\n").map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
