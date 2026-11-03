// A tooltip on the control it wraps, in Oriel's look. It shows a moment
// after the pointer rests on the control, and at once when the keyboard
// focuses it; it goes when either leaves, on a click, on a scroll, or on
// Escape. Touch shows nothing, so what it says that matters is in the
// control's name or on the page already. It describes the control to a
// screen reader, unless it only repeats the control's name: then it is
// hidden from one, so the name is heard once. It is a popover, in the top
// layer, so no scroll or slide clips it, and the pointer passes through it.
import type { VNode } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";
import { placeTooltip, repeatsName } from "./tooltips.ts";

// How long the pointer rests before it shows, in milliseconds.
const delay = 400;

export function Tooltip(props: { text: string; children: VNode }) {
  const tip = useRef<HTMLSpanElement>(null);
  const id = useId();
  // The control its listeners are on, and how to take them off.
  const wired = useRef<{ control: HTMLElement; unwire(): void } | null>(null);

  // The control is what it wraps: the element just before it.
  useLayoutEffect(() => {
    const element = tip.current;
    const control = element?.previousElementSibling;
    if (!element || !(control instanceof HTMLElement)) return;
    const repeats = repeatsName(
      props.text,
      control.getAttribute("aria-label") ?? control.textContent,
    );
    if (repeats) {
      element.setAttribute("aria-hidden", "true");
      if (control.getAttribute("aria-describedby") === id)
        control.removeAttribute("aria-describedby");
    } else {
      element.removeAttribute("aria-hidden");
      control.setAttribute("aria-describedby", id);
    }
    if (wired.current?.control === control) return;
    wired.current?.unwire();
    wired.current = { control, unwire: wire(control, element) };
  });
  useLayoutEffect(() => () => wired.current?.unwire(), []);

  return (
    <>
      {props.children}
      <span ref={tip} id={id} role="tooltip" popover="manual" class="tooltip">
        {props.text}
      </span>
    </>
  );
}

function wire(control: HTMLElement, tip: HTMLElement): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Escape or a scroll dismisses it, shown or on its way.
  const arm = () => {
    document.addEventListener("keydown", escaped, true);
    addEventListener("scroll", hide, { capture: true, passive: true });
  };
  const show = () => {
    clearTimeout(timer);
    if (!control.isConnected) return;
    if (!tip.matches(":popover-open")) tip.showPopover();
    // Measured at the window's corner, where nothing narrows it.
    tip.style.top = "0px";
    tip.style.left = "0px";
    const at = placeTooltip(control.getBoundingClientRect(), tip.getBoundingClientRect(), {
      width: document.documentElement.clientWidth,
      height: innerHeight,
    });
    tip.style.top = `${at.top}px`;
    tip.style.left = `${at.left}px`;
    tip.dataset["side"] = at.side;
    arm();
  };
  const hide = () => {
    clearTimeout(timer);
    document.removeEventListener("keydown", escaped, true);
    removeEventListener("scroll", hide, { capture: true });
    if (tip.matches(":popover-open")) tip.hidePopover();
  };
  // Escape dismisses it and does whatever else it does, such as closing
  // the panel.
  const escaped = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };
  const entered = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    clearTimeout(timer);
    timer = setTimeout(show, delay);
    arm();
  };
  // A click focuses the control too, but that focus doesn't show it.
  const focused = () => {
    if (control.matches(":focus-visible")) show();
  };
  const on: [string, EventListener][] = [
    ["pointerenter", entered as EventListener],
    ["pointerleave", hide],
    ["pointerdown", hide],
    ["focus", focused],
    ["blur", hide],
  ];
  for (const [type, listener] of on) control.addEventListener(type, listener);
  return () => {
    hide();
    for (const [type, listener] of on) control.removeEventListener(type, listener);
  };
}
