// A rightward swipe on a closed row is left to the browser, whose back gesture it is.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { MenuItem } from "./menu.tsx";
import { pullFor, resisted, settle, shown, type Stops } from "./swiping.ts";

const actionWidth = 76;
const wheelIdleMs = 140;
const slop = 8;
// Touches this near the screen's left edge are the system's back gesture.
const backEdge = 24;

type Gesture =
  | { kind: "wheel"; dx: number; dy: number; axis: "x" | "other" | null }
  | { kind: "touch"; id: number; x: number; y: number; from: number; axis: "x" | "other" | null };

function axisOf(dx: number, dy: number, open: boolean): "x" | "other" | null {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return null;
  return Math.abs(dx) > Math.abs(dy) && (dx > 0 || open) ? "x" : "other";
}

let closeOpen: (() => void) | null = null;

export function Swipeable(props: { actions: readonly MenuItem[]; children: ComponentChildren }) {
  const { actions } = props;
  const stops: Stops = actions.map((_, i) => (i + 1) * actionWidth);
  const root = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const at = useRef(0);
  const pulled = useRef(0);
  const gesture = useRef<Gesture | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A touch swipe may end with a click on the row, which mustn't follow its
  // link. Only that click: the flag clears once the pointerup's task ends.
  const swallowClick = useRef(false);

  const closer = useRef(() => {
    at.current = 0;
    setOffset(0);
  });
  const move = (to: number) => {
    at.current = to;
    setOffset(to);
    const close = closer.current;
    if (to > 0 && closeOpen !== close) {
      closeOpen?.();
      closeOpen = close;
    } else if (to === 0 && closeOpen === close) closeOpen = null;
  };
  // Focus goes back to the row, not to a button that has just hidden.
  const closeToRow = () => {
    move(0);
    root.current?.querySelector<HTMLElement>(".swipe-row a, .swipe-row button")?.focus();
  };
  const start = () => {
    pulled.current = pullFor(at.current, stops);
    setDragging(true);
  };
  const pull = (by: number) => {
    pulled.current = Math.max(0, by);
    move(resisted(pulled.current, stops));
  };
  const end = () => {
    if (gesture.current?.axis === "x") move(settle(at.current, stops));
    gesture.current = null;
    setDragging(false);
  };

  const open = offset > 0 && !dragging;
  useEffect(() => {
    if (!open) return;
    const pressed = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) move(0);
    };
    addEventListener("pointerdown", pressed, true);
    return () => removeEventListener("pointerdown", pressed, true);
  }, [open]);
  useEffect(
    () => () => {
      clearTimeout(idle.current ?? undefined);
      if (closeOpen === closer.current) closeOpen = null;
    },
    [],
  );

  const revealed = shown(offset, stops);
  return (
    <div
      ref={root}
      class="swipe"
      data-dragging={dragging || undefined}
      data-open={offset > 0 || undefined}
      onWheel={(event) => {
        const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
        // Fingers moving left give a positive delta.
        const dx = event.deltaX * lines;
        const dy = event.deltaY * lines;
        clearTimeout(idle.current ?? undefined);
        idle.current = setTimeout(end, wheelIdleMs);
        let current = gesture.current;
        if (current?.kind !== "wheel") {
          current = { kind: "wheel", dx: 0, dy: 0, axis: null };
          gesture.current = current;
        }
        if (current.axis === null) {
          current.dx += dx;
          current.dy += dy;
          current.axis = axisOf(current.dx, current.dy, at.current > 0);
          if (current.axis !== "x") return;
          start();
          event.preventDefault();
          pull(pulled.current + current.dx);
          return;
        }
        if (current.axis !== "x") return;
        event.preventDefault();
        pull(pulled.current + dx);
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" || event.clientX < backEdge) return;
        if (gesture.current?.kind === "touch") return;
        gesture.current = {
          kind: "touch",
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          from: pullFor(at.current, stops),
          axis: null,
        };
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (current?.kind !== "touch" || current.id !== event.pointerId) return;
        const dx = current.x - event.clientX;
        const dy = current.y - event.clientY;
        if (current.axis === null) {
          current.axis = axisOf(dx, dy, at.current > 0);
          if (current.axis !== "x") return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }
        if (current.axis !== "x") return;
        pull(current.from + dx);
      }}
      onPointerUp={(event) => {
        const current = gesture.current;
        if (current?.kind !== "touch" || current.id !== event.pointerId) return;
        if (current.axis === "x") {
          swallowClick.current = true;
          setTimeout(() => {
            swallowClick.current = false;
          });
        }
        end();
      }}
      onPointerCancel={(event) => {
        const current = gesture.current;
        if (current?.kind === "touch" && current.id === event.pointerId) end();
      }}
      onClickCapture={(event) => {
        const onAction =
          event.target instanceof Element && event.target.closest(".swipe-actions") !== null;
        if (onAction) return;
        if (swallowClick.current) {
          swallowClick.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (at.current === 0) return;
        event.preventDefault();
        event.stopPropagation();
        move(0);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || at.current === 0) return;
        event.stopPropagation();
        closeToRow();
      }}
    >
      <div class="swipe-actions" style={{ width: `${offset}px` }} aria-hidden={revealed === 0}>
        {actions.map((action, i) => (
          <button
            key={action.label}
            type="button"
            class="swipe-action"
            data-danger={action.danger || undefined}
            style={{ width: `${actionWidth}px` }}
            tabIndex={i < revealed ? 0 : -1}
            onClick={() => {
              closeToRow();
              action.onSelect();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        class="swipe-row"
        style={offset === 0 ? undefined : { transform: `translateX(${-offset}px)` }}
      >
        {props.children}
      </div>
    </div>
  );
}
