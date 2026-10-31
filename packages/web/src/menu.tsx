// A context menu on whatever it wraps. A right-click opens it at the
// pointer; with focus inside, the Menu key or Shift+F10 opens it under the
// focused element. Focus moves to its first item. The arrow keys move
// between items, Home and End jump to the ends, Escape or Tab closes it and
// gives focus back, and choosing an item closes it, then does what the item
// does. It is a popover, in the top layer, so neither the sidebar's scroll
// nor the drawer's slide clips or moves it.
import type { ComponentChildren } from "preact";
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
  const menu = useRef<HTMLDivElement>(null);
  // Where it opens, in viewport pixels, while it's open.
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // What had focus when it opened, which gets it back on a keyboard close.
  const opener = useRef<HTMLElement | null>(null);

  const open = (x: number, y: number, from: EventTarget | null) => {
    if (props.items.length === 0) return;
    opener.current =
      from instanceof HTMLElement
        ? (from.closest<HTMLElement>("a, button, [tabindex]") ?? from)
        : null;
    setAt({ x, y });
  };
  const close = (refocus: boolean) => {
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
    setAt(null);
    if (refocus && opener.current?.isConnected) opener.current.focus();
  };

  // Shown, kept on screen, and focused before paint.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element || at === null) return;
    if (!element.matches(":popover-open")) element.showPopover();
    const { width, height } = element.getBoundingClientRect();
    element.style.left = `${Math.max(edge, Math.min(at.x, innerWidth - width - edge))}px`;
    element.style.top = `${Math.max(edge, Math.min(at.y, innerHeight - height - edge))}px`;
    element.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [at]);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
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
      <div
        ref={menu}
        popover="auto"
        role="menu"
        aria-label={props.label}
        class="context-menu"
        // Closed by a click outside it, too.
        onToggle={(event) => {
          if (event.newState === "closed") setAt(null);
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
        {at !== null &&
          props.items.map((item) => (
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
    </div>
  );
}
