// Small pieces every page uses. Source text is always rendered as text;
// nothing here sets HTML.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { carries, type Dropped, readDrop } from "./drop.ts";
import { type Inline, opens, parse, type Prose } from "./markdown.ts";
import type { Msg } from "./root.ts";
import { type Route, routeUrl, safeHref } from "./route.ts";
import type { ItemRef, ItemRow, ThreadStateId } from "./view.ts";

export type Dispatch = (msg: Msg) => void;

// An in-app link: a real href, so it opens in a new tab too, and a plain
// click that stays in the page.
export function Link(props: {
  route: Route;
  dispatch: Dispatch;
  class?: string;
  children: ComponentChildren;
  "aria-current"?: "page" | undefined;
}) {
  return (
    <a
      href={routeUrl(props.route)}
      class={props.class}
      aria-current={props["aria-current"]}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        props.dispatch({ type: "linkClicked", route: props.route });
      }}
    >
      {props.children}
    </a>
  );
}

// Where things dropped are added to a group: a Jira card dragged out of its
// board, a link, an item's key, or a file from the connected folder. Only
// drags from outside Oriel: one that starts in this page, like text moved
// into the composer, is left to the browser. While one is over the zone, a
// veil covers it, says where the drop goes and takes the drop, so leaving the
// veil is leaving the zone.
let dragFromHere = false;

export function DropZone(props: {
  label: string;
  class?: string;
  onDrop: (dropped: Dropped) => void;
  children: ComponentChildren;
}) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const started = () => {
      dragFromHere = true;
    };
    const ended = () => {
      dragFromHere = false;
    };
    document.addEventListener("dragstart", started);
    document.addEventListener("dragend", ended);
    return () => {
      document.removeEventListener("dragstart", started);
      document.removeEventListener("dragend", ended);
    };
  }, []);
  const ours = (event: DragEvent) =>
    !dragFromHere && event.dataTransfer !== null && carries(event.dataTransfer.types);
  return (
    <div
      class={props.class}
      onDragEnter={(event) => {
        if (!ours(event)) return;
        event.preventDefault();
        setOver(true);
      }}
    >
      {props.children}
      {over && (
        <div
          class="drop-veil"
          onDragOver={(event) => {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            if (event.dataTransfer) props.onDrop(readDrop(event.dataTransfer));
          }}
        >
          <p>{props.label}</p>
        </div>
      )}
    </div>
  );
}

// An item's key, linked to its source when the source gave an http(s) URL.
export function ItemKey({ item }: { item: ItemRef }) {
  const href = safeHref(item.url);
  const label = keyLabel(item);
  if (!href) return <span class="key">{label}</span>;
  return (
    <a class="key source-link" href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

// An agent's reply as formatted text. A heading starts at h3: the thread's
// title and its sections hold h1 and h2. Read once per text: the page redraws
// every reply as the latest one streams in.
//
// A link opens only to a site the thread's own items come from (`linksTo`, as
// origins); any other shows its label and its whole address as text.
export function Markdown({ text, linksTo }: { text: string; linksTo: ReadonlySet<string> }) {
  const read = useMemo(() => parse(text), [text]);
  return <>{read.map((prose, i) => block(prose, i, linksTo))}</>;
}

function block(prose: Prose, key: number, to: ReadonlySet<string>): ComponentChildren {
  const spans = (inlines: Inline[]) => inlines.map((inline, i) => span(inline, i, to));
  switch (prose.kind) {
    case "paragraph":
      return <p key={key}>{spans(prose.children)}</p>;
    case "heading": {
      const Heading = `h${Math.min(prose.level + 2, 6)}` as "h3";
      return <Heading key={key}>{spans(prose.children)}</Heading>;
    }
    case "list": {
      const items = prose.items.map((item, i) => (
        <li key={i}>
          {item.map((inner, j) =>
            prose.tight && inner.kind === "paragraph" ? (
              <span key={j}>{spans(inner.children)}</span>
            ) : (
              block(inner, j, to)
            ),
          )}
        </li>
      ));
      return prose.ordered ? (
        <ol key={key} start={prose.start === 1 ? undefined : prose.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case "quote":
      return (
        <blockquote key={key}>{prose.children.map((inner, i) => block(inner, i, to))}</blockquote>
      );
    case "code":
      return (
        <pre key={key}>
          <code>{prose.text}</code>
        </pre>
      );
    case "table":
      return (
        <div key={key} class="table-scroll">
          <table>
            <thead>
              <tr>
                {prose.head.map((cell, i) => (
                  <th key={i}>{spans(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prose.rows.map((row, i) => (
                <tr key={i}>
                  {prose.head.map((_, j) => (
                    <td key={j}>{spans(row[j] ?? [])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr key={key} />;
  }
}

function span(inline: Inline, key: number, to: ReadonlySet<string>): ComponentChildren {
  const spans = (inlines: Inline[]) => inlines.map((inner, i) => span(inner, i, to));
  switch (inline.kind) {
    case "text":
      return inline.text;
    case "break":
      return <br key={key} />;
    case "code":
      return <code key={key}>{inline.text}</code>;
    case "strong":
      return <strong key={key}>{spans(inline.children)}</strong>;
    case "em":
      return <em key={key}>{spans(inline.children)}</em>;
    case "link":
      return opens(inline.href, to) ? (
        <a key={key} href={inline.href} target="_blank" rel="noopener noreferrer">
          {spans(inline.children)}
        </a>
      ) : (
        <span key={key}>
          {spans(inline.children)} ({inline.href})
        </span>
      );
  }
}

// What a person reads for an item's key. A file's key is a hash, which means
// nothing to anyone, so it reads as what the item is; its title says which.
export function keyLabel(item: { id: string; key: string }): string {
  return item.id.startsWith("folder:") ? "File" : item.key;
}

export const stateNames: Record<ThreadStateId, string> = {
  working: "Working",
  done: "Done",
  "handed-off": "Handed off",
  dropped: "Dropped",
};

export function StateChip({ state }: { state: ThreadStateId }) {
  return (
    <span class="state-chip" data-state={state}>
      {stateNames[state]}
    </span>
  );
}

export function TypeMark({ row }: { row: ItemRow | null }) {
  const type = row?.type ?? "";
  return <span class="type" data-type={type.toLowerCase()} title={type || undefined} />;
}

export function Assignee({ name }: { name: string | null }) {
  if (name === null) {
    return (
      <span class="assignee none">
        <span class="avatar" aria-hidden="true" />
        Unassigned
      </span>
    );
  }
  return (
    <span class="assignee">
      <span class="avatar" aria-hidden="true">
        {initials(name)}
      </span>
      {name}
    </span>
  );
}

export function Chevron() {
  return (
    <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

export function Mark() {
  return (
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
      <path d="M2.5 8.5h15M10 8.5v9" />
    </svg>
  );
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = Array.from(words[0] ?? "")[0] ?? "";
  const last = words.length > 1 ? (Array.from(words.at(-1) ?? "")[0] ?? "") : "";
  return (first + last).toUpperCase();
}

// An instant as a short date and time, in the reader's zone.
export function when(instant: string): string {
  return new Date(instant).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
