// Small pieces every page uses. Source text is always rendered as text;
// nothing here sets HTML.
import { type ComponentChildren, createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import {
  chipKey,
  chipLabel,
  chipName,
  chipState,
  chipStateName,
  keyLabel,
  stateNames,
} from "./chip.ts";
import { type Connectors, noConnectors } from "./connectors.ts";
import { carries, type Dropped, readDrop } from "./drop.ts";
import { dragMove } from "./drag-move.ts";
import { ContextMenu, type MenuItem } from "./menu.tsx";
import type { CarriedItem } from "./moving.ts";
import { type Inline, opens, parse, type Prose, quoteKey } from "./markdown.ts";
import { clickTo } from "./nav.ts";
import type { Msg } from "./root.ts";
import { type Route, routeUrl, safeHref } from "./route.ts";
import { defaultTimeFormat, stamp, when } from "./time.ts";
import type {
  Chips,
  ChipView,
  ConnectorIcon,
  ItemRow,
  MemberView,
  Quotes,
  SendKey,
  ThreadStateId,
  TimeFormat,
  WaitingOn,
} from "./view.ts";
import { Tooltip } from "./tooltip.tsx";

export type Dispatch = (msg: Msg) => void;

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

// Only drags from outside Oriel: one that starts in this page is left to the browser.
// A veil over the zone takes the drop, so leaving the veil is leaving the zone.
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

export type ItemLinks = { dispatch: Dispatch; items: ReadonlyMap<string, string> };
export const ItemLinksContext = createContext<ItemLinks | null>(null);

export const ItemListContext = createContext<readonly string[] | null>(null);

export const OpenItemContext = createContext<string | null>(null);

export const EntryContext = createContext<{ thread: string; seq: number } | null>(null);

export const SendKeyContext = createContext<SendKey>("enter");

export const TimeFormatContext = createContext<TimeFormat>(defaultTimeFormat);

export const ConnectorsContext = createContext<Connectors>(noConnectors);

export const addressOf = (url: string): string => URL.parse(url)?.href ?? url;

export function ItemLink(props: {
  item: { id: string | null; url: string | null };
  class?: string;
  children: ComponentChildren;
}) {
  const links = useContext(ItemLinksContext);
  const list = useContext(ItemListContext);
  const entry = useContext(EntryContext);
  const href = safeHref(props.item.url);
  const id = props.item.id ?? (href ? links?.items.get(addressOf(href)) : undefined) ?? null;
  const dispatch = id === null ? null : (links?.dispatch ?? null);
  const opened = (id: string): Msg => ({
    type: "itemOpened",
    id,
    ...(list?.includes(id) ? { list } : {}),
    ...(entry ? { under: entry } : {}),
  });
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

export function ItemKey({
  item,
}: {
  item: { id: string | null; key: string; url: string | null };
}) {
  const connectors = useContext(ConnectorsContext);
  return (
    <ItemLink item={item} class="key source-link">
      {keyLabel({ id: item.id ?? "", key: item.key }, connectors)}
    </ItemLink>
  );
}

export function Replies(props: { id: string; replies: { count: number; url: string } }) {
  const { count, url } = props.replies;
  return (
    <ItemLink item={{ id: props.id, url }} class="replies source-link">
      {`${count} ${count === 1 ? "reply" : "replies"}`}
    </ItemLink>
  );
}

// A link opens only to a site the thread's own items come from, or with "any", to any http(s) address;
// any other shows as text. In any text but an answer, such as a source's own, `[[…]]` is text.
export function Markdown(props: { text: string; linksTo: Sites; answer?: boolean }) {
  const { text, linksTo, answer = false } = props;
  const read = useMemo(() => parse(text, { chips: answer }), [text, answer]);
  return <ProseBlocks prose={read} linksTo={linksTo} />;
}

export function ProseBlocks({ prose, linksTo }: { prose: readonly Prose[]; linksTo: Sites }) {
  return <>{prose.map((each, i) => block(each, i, linksTo))}</>;
}

type Sites = ReadonlySet<string> | "any";

export function Inlines({ inlines, linksTo }: { inlines: readonly Inline[]; linksTo: Sites }) {
  return <>{inlines.map((inline, i) => span(inline, i, linksTo))}</>;
}

function block(prose: Prose, key: number, to: Sites): ComponentChildren {
  const spans = (inlines: Inline[]) => inlines.map((inline, i) => span(inline, i, to));
  switch (prose.kind) {
    case "paragraph":
      return <p key={key}>{spans(prose.children)}</p>;
    case "heading": {
      // The thread's title and its sections hold h1 and h2, so a reply's headings start at h3.
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
    case "quote-from":
      return <QuoteFrom key={key} quote={prose} to={to} />;
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
    case "chip":
      return <AnswerChip key={key} id={inline.id} />;
    case "mention":
    case "channel":
      return (
        <span key={key} class="mention" data-kind={inline.kind}>
          {inline.text}
        </span>
      );
  }
}

function RouteLink(props: { route: Route; label: ComponentChildren }) {
  const links = useContext(ItemLinksContext);
  if (links === null) return <span>{props.label}</span>;
  return (
    <Link route={props.route} dispatch={links.dispatch}>
      {props.label}
    </Link>
  );
}

export const ChipsContext = createContext<Chips>({});

export const QuotesContext = createContext<Quotes>({});

// Captioned by Oriel's check, never by the answer's words.
function QuoteFrom(props: { quote: Extract<Prose, { kind: "quote-from" }>; to: Sites }) {
  const { quote, to } = props;
  const found: boolean | undefined = useContext(QuotesContext)[quoteKey(quote)];
  return (
    <figure class="quote-from" data-found={found === undefined ? undefined : String(found)}>
      <figcaption>
        {found ? "Word for word from " : "Quoted from "}
        <AnswerChip id={quote.id} />
      </figcaption>
      <blockquote>{quote.children.map((inner, i) => block(inner, i, to))}</blockquote>
    </figure>
  );
}

export function AnswerChip({ id }: { id: string }) {
  const chips = useContext(ChipsContext);
  if (!Object.hasOwn(chips, id))
    return (
      <span class="chip" data-pending="">
        …
      </span>
    );
  const view = chips[id];
  if (!view)
    return (
      <span class="chip" data-unknown="" title="Oriel has nothing with this ID">
        unknown reference
      </span>
    );
  return <Chip id={id} view={view} />;
}

export function Chip({ id, view }: { id: string; view: ChipView }) {
  const links = useContext(ItemLinksContext);
  const connectors = useContext(ConnectorsContext);
  const open = useContext(OpenItemContext);
  const key = chipKey(view, connectors);
  const state = chipStateName(view);
  const label = chipLabel(view, connectors);
  if (links === null)
    return (
      <span class="chip" data-kind={view.kind} data-plain="">
        {[key, view.name].filter(Boolean).join(" ")}
        {state && ` (${state})`}
      </span>
    );
  const name = chipName(view.name);
  const space = key ? -1 : name.indexOf(" ");
  const first = space < 0 ? name : name.slice(0, space);
  const body = (
    <>
      <span class="chip-lead">
        <ChipIcon view={view} connectors={connectors} />
        {key ? <span class="chip-key">{key}</span> : <span class="chip-name">{first}</span>}
      </span>
      {key && " "}
      {(key || space >= 0) && <span class="chip-name">{key ? name : name.slice(space)}</span>}
      {state && <span class="chip-state">{state}</span>}
    </>
  );
  const shared = { "data-kind": view.kind, "data-state": chipState(view) };
  if (view.kind === "item")
    return (
      <span class="chip" {...shared} data-open={open === id || undefined} title={label}>
        <ItemLink item={{ id, url: view.url }} class="chip-link">
          {body}
        </ItemLink>
      </span>
    );
  const route: Route =
    view.kind === "thread"
      ? { page: "thread", id }
      : view.kind === "change-set"
        ? { page: "thread", id: view.thread, changeSet: id }
        : { page: "workstream", id };
  return (
    <span class="chip" {...shared} title={label}>
      <Link route={route} dispatch={links.dispatch} class="chip-link" aria-label={label}>
        {body}
      </Link>
    </span>
  );
}

const itemIcons: Record<ConnectorIcon, ComponentChildren> = {
  ticket: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="M5.5 8l1.8 1.8L10.5 6" />
    </>
  ),
  page: <path d="M4 2h5l3 3v9H4zM9 2v3h3" />,
  message: <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />,
  row: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M2.5 9.5h11M6 3v10" />
    </>
  ),
};

function ChipIcon({ view, connectors }: { view: ChipView; connectors: Connectors }) {
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
    ) : (
      itemIcons[connectors[view.source]?.icon ?? "ticket"]
    );
  return (
    <svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
      {shape}
    </svg>
  );
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

export { keyLabel } from "./chip.ts";

export const waitingNames: Record<WaitingOn, string> = {
  agent: "Agent working",
  held: "Message held",
  draft: "Draft to apply",
  review: "Needs review",
  apply: "Applying…",
  stalled: "Apply stalled",
  reply: "Your turn",
};

export function StateChip(props: {
  state: ThreadStateId;
  waitingOn: WaitingOn | null;
  onJump?: () => void;
}) {
  const { state, waitingOn, onJump } = props;
  const name = waitingOn ? waitingNames[waitingOn] : stateNames[state];
  if (onJump)
    return (
      <button
        type="button"
        class="state-chip"
        data-state={state}
        data-waiting={waitingOn ?? undefined}
        data-jump=""
        onClick={onJump}
      >
        {name}
        <span aria-hidden="true"> ↓</span>
        <span class="visually-hidden">, go to it</span>
      </button>
    );
  return (
    <span class="state-chip" data-state={state} data-waiting={waitingOn ?? undefined}>
      {name}
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

const foldedShown = 8;
export function Folded<T extends { name: string }>(props: {
  label: string;
  entries: readonly T[];
  find: string;
  children(entry: T): ComponentChildren;
}) {
  const { entries } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  if (entries.length === 0) return null;
  const words = query.trim().toLowerCase();
  const found = entries.filter((entry) => entry.name.toLowerCase().includes(words));
  const shown = found.slice(0, foldedShown);
  return (
    <div class="folded">
      <button
        type="button"
        class="quiet-action folded-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Chevron />
        {props.label}
      </button>
      {open && (
        <div class="folded-list">
          {entries.length > foldedShown && (
            <input
              class="input"
              type="search"
              value={query}
              aria-label={props.find}
              placeholder={props.find}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          )}
          <ul>
            {shown.map((entry, i) => (
              <li key={i}>{props.children(entry)}</li>
            ))}
          </ul>
          {found.length > shown.length && (
            <p class="folded-more">{found.length - shown.length} more: search to find one.</p>
          )}
          {found.length === 0 && <p class="folded-more">None matches.</p>}
        </div>
      )}
    </div>
  );
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function points(count: number, short = false): string {
  return plural(count, short ? "pt" : "point");
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = Array.from(words[0] ?? "")[0] ?? "";
  const last = words.length > 1 ? (Array.from(words.at(-1) ?? "")[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function useStamp(): (
  instant: string,
  absolute?: (instant: string) => string,
  ahead?: boolean,
) => string {
  const format = useContext(TimeFormatContext);
  return (instant, absolute, ahead) => stamp(instant, format, Date.now(), absolute, ahead);
}

export function Stamp({ at, absolute }: { at: string; absolute?: (instant: string) => string }) {
  const written = useStamp();
  return (
    <time dateTime={at} title={when(at)}>
      {written(at, absolute)}
    </time>
  );
}

export function Member({
  member,
  onRemove,
  adding,
  inRegion = false,
  moving,
  carried,
}: {
  member: MemberView;
  onRemove?: () => void;
  adding?: { to: string; onAdd(): void };
  inRegion?: boolean;
  moving?: { item: CarriedItem; menu: MenuItem[] };
  carried?: CarriedItem;
}) {
  const { ref, row } = member;
  const cells = (
    <>
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
      {inRegion && <span class="in-region">in this workstream</span>}
      {onRemove && (
        <Tooltip text={`Remove ${ref.key} from this workstream`}>
          <button
            type="button"
            class="remove-member"
            aria-label={`Remove ${ref.key}`}
            onClick={onRemove}
          >
            ×
          </button>
        </Tooltip>
      )}
      {adding && (
        <Tooltip text={`Add ${ref.key} to “${adding.to}”`}>
          <button
            type="button"
            class="add-member"
            aria-label={`Add ${ref.key}`}
            onClick={adding.onAdd}
          >
            +
          </button>
        </Tooltip>
      )}
    </>
  );
  if (moving)
    return (
      <li
        class={row ? "member" : "member gone"}
        data-item={ref.id}
        data-movable
        {...dragMove(moving.item)}
      >
        <ContextMenu label={`Move ${ref.key}`} items={moving.menu} class="member-menu">
          {cells}
        </ContextMenu>
      </li>
    );
  return (
    <li
      class={row ? "member" : "member gone"}
      data-item={ref.id}
      data-movable={carried && true}
      {...(carried ? dragMove(carried) : {})}
    >
      {cells}
    </li>
  );
}
