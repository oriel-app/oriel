// Small pieces every page uses. Source text is always rendered as text;
// nothing here sets HTML.
import { type ComponentChildren, createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import {
  type ChipKind,
  chipLabel,
  type ChipState,
  chipStateName,
  linkChip,
  stateNames,
  type Workspace,
} from "./chip.ts";
import { carries, type Dropped, readDrop } from "./drop.ts";
import { type Inline, opens, parse, type Prose } from "./markdown.ts";
import { clickTo } from "./nav.ts";
import type { Msg } from "./root.ts";
import { type Route, routeUrl, safeHref } from "./route.ts";
import type { ItemRow, ThreadStateId, WaitingOn } from "./view.ts";

export type Dispatch = (msg: Msg) => void;

// An in-app link: a real href, so it opens in a new tab too, and a plain
// click that stays in the page. `msg` is what that click sends, where
// following the link does more than go there, as opening a search result
// does; by default, that the link was followed.
export function Link(props: {
  route: Route;
  dispatch: Dispatch;
  msg?: Msg;
  class?: string;
  title?: string;
  id?: string;
  role?: "option";
  tabIndex?: number;
  children: ComponentChildren;
  "aria-current"?: "page" | undefined;
  "aria-label"?: string;
  "aria-selected"?: boolean;
}) {
  return (
    <a
      href={routeUrl(props.route)}
      class={props.class}
      title={props.title}
      id={props.id}
      role={props.role}
      tabIndex={props.tabIndex}
      aria-current={props["aria-current"]}
      aria-label={props["aria-label"]}
      aria-selected={props["aria-selected"]}
      onClick={(event) => {
        if (clickTo(event) !== "page") return;
        event.preventDefault();
        props.dispatch(props.msg ?? { type: "linkClicked", route: props.route });
      }}
    >
      {props.children}
    </a>
  );
}

// Where things dropped are added to a workstream: a Jira card dragged out of its
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

// The list on the page that holds a link to an item, by item ID, in the
// order it shows them: a Browse cluster's items, a workstream's members, a
// thread's rail or search results. An item opened from it can step through it
// in the panel.
export const ItemListContext = createContext<readonly string[] | null>(null);

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
  const list = useContext(ItemListContext);
  const href = safeHref(props.item.url);
  const id = props.item.id ?? (href ? links?.items.get(addressOf(href)) : undefined) ?? null;
  const dispatch = id === null ? null : (links?.dispatch ?? null);
  const opened = (id: string): Msg =>
    list?.includes(id) ? { type: "itemOpened", id, list } : { type: "itemOpened", id };
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
        onClick={() => dispatch(opened(id))}
      >
        {props.children}
      </button>
    );
  const clicked = (event: MouseEvent) => {
    const to = clickTo(event);
    if (to === "page") {
      event.preventDefault();
      dispatch(opened(id));
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
  return <ProseBlocks prose={read} linksTo={linksTo} />;
}

// Blocks already read, from markdown or by a source's server side, such as
// Jira's rich text, the same way.
export function ProseBlocks({ prose, linksTo }: { prose: readonly Prose[]; linksTo: Sites }) {
  return <>{prose.map((each, i) => block(each, i, linksTo))}</>;
}

type Sites = ReadonlySet<string> | "any";

// What is inside a block, already read, such as a message's text with its
// mentions.
export function Inlines({ inlines, linksTo }: { inlines: readonly Inline[]; linksTo: Sites }) {
  return <>{inlines.map((inline, i) => span(inline, i, linksTo))}</>;
}

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
    case "quote": {
      const from = quotedFrom(prose);
      if (from) return <QuoteFrom key={key} id={from.id} rest={from.rest} to={to} />;
      return (
        <blockquote key={key}>{prose.children.map((inner, i) => block(inner, i, to))}</blockquote>
      );
    }
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
    case "route":
      return <RouteLink key={key} route={inline.route} label={spans(inline.children)} />;
    case "ref":
      return <Ref key={key} id={inline.id} />;
    case "mention":
    case "channel":
      return (
        <span key={key} class="mention" data-kind={inline.kind}>
          {inline.text}
        </span>
      );
  }
}

// A reply's link to a thread in Oriel, or a change set in one: a chip with
// its name and where it stands, which opens it in the window, as any in-app
// link does. One the window doesn't know shows the reply's label. Where
// nothing can navigate, as on a review link's page, it is its label.
function RouteLink(props: { route: Route; label: ComponentChildren }) {
  const links = useContext(ItemLinksContext);
  const workspace = useContext(WorkspaceContext);
  if (links === null) return <span>{props.label}</span>;
  const chip = linkChip(props.route, workspace);
  if (chip === null)
    return (
      <Link route={props.route} dispatch={links.dispatch}>
        {props.label}
      </Link>
    );
  return (
    <Link
      route={props.route}
      dispatch={links.dispatch}
      class="chip-link"
      aria-label={chipLabel(chip)}
    >
      <Chip kind={chip.kind} name={chip.name ?? props.label} state={chip.state} />
    </Link>
  );
}

// The window's threads and their change sets, for the chips that name them.
export const WorkspaceContext = createContext<Workspace>({ threads: null, changeSets: null });

// A chip (chip.ts): its kind's icon, its name, and where it stands.
export function Chip(props: { kind: ChipKind; name: ComponentChildren; state: ChipState | null }) {
  const { kind, state } = props;
  return (
    <span class="chip" data-kind={kind} data-state={state ?? undefined}>
      <ChipIcon kind={kind} />
      <span class="chip-name">{props.name}</span>
      {state && <span class="chip-state">{chipStateName(state)}</span>}
    </span>
  );
}

function ChipIcon({ kind }: { kind: ChipKind }) {
  switch (kind) {
    // A speech bubble: a chat.
    case "thread":
      return (
        <svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z" />
        </svg>
      );
    // A plus over a minus: a diff.
    case "change-set":
      return (
        <svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.5" y="2" width="11" height="12" rx="2" />
          <path d="M8 4.5v4M6 6.5h4M6 11h4" />
        </svg>
      );
  }
}

function MarkdownLink(props: { href: string; sites: Sites; label: ComponentChildren }) {
  const { href, sites, label } = props;
  const links = useContext(ItemLinksContext);
  // Blocks a source's side read are checked there too; an address that
  // isn't http(s) is text all the same.
  if (!safeHref(href))
    return (
      <span>
        {label} ({href})
      </span>
    );
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

// A working thread reads as what it waits on, so one whose agent has finished
// doesn't look busy.
export const waitingNames: Record<WaitingOn, string> = {
  agent: "Agent working",
  held: "Message held",
  review: "Needs review",
  apply: "Applying…",
  stalled: "Apply stalled",
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

export function SearchIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
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

// Spike (reply-elements): what a reference names, as Oriel draws it. The
// window builds it from its own data (the index, threads, change sets and
// workstreams), never from the agent's words. `text` is the item's own text,
// for checking a quote from it.
export type RefView = {
  kind: "item" | "thread" | "change-set" | "workstream";
  source: "jira" | "folder" | "slack" | null;
  // A tracker item's key; null for one with none a person reads.
  key: string | null;
  name: string;
  state: { id: string; name: string } | null;
  text?: string;
};
export const RefsContext = createContext<(id: string) => RefView | null>(() => null);

// How long a name runs inside a sentence before it is cut, whole on hover.
const refNameMax = 44;
const cut = (name: string) => {
  if (name.length <= refNameMax) return name;
  const head = name.slice(0, refNameMax);
  const space = head.lastIndexOf(" ");
  return `${(space > refNameMax / 2 ? head.slice(0, space) : head).replace(/[\s,:;.–-]+$/, "")}…`;
};

// A reference, drawn inline as a link in the sentence: an icon for what it
// is, its name, and where it stands. It wraps with the line like any words.
export function Ref({ id }: { id: string }) {
  const view = useContext(RefsContext)(id);
  if (!view)
    return (
      <span class="ref" data-unknown title={`Oriel has nothing with the ID ${id}`}>
        unknown reference
      </span>
    );
  const full = [view.key, view.name].filter(Boolean).join(" ");
  return (
    <a
      class="ref"
      href="#"
      data-kind={view.kind}
      data-source={view.source ?? undefined}
      data-state={view.state?.id}
      title={full + (view.state ? ` · ${view.state.name}` : "")}
      onClick={(event) => event.preventDefault()}
    >
      <span class="ref-lead">
        <RefIcon view={view} />
        {view.key && <span class="ref-key">{view.key}</span>}
      </span>
      {view.key && " "}
      <span class="ref-name">{cut(view.name)}</span>
      {view.state && <span class="ref-state">{view.state.name}</span>}
    </a>
  );
}

function RefIcon({ view }: { view: RefView }) {
  const shape =
    view.kind === "thread" ? (
      <path d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z" />
    ) : view.kind === "change-set" ? (
      <>
        <rect x="2.5" y="2" width="11" height="12" rx="2" />
        <path d="M8 4.5v4M6 6.5h4M6 11h4" />
      </>
    ) : view.kind === "workstream" ? (
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" />
    ) : view.source === "folder" ? (
      <path d="M4 2h5l3 3v9H4zM9 2v3h3" />
    ) : view.source === "slack" ? (
      <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />
    ) : (
      <>
        <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
        <path d="M5.5 8l1.8 1.8L10.5 6" />
      </>
    );
  return (
    <svg class="ref-icon" viewBox="0 0 16 16" aria-hidden="true">
      {shape}
    </svg>
  );
}

// A quote whose first line is a lone reference: quoted from that item.
function quotedFrom(prose: Prose & { kind: "quote" }): { id: string; rest: Prose[] } | null {
  const [first, ...rest] = prose.children;
  if (first?.kind !== "paragraph") return null;
  const [lead, ...after] = first.children.filter(
    (inline) => !(inline.kind === "text" && inline.text.trim() === ""),
  );
  if (lead?.kind !== "ref") return null;
  const tail = after[0]?.kind === "break" ? after.slice(1) : after;
  const body = tail.length ? [{ kind: "paragraph" as const, children: tail }, ...rest] : rest;
  return body.length ? { id: lead.id, rest: body } : null;
}

const flat = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const proseText = (prose: readonly Prose[]): string =>
  prose
    .map((each) =>
      each.kind === "paragraph" || each.kind === "heading"
        ? inlineText(each.children)
        : each.kind === "quote"
          ? proseText(each.children)
          : each.kind === "code"
            ? each.text
            : "",
    )
    .join(" ");

const inlineText = (inlines: readonly Inline[]): string =>
  inlines
    .map((inline) =>
      inline.kind === "text" || inline.kind === "code"
        ? inline.text
        : inline.kind === "break"
          ? " "
          : "children" in inline
            ? inlineText(inline.children)
            : "",
    )
    .join("");

// The quote, under the item it is from, and whether Oriel found it there
// word for word.
function QuoteFrom(props: { id: string; rest: Prose[]; to: Sites }) {
  const view = useContext(RefsContext)(props.id);
  const said = flat(proseText(props.rest)).replace(/^"|"$/g, "");
  const found = view?.text !== undefined && flat(view.text).includes(said);
  return (
    <figure class="quote-from" data-found={found ? "" : undefined}>
      <figcaption>
        {found ? "Word for word from " : "Quoted from "}
        <Ref id={props.id} />
        {!found && <span class="quote-unchecked"> · not found there word for word</span>}
      </figcaption>
      <blockquote>{props.rest.map((inner, i) => block(inner, i, props.to))}</blockquote>
    </figure>
  );
}
