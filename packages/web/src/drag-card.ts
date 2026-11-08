// The card an item rides on while it's dragged (drag-item.ts), in place of
// the browser's picture of its row: its key and title, which lean a couple
// of degrees the way they're pulled and ease back to level when the pointer
// stops. Dropped, it's set down where the pointer let go; a drop nowhere
// sends it back to its row. Reduced motion: it follows level, and only
// fades (the reduced-motion block in window.css).
//
// The pointer's moves are only noted; one frame at a time moves the card,
// by its transform, and nothing here reads layout but at the start.

// How far it leans while pulled, and never past.
const leans = 3;
const most = 4;
// The pull, in pixels a second, at which it leans all the way.
const fullPull = 900;
// How quickly the pull follows the pointer, and the lean the pull: the
// seconds each takes to go most of the way. The lean is slower, so a
// stopped pointer lets it settle back rather than snap.
const pullTakes = 0.05;
const leanTakes = 0.1;

export type Lean = { tilt: number; pull: number };

export const level: Lean = { tilt: 0, pull: 0 };

const toward = (from: number, to: number, dt: number, takes: number) =>
  from + (to - from) * (1 - Math.exp(-dt / takes));

// `dt` seconds on, the pointer `dx` pixels across: positive leans right,
// clockwise, as a card held at its left edge trails a pull to the right.
export function leanStep(lean: Lean, dx: number, dt: number): Lean {
  if (dt <= 0) return lean;
  const pull = toward(lean.pull, dx / dt, dt, pullTakes);
  const wanted = Math.max(-leans, Math.min(leans, (pull / fullPull) * leans));
  const tilt = Math.max(-most, Math.min(most, toward(lean.tilt, wanted, dt, leanTakes)));
  return { tilt, pull };
}

// A picture of nothing, so the browser draws no row of its own: an empty
// element, kept out of sight, since the page's policy loads no data: image.
let blank: HTMLElement | null = null;
const nothing = () => {
  if (blank === null || !blank.isConnected) {
    blank = document.createElement("div");
    blank.className = "drag-blank";
    blank.setAttribute("aria-hidden", "true");
    document.body.append(blank);
  }
  return blank;
};

const reduced = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// The drag under way: its card, where the pointer is, and its row.
let carrying: {
  card: HTMLElement;
  row: HTMLElement;
  from: { x: number; y: number };
  at: { x: number; y: number };
  drawn: { x: number; y: number };
  lean: Lean;
  still: boolean;
  frame: number;
  last: number | null;
} | null = null;

const place = (card: HTMLElement, x: number, y: number, tilt: number, scale = 1) => {
  card.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${tilt.toFixed(2)}deg) scale(${scale})`;
};

// The pointer moved, as each dragover says: noted, for the next frame.
const moved = (event: DragEvent) => {
  if (carrying === null || (event.clientX === 0 && event.clientY === 0)) return;
  carrying.at = { x: event.clientX, y: event.clientY };
};

const frame = (now: number) => {
  const c = carrying;
  if (c === null) return;
  const dt = c.last === null ? 0 : Math.min(0.1, (now - c.last) / 1000);
  c.last = now;
  if (!c.still) c.lean = leanStep(c.lean, c.at.x - c.drawn.x, dt);
  c.drawn = c.at;
  place(c.card, c.at.x, c.at.y, c.lean.tilt);
  c.frame = requestAnimationFrame(frame);
};

// Lifts `row` onto its card, the pointer where `event` says. The browser's
// own picture of the row is set to nothing.
export function lift(event: DragEvent, row: HTMLElement, face: { key: string; title: string }) {
  if (typeof document === "undefined" || typeof requestAnimationFrame !== "function") return;
  drop("gone");
  event.dataTransfer?.setDragImage(nothing(), 0, 0);
  const card = document.createElement("div");
  card.className = "drag-card";
  card.setAttribute("popover", "manual");
  card.setAttribute("aria-hidden", "true");
  const inner = document.createElement("div");
  inner.className = "drag-card-face";
  const key = document.createElement("span");
  key.className = "key";
  key.textContent = face.key;
  inner.append(key);
  if (face.title) {
    const title = document.createElement("span");
    title.className = "drag-card-title";
    title.textContent = face.title;
    inner.append(title);
  }
  card.append(inner);
  document.body.append(card);
  const rect = row.getBoundingClientRect();
  const at = { x: event.clientX, y: event.clientY };
  // Back where it came from: the row's left edge, at the pointer's height.
  const from = { x: rect.left + (at.x - rect.left > 24 ? 16 : at.x - rect.left), y: at.y };
  place(card, at.x, at.y, 0);
  card.showPopover();
  row.setAttribute("data-lifted", "");
  document.addEventListener("dragover", moved);
  carrying = {
    card,
    row,
    from,
    at,
    drawn: at,
    lean: level,
    still: reduced(),
    frame: 0,
    last: null,
  };
  carrying.frame = requestAnimationFrame(frame);
}

// The drag ended: `dropped`, it's set down where the pointer is; `back`, it
// goes back to its row; `gone`, it just goes. The row comes back once the
// card has.
export function drop(how: "dropped" | "back" | "gone") {
  const c = carrying;
  if (c === null) return;
  carrying = null;
  cancelAnimationFrame(c.frame);
  document.removeEventListener("dragover", moved);
  const done = () => {
    c.row.removeAttribute("data-lifted");
    c.card.remove();
  };
  if (how === "gone") return done();
  if (how === "dropped") {
    c.row.removeAttribute("data-lifted");
    c.card.setAttribute("data-settle", "dropped");
    place(c.card, c.at.x, c.at.y, 0, 0.94);
    c.card.style.opacity = "0";
  } else {
    c.card.setAttribute("data-settle", "back");
    place(c.card, c.from.x, c.from.y, 0);
    c.card.style.opacity = "0";
  }
  // Gone once its settle has played; at once, with none to play.
  const playing = c.card.getAnimations().map((a) => a.finished.catch(() => undefined));
  if (playing.length === 0) done();
  else void Promise.all(playing).then(done);
}
