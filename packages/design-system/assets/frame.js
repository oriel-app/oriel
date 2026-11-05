// A specimen's frame: it follows the chrome's view without reloading, says
// how tall it is, opens what a specimen shows open, and runs the few small
// behaviours a specimen needs to be tried by keyboard. Nothing in a specimen
// navigates or submits.

const root = document.documentElement;

addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.data?.type !== "ws-view") return;
  const { theme, scheme, size } = event.data;
  root.dataset.theme = theme;
  if (size === "default") delete root.dataset.textSize;
  else root.dataset.textSize = size;
  const q = scheme === "system" ? "" : `?scheme=${scheme}`;
  for (const id of ["ws-window", "ws-states", "ws-proposals", "ws-proposed-states"]) {
    const link = document.getElementById(id);
    const base = link.getAttribute("href").split("?")[0];
    if (link.getAttribute("href") !== base + q) link.setAttribute("href", base + q);
  }
});

const report = () =>
  parent.postMessage(
    { type: "ws-height", height: document.documentElement.scrollHeight },
    location.origin,
  );
new ResizeObserver(report).observe(document.body);
addEventListener("load", report);

document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[href]");
  if (link && !link.hasAttribute("data-ws-follow")) event.preventDefault();
});
document.addEventListener("submit", (event) => event.preventDefault());

// What a specimen shows open: a menu or a tooltip, in the top layer.
for (const el of document.querySelectorAll("[data-ws-open]")) {
  try {
    el.showPopover?.();
  } catch {
    // Already open.
  }
}

// A menu, as menu.tsx runs it: the arrow keys move between items, Home and
// End jump to the ends, Escape or Tab closes it and gives focus back.
for (const opener of document.querySelectorAll("[data-ws-menu]")) {
  const menu = document.getElementById(opener.dataset.wsMenu);
  if (!menu) continue;
  const items = () => [...menu.querySelectorAll("[role=menuitem]")];
  const open = () => {
    if (!menu.matches(":popover-open")) menu.showPopover();
    const r = opener.getBoundingClientRect();
    if (!menu.hasAttribute("data-ws-anchored")) {
      menu.style.left = `${r.left}px`;
      menu.style.top = `${r.bottom + 4}px`;
    }
    items()[0]?.focus();
  };
  const close = () => {
    if (menu.matches(":popover-open")) menu.hidePopover();
    opener.focus();
  };
  opener.addEventListener("click", () => open());
  // A right-click opens it at the pointer, kept 4px inside the frame, as
  // menu.tsx does; anchor positioning can't anchor to a point, so this
  // stays JS (see /lab/popover).
  opener.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    open();
    if (menu.hasAttribute("data-ws-anchored") || (e.clientX === 0 && e.clientY === 0)) return;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(e.clientX, innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(e.clientY, innerHeight - height - 4))}px`;
  });
  opener.addEventListener("keydown", (e) => {
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      open();
    }
  });
  menu.addEventListener("keydown", (e) => {
    const all = items();
    const now = all.indexOf(document.activeElement);
    const go = { ArrowDown: now + 1, ArrowUp: now - 1, Home: 0, End: all.length - 1 }[e.key];
    if (go !== undefined) all[(go + all.length) % all.length]?.focus();
    else if (e.key === "Escape" || e.key === "Tab") close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  menu.addEventListener("click", (e) => {
    if (e.target.closest("[role=menuitem]")) close();
  });
}

// A tooltip, as tooltip.tsx runs it: a moment after the pointer rests, at
// once on keyboard focus, gone on leave, click, scroll or Escape. It's
// placed as tooltips.ts places it: centred above its control, 6px off,
// below when there's no room above, kept 8px inside the frame.
const placeTip = (tip, control) => {
  const r = control.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const above = r.top - 6 - t.height >= 8;
  const left = r.left + r.width / 2 - t.width / 2;
  tip.style.left = `${Math.max(8, Math.min(left, innerWidth - t.width - 8))}px`;
  tip.style.top = `${above ? r.top - 6 - t.height : r.bottom + 6}px`;
  tip.dataset.side = above ? "above" : "below";
};
// One shown open (data-ws-open) is placed the same way, unless the
// specimen places it itself.
for (const tip of document.querySelectorAll(
  ".tooltip[popover][data-ws-open]:not([data-ws-anchored])",
)) {
  const control = tip.previousElementSibling;
  if (control instanceof HTMLElement && !tip.style.top) placeTip(tip, control);
}
// A tooltip that CSS places (data-ws-anchored) is left to /lab/popover's
// behaviour below.
for (const tip of document.querySelectorAll(
  ".tooltip[popover]:not([data-ws-open]):not([data-ws-anchored])",
)) {
  const control = tip.previousElementSibling;
  if (!(control instanceof HTMLElement)) continue;
  let timer;
  const show = () => {
    clearTimeout(timer);
    if (!tip.matches(":popover-open")) tip.showPopover();
    placeTip(tip, control);
  };
  const hide = () => {
    clearTimeout(timer);
    if (tip.matches(":popover-open")) tip.hidePopover();
  };
  control.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    timer = setTimeout(show, 400);
  });
  control.addEventListener("pointerleave", hide);
  control.addEventListener("pointerdown", hide);
  control.addEventListener("focus", () => control.matches(":focus-visible") && show());
  control.addEventListener("blur", hide);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide());
}

// A switch flips. A checkbox drawn as a switch flips itself, so only a
// button's aria-checked is set here. A locked switch (aria-disabled, which
// keeps it in the tab order so its reason can be read) doesn't flip: its
// click is cancelled, as the app's handler would.
for (const sw of document.querySelectorAll('[role="switch"]:not([disabled])'))
  sw.addEventListener("click", (e) => {
    if (sw.getAttribute("aria-disabled") === "true") e.preventDefault();
    else if (!(sw instanceof HTMLInputElement))
      sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true"));
  });

// A checkbox shown part-picked: `indeterminate` is a property, with no
// attribute, so data-ws-indeterminate sets it. A click clears it, as the
// browser does.
for (const box of document.querySelectorAll("input[data-ws-indeterminate]"))
  box.indeterminate = true;

// /lab/popover: a menu opened by its invoker (popovertarget, or command and
// commandfor) and placed by CSS anchor positioning, so nothing here sets
// left or top unless the engine lacks anchor positioning. What JS still
// does is what menu.tsx does by keyboard: focus the first item on open (the
// last, if ArrowUp opened it), move with the arrows, Home and End, close on
// Tab or on a choice. Escape and a click outside close it natively, and
// focus goes back to the invoker.
const anchors = CSS.supports("anchor-name: --a");
// Its invoker: the button that names it, or else the element before it.
const invokerOf = (el) =>
  document.querySelector(
    `[popovertarget="${el.id}"], [commandfor="${el.id}"], [interestfor="${el.id}"]`,
  ) ?? el.previousElementSibling;
// Where the engine has no anchor positioning, JS places it as the app does
// today: a tooltip as above, a menu under its invoker (above it, with no
// room below), kept inside the frame.
const place = (el) => {
  const by = invokerOf(el);
  if (anchors || !(by instanceof HTMLElement)) return;
  if (el.matches(".tooltip")) return placeTip(el, by);
  const r = by.getBoundingClientRect();
  const m = el.getBoundingClientRect();
  const below = r.bottom + 4 + m.height <= innerHeight - 4;
  el.style.left = `${Math.max(4, Math.min(r.left, innerWidth - m.width - 4))}px`;
  el.style.top = `${below ? r.bottom + 4 : r.top - 4 - m.height}px`;
};
for (const el of document.querySelectorAll("[data-ws-open][data-ws-anchored]")) place(el);
for (const menu of document.querySelectorAll("[role=menu][popover][data-ws-anchored]")) {
  const invoker = document.querySelector(`[popovertarget="${menu.id}"], [commandfor="${menu.id}"]`);
  if (!invoker || invoker.hasAttribute("data-ws-menu") || menu.hasAttribute("data-ws-open"))
    continue;
  const items = () => [...menu.querySelectorAll("[role=menuitem]:not([disabled])")];
  let from = "first";
  invoker.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    from = e.key === "ArrowUp" ? "last" : "first";
    if (!menu.matches(":popover-open")) menu.showPopover({ source: invoker });
  });
  menu.addEventListener("toggle", (e) => {
    if (e.newState !== "open") return;
    place(menu);
    const all = items();
    (from === "last" ? all.at(-1) : all[0])?.focus();
    from = "first";
  });
  menu.addEventListener("keydown", (e) => {
    const all = items();
    const now = all.indexOf(document.activeElement);
    const go = { ArrowDown: now + 1, ArrowUp: now - 1, Home: 0, End: all.length - 1 }[e.key];
    if (go !== undefined) all[(go + all.length) % all.length]?.focus();
    else if (e.key === "Tab") {
      menu.hidePopover();
      invoker.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  menu.addEventListener("click", (e) => {
    if (!e.target.closest("[role=menuitem]")) return;
    menu.hidePopover();
    invoker.focus();
  });
}

// /lab/popover: a tooltip that `interestfor` opens on hover and focus, and
// CSS places. Chromium opens it itself. Where the engine has no interest
// invokers (Safari, Firefox today), this wires it as tooltip.tsx does, so
// the specimen shows the fallback the app would keep.
const interest = "interestForElement" in HTMLButtonElement.prototype;
for (const tip of document.querySelectorAll(".tooltip[popover][data-ws-anchored]")) {
  if (tip.hasAttribute("data-ws-open")) continue;
  const control = document.querySelector(`[interestfor="${tip.id}"]`);
  if (!control || interest) continue;
  let timer;
  const show = () => {
    clearTimeout(timer);
    if (!tip.matches(":popover-open")) tip.showPopover();
    place(tip);
  };
  const hide = () => {
    clearTimeout(timer);
    if (tip.matches(":popover-open")) tip.hidePopover();
  };
  control.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "touch") timer = setTimeout(show, 400);
  });
  control.addEventListener("pointerleave", hide);
  control.addEventListener("focus", () => control.matches(":focus-visible") && show());
  control.addEventListener("blur", hide);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide());
}
