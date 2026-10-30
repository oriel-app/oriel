// Small pieces every page uses. Source text is always rendered as text;
// nothing here sets HTML.
import type { ComponentChildren } from "preact";
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
