// A context menu on whatever it wraps. A right-click opens it at the
// pointer; with focus inside, the Menu key or Shift+F10 opens it under the
// focused element. Focus moves to its first item. The arrow keys move
// between items, Home and End jump to the ends, Escape or Tab closes it and
// gives focus back, and choosing an item closes it, then does what the item
// does. It is a popover, in the top layer, so neither the sidebar's scroll
// nor the drawer's slide clips or moves it. It grows in from where it
// opened and fades out, quicker than it came (window.css).
import type { ComponentChildren, Ref } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export type MenuItem = { label: string; onSelect(): void; danger?: boolean };

// Kept clear of the viewport's edges, in pixels.
const edge = 4;

export function ContextMenu(props: {
  // What the menu is for, for screen readers: "Thread actions".
  label: string;
  items: readonly MenuItem[];
  class?: string;
  children: ComponentChildren;
}) {
  // Where it opens, in viewport pixels, while it's open.
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // What had focus when it opened, which gets it back on a keyboard close.
  const opener = useRef<HTMLElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);

  const open = (x: number, y: number, from: EventTarget | null) => {
    if (props.items.length === 0) return;
    opener.current =
      from instanceof HTMLElement
        ? (from.closest<HTMLElement>("a, button, [tabindex]") ?? from)
        : null;
    setAt({ x, y });
  };

  return (
    <div
      class={props.class}
      onContextMenu={(event) => {
        if (props.items.length === 0) return;
        event.preventDefault();
        if (event.target instanceof Node && menu.current?.contains(event.target)) return;
        // A contextmenu from a keyboard has no pointer to open at.
        if (event.clientX === 0 && event.clientY === 0) {
          const target = event.target instanceof HTMLElement ? event.target : null;
          const rect = target?.getBoundingClientRect();
          open(rect?.left ?? 0, rect?.bottom ?? 0, target);
        } else open(event.clientX, event.clientY, event.target);
      }}
      onKeyDown={(event) => {
        const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
        if (!menuKey || !(event.target instanceof HTMLElement)) return;
        if (menu.current?.contains(event.target)) return;
        event.preventDefault();
        const rect = event.target.getBoundingClientRect();
        open(rect.left, rect.bottom, event.target);
      }}
    >
      {props.children}
      <Menu
        menuRef={menu}
        label={props.label}
        items={props.items}
        at={at}
        onClose={(refocus) => {
          setAt(null);
          if (refocus && opener.current?.isConnected) opener.current.focus();
        }}
      />
    </div>
  );
}

// The menu itself, open at `at` while that isn't null, as a context menu
// opens it or as a drop opens one where the pointer let go. `onClose`: it
// closed, by a choice, Escape or Tab (`refocus`), or a click outside it.
export function Menu(props: {
  label: string;
  items: readonly MenuItem[];
  at: { x: number; y: number } | null;
  onClose(refocus: boolean): void;
  menuRef?: Ref<HTMLDivElement>;
}) {
  const own = useRef<HTMLDivElement>(null);
  const { at } = props;
  const setRef = (element: HTMLDivElement | null) => {
    own.current = element;
    const { menuRef } = props;
    if (typeof menuRef === "function") menuRef(element);
    else if (menuRef) menuRef.current = element;
  };
  const close = (refocus: boolean) => {
    if (own.current?.matches(":popover-open")) own.current.hidePopover();
    props.onClose(refocus);
  };

  // What it showed last, kept while it fades out after it closes.
  const shown = useRef<readonly MenuItem[]>([]);
  if (at !== null) shown.current = props.items;

  // Shown, kept on screen, and focused before paint. It grows from where it
  // opened, the pointer or the control, wherever the edges put it.
  useLayoutEffect(() => {
    const element = own.current;
    if (!element || at === null) return;
    if (!element.matches(":popover-open")) element.showPopover();
    // Its laid-out size, not the transformed one it grows from.
    const { offsetWidth: width, offsetHeight: height } = element;
    const left = Math.max(edge, Math.min(at.x, innerWidth - width - edge));
    const top = Math.max(edge, Math.min(at.y, innerHeight - height - edge));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.transformOrigin = `${at.x - left}px ${at.y - top}px`;
    element.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [at]);

  const items = () => [...(own.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  const step = (by: number | "first" | "last") => {
    const all = items();
    const now = all.indexOf(document.activeElement as HTMLElement);
    // With none focused, down goes to the first and up to the last.
    const next =
      by === "first" || (by === 1 && now === -1)
        ? 0
        : by === "last" || now === -1
          ? all.length - 1
          : (now + by + all.length) % all.length;
    all[next]?.focus();
  };

  return (
    <div
      ref={setRef}
      popover="auto"
      role="menu"
      aria-label={props.label}
      class="context-menu"
      // Closed by a click outside it, too.
      onToggle={(event) => {
        if (event.newState === "closed" && at !== null) props.onClose(false);
      }}
      onKeyDown={(event) => {
        switch (event.key) {
          case "ArrowDown":
            step(1);
            break;
          case "ArrowUp":
            step(-1);
            break;
          case "Home":
            step("first");
            break;
          case "End":
            step("last");
            break;
          // Closing the menu, and nothing else, such as the drawer.
          case "Escape":
          case "Tab":
            close(true);
            break;
          default:
            return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {shown.current.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          class="context-menu-item"
          data-danger={item.danger || undefined}
          onClick={() => {
            close(true);
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
