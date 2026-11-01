// Small pieces every page uses. Source text is always rendered as text;
// nothing here sets HTML.
import { type ComponentChildren, createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { carries, type Dropped, readDrop } from "./drop.ts";
import { type Inline, opens, parse, type Prose } from "./markdown.ts";
import { clickTo } from "./nav.ts";
import type { Msg } from "./root.ts";
import { type Route, routeUrl, safeHref } from "./route.ts";
import type { ItemRow, ThreadStateId, WaitingOn } from "./view.ts";

export type Dispatch = (msg: Msg) => void;

// An in-app link: a real href, so it opens in a new tab too, and a plain
// click that stays in the page.
export function Link(props: {
  route: Route;
  dispatch: Dispatch;
  class?: string;
  title?: string;
  children: ComponentChildren;
  "aria-current"?: "page" | undefined;
}) {
  return (
    <a
      href={routeUrl(props.route)}
      class={props.class}
      title={props.title}
      aria-current={props["aria-current"]}
      onClick={(event) => {
        if (clickTo(event) !== "page") return;
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

// Where links to items lead on this page: `dispatch` opens the panel, and
// `items` names, by address, the items this page knows, so a link that has
// only an address (in a reply, or a diff's value) is a link to its item.
// With no provider, as on a review link's page, which has no panel, links to
// items go to their sources.
export type ItemLinks = { dispatch: Dispatch; items: ReadonlyMap<string, string> };
export const ItemLinksContext = createContext<ItemLinks | null>(null);

// An address as the browser writes it, so two ways of writing one match.
export const addressOf = (url: string): string => URL.parse(url)?.href ?? url;

// A link to an item, wherever one is named. A plain click opens the item in
// the panel beside the page; a Cmd/Ctrl, Shift or middle click goes to its
// source, as any link's does (`clickTo`). Where there is no panel, or the
// item can't be told, it is only a link to its source; an item whose source
// has no web page, such as a file, opens only in the panel.
export function ItemLink(props: {
  item: { id: string | null; url: string | null };
  class?: string;
  children: ComponentChildren;
}) {
  const links = useContext(ItemLinksContext);
  const href = safeHref(props.item.url);
  const id = props.item.id ?? (href ? links?.items.get(addressOf(href)) : undefined) ?? null;
  const dispatch = id === null ? null : (links?.dispatch ?? null);
  if (id === null || dispatch === null) {
    if (!href) return <span class={props.class}>{props.children}</span>;
    return (
      <a class={props.class} href={href} target="_blank" rel="noopener noreferrer">
        {props.children}
      </a>
    );
  }
  if (!href)
    return (
      <button
        type="button"
        class={props.class ? `${props.class} item-link` : "item-link"}
        onClick={() => dispatch({ type: "itemOpened", id })}
      >
        {props.children}
      </button>
    );
  const clicked = (event: MouseEvent) => {
    const to = clickTo(event);
    if (to === "page") {
      event.preventDefault();
      dispatch({ type: "itemOpened", id });
    } else if (to === "new-tab") dispatch({ type: "sourceOpened", id, via: "link" });
  };
  return (
    <a
      class={props.class}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={clicked}
      onAuxClick={clicked}
    >
      {props.children}
    </a>
  );
}

// An item's key, as a link to it.
export function ItemKey({
  item,
}: {
  item: { id: string | null; key: string; url: string | null };
}) {
  return (
    <ItemLink item={item} class="key source-link">
      {keyLabel({ id: item.id ?? "", key: item.key })}
    </ItemLink>
  );
}

// A chat message's replies, as a link to its message: in Oriel they are part
// of it, not items of their own, so they open in its panel, or where they
// were written.
export function Replies(props: { id: string; replies: { count: number; url: string } }) {
  const { count, url } = props.replies;
  return (
    <ItemLink item={{ id: props.id, url }} class="replies source-link">
      {`${count} ${count === 1 ? "reply" : "replies"}`}
    </ItemLink>
  );
}

// An agent's reply as formatted text. A heading starts at h3: the thread's
// title and its sections hold h1 and h2. Read once per text: the page redraws
// every reply as the latest one streams in.
//
// A link opens only to a site the thread's own items come from (`linksTo`, as
// origins), or with "any", to any http(s) address; any other shows its label
// and its whole address as text. A link to an item the page knows is a link
// to that item (`ItemLink`).
export function Markdown({ text, linksTo }: { text: string; linksTo: Sites }) {
  const read = useMemo(() => parse(text), [text]);
  return <>{read.map((prose, i) => block(prose, i, linksTo))}</>;
}

type Sites = ReadonlySet<string> | "any";

function block(prose: Prose, key: number, to: Sites): ComponentChildren {
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

function span(inline: Inline, key: number, to: Sites): ComponentChildren {
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
      return (
        <MarkdownLink key={key} href={inline.href} sites={to} label={spans(inline.children)} />
      );
  }
}

function MarkdownLink(props: { href: string; sites: Sites; label: ComponentChildren }) {
  const { href, sites, label } = props;
  const links = useContext(ItemLinksContext);
  if (links?.items.has(addressOf(href)))
    return <ItemLink item={{ id: null, url: href }}>{label}</ItemLink>;
  return sites === "any" || opens(href, sites) ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  ) : (
    <span>
      {label} ({href})
    </span>
  );
}

// What a person reads for an item's key. A file's key is a hash and a
// message's is a channel ID and a time, which mean nothing to anyone, so each
// reads as what the item is; its title says which.
export function keyLabel(item: { id: string; key: string }): string {
  if (item.id.startsWith("folder:")) return "File";
  return item.id.startsWith("slack:") ? "Message" : item.key;
}

export const stateNames: Record<ThreadStateId, string> = {
  working: "Working",
  done: "Done",
  "handed-off": "Handed off",
  dropped: "Dropped",
};

// A working thread reads as what it waits on, so one whose agent has finished
// doesn't look busy.
export const waitingNames: Record<WaitingOn, string> = {
  agent: "Agent working",
  review: "Needs review",
  apply: "Applying…",
  reply: "Your turn",
};

export function StateChip(props: { state: ThreadStateId; waitingOn: WaitingOn | null }) {
  const { state, waitingOn } = props;
  return (
    <span class="state-chip" data-state={state} data-waiting={waitingOn ?? undefined}>
      {waitingOn ? waitingNames[waitingOn] : stateNames[state]}
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

// An estimate in story points, wherever the window shows one: "1 point",
// "3 points", or "1 pt" and "3 pts" where a row has little room.
export function points(count: number, short = false): string {
  return plural(count, short ? "pt" : "point");
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
