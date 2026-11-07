// The bead's shape and motion (decision 0056, amended): the frame's own
// material growing out of the band along the page column's top. It drops as
// a small bead, spreads to its note's width, its words come in once it has
// spread, and leaving, its words go first, it narrows back to the bead, and
// the band takes it back. Springs, not timed curves: height leads with a
// little overshoot, width follows, softer. At rest nothing moves but the
// swell under the pointer, and no frame runs.
//
// Pure: the geometry and the time step come in, and nothing here reads
// layout or the clock (undo-stack.tsx measures and draws).

export type Spring = {
  value: number;
  velocity: number;
  target: number;
  stiffness: number;
  damping: number;
};

const spring = (value: number, stiffness: number, damping: number): Spring => ({
  value,
  velocity: 0,
  target: value,
  stiffness,
  damping,
});

// One step of `dt` seconds toward its target.
export function stepSpring(s: Spring, dt: number): Spring {
  const force = s.stiffness * (s.target - s.value) - s.damping * s.velocity;
  const velocity = s.velocity + force * dt;
  return { ...s, velocity, value: s.value + velocity * dt };
}

export const springSettled = (s: Spring): boolean =>
  Math.abs(s.target - s.value) < 0.05 && Math.abs(s.velocity) < 0.05;

// Springs step in whole ticks, whatever the frame rate, so a second of
// frames at 60 a second lands where a second at 144 does.
export const tick = 1 / 240;
// A longer frame, as after a hidden tab, counts as this long.
const longestFrame = 0.1;

// The frame's and the bead's measures, in pixels, from window.css.
export type Measures = {
  // The bead it drops as, before it spreads.
  seed: number;
  // How far each neck reaches along the band once it has spread.
  neck: number;
  // The column's top corners, which the necks never reach.
  corner: number;
  // What it keeps clear of the corners, beyond its necks.
  gap: number;
  // Its lower corners.
  radius: number;
  // How much taller it grows under the pointer.
  swell: number;
};

// The widest it may be in a column `column` wide: the column less, on each
// side, the corner, a neck and the gap.
export const room = (column: number, m: Measures): number =>
  Math.max(m.seed, column - 2 * (m.corner + m.neck + m.gap));

// How wide a face `natural` wide shows, and whether its sentence is cut
// short to fit, ending in an ellipsis.
export function fit(natural: number, column: number, m: Measures) {
  const most = room(column, m);
  return { width: Math.max(m.seed, Math.min(natural, most)), clamped: natural > most };
}

// A quarter circle as one cubic.
const k = 0.5523;
const n = (x: number) => Math.round(x * 100) / 100;

// The bead's outline below the band, `w` by `h`, centred at `cx` in a
// column `column` wide, the band's lower edge at y = 0. Its necks flare wide
// and shallow while it gathers, and tighten as it spreads to `wanted`, like
// surface tension letting go; never past the corner. It reaches a little up
// into the band, so no seam shows. Near no height, it's nothing: flat.
export function beadPath(
  shape: { width: number; height: number; wanted: number },
  column: number,
  m: Measures,
): string {
  const h = shape.height;
  if (h < 0.15) return "";
  const cx = column / 2;
  const hw = Math.min(Math.max(0, shape.width / 2), cx - m.corner);
  if (hw <= 0) return "";
  const spread = clamp01((shape.width - m.seed) / Math.max(1, shape.wanted - m.seed));
  const flare = m.neck + 16 * (1 - spread) * Math.min(1, h / 18);
  const neckX = Math.max(0, Math.min(flare, cx - m.corner - hw));
  const neckY = Math.min(m.neck, h * 0.42);
  const r = Math.max(0, Math.min(m.radius, hw, h - neckY));
  const l = cx - hw;
  const rr = cx + hw;
  const b = h;
  const lift = 2;
  return [
    `M${n(l - neckX)},${-lift}V0`,
    `C${n(l - neckX + k * neckX)},0 ${n(l)},${n(neckY - k * neckY)} ${n(l)},${n(neckY)}`,
    `V${n(b - r)}`,
    `C${n(l)},${n(b - r + k * r)} ${n(l + r - k * r)},${n(b)} ${n(l + r)},${n(b)}`,
    `H${n(rr - r)}`,
    `C${n(rr - r + k * r)},${n(b)} ${n(rr)},${n(b - r + k * r)} ${n(rr)},${n(b - r)}`,
    `V${n(neckY)}`,
    `C${n(rr)},${n(neckY - k * neckY)} ${n(rr + neckX - k * neckX)},0 ${n(rr + neckX)},0`,
    `V${-lift}Z`,
  ].join("");
}

// One of the lips beneath it while it holds more notes (`depth` 1 or 2):
// the material's edge, narrower and a little lower each.
export function lipPath(
  shape: { width: number; height: number },
  column: number,
  m: Measures,
  depth: 1 | 2,
): string {
  const inset = 10 * depth;
  const hw = Math.min(shape.width / 2, column / 2 - m.corner) - inset;
  const r = Math.max(0, Math.min(m.radius, hw));
  if (shape.height < 2 * r || hw <= r) return "";
  const cx = column / 2;
  const l = cx - hw;
  const rr = cx + hw;
  const b = shape.height + 4 * depth;
  const top = shape.height - r - 4;
  return [
    `M${n(l)},${n(top)}V${n(b - r)}`,
    `C${n(l)},${n(b - r + k * r)} ${n(l + r - k * r)},${n(b)} ${n(l + r)},${n(b)}`,
    `H${n(rr - r)}`,
    `C${n(rr - r + k * r)},${n(b)} ${n(rr)},${n(b - r + k * r)} ${n(rr)},${n(b - r)}`,
    `V${n(top)}Z`,
  ].join("");
}

// Where its words are shown from, as the shape reveals them: the rested
// box, `wanted` by `rested`, cut to the shape now, from the top and both
// sides. The words never move with the shape; only this does.
export function wordsClip(
  shape: { width: number; height: number },
  wanted: number,
  rested: number,
  radius: number,
): string {
  const side = n(Math.max(0, (wanted - shape.width) / 2));
  const below = n(Math.max(0, rested - shape.height));
  const r = n(Math.max(0, Math.min(radius, shape.width / 2, shape.height)));
  return `inset(0 ${side}px ${below}px ${side}px round 0 0 ${r}px ${r}px)`;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// --- Motion ---------------------------------------------------------------

// Hidden: nothing below the band. Dropping: the bead grows down, then
// spreads, its words to come. Shown: its words in. Changing: a new note while
// one shows, its words going; then swapping, waiting for the new ones to be
// laid out, when the shape reflows to them. Leaving: words, then width,
// then height.
export type Phase = "hidden" | "dropping" | "shown" | "changing" | "swapping" | "leaving";

export type Motion = {
  phase: Phase;
  // Seconds since the phase began.
  at: number;
  height: Spring;
  width: Spring;
  words: Spring;
  // Time not yet stepped: under one tick.
  carry: number;
  // Reduced motion: no drop or spread. It shows at its size, its words swap
  // at once, and it only fades, in and out; `words` is how far.
  reduced: boolean;
};

// What it grows to: its face's width, clamped to the room, and height; and
// whether the pointer is on it.
export type Aim = { width: number; height: number; hovered: boolean };

// When it spreads, once dropping; and when, leaving, it narrows and the band
// takes it back.
const spreadsAt = 0.11;
const narrowsAt = 0.09;
const goesAt = 0.23;

export const still = (seed: number): Motion => ({
  phase: "hidden",
  at: 0,
  height: spring(0, 260, 19),
  width: spring(seed, 150, 17),
  words: spring(0, 220, 26),
  carry: 0,
  reduced: false,
});

const enter = (m: Motion, phase: Phase): Motion => ({ ...m, phase, at: 0 });

// A note shows with none showing, or as the last one leaves.
export function arrive(m: Motion, seed: number, reduced: boolean): Motion {
  if (m.phase !== "hidden" && m.phase !== "leaving") return m;
  if (reduced) {
    // At its size from its first step, fading in: not at rest until it has.
    const from = still(seed);
    return { ...enter(from, "shown"), words: { ...from.words, target: 1 }, reduced };
  }
  if (m.phase === "hidden") return enter(still(seed), "dropping");
  return { ...enter(m, "dropping"), reduced };
}

// Another note while one shows: its words go, the shape reflows, and the
// new ones come. Reduced motion swaps them at once.
export function change(m: Motion): Motion {
  if (m.phase !== "shown" && m.phase !== "dropping") return m;
  return enter(m, m.reduced ? "swapping" : "changing");
}

// The new words are laid out: the shape goes to them, and they come in.
export const swapped = (m: Motion): Motion =>
  m.phase === "swapping" ? enter(m, m.reduced ? "shown" : "dropping") : m;

// The last note goes.
export function leave(m: Motion): Motion {
  if (m.phase === "hidden" || m.phase === "leaving") return m;
  return enter(m, "leaving");
}

// `dt` seconds on, toward `aim`, in whole ticks.
export function advance(
  m: Motion,
  dt: number,
  aim: Aim,
  sizes: Pick<Measures, "seed" | "swell">,
): Motion {
  let next = { ...m, carry: m.carry + Math.min(Math.max(0, dt), longestFrame) };
  const steps = Math.floor(next.carry / tick + 1e-6);
  for (let i = 0; i < steps; i += 1) next = once(next, aim, sizes);
  return { ...next, carry: Math.max(0, next.carry - steps * tick) };
}

// Where each spring is headed in phase, `at` seconds in, toward `aim`.
function targets(m: Motion, at: number, aim: Aim, sizes: Pick<Measures, "seed" | "swell">) {
  const { seed } = sizes;
  let height = m.height.target;
  let width = m.width.target;
  let words = m.words.target;
  switch (m.phase) {
    case "hidden":
      [height, width, words] = [0, seed, 0];
      break;
    case "dropping":
      height = aim.height;
      width = at >= spreadsAt ? aim.width : seed;
      words = 0;
      break;
    case "shown":
    case "changing":
    case "swapping":
      height = aim.height;
      width = aim.width;
      words = m.phase === "shown" || m.reduced ? 1 : 0;
      break;
    case "leaving":
      words = 0;
      if (!m.reduced) {
        if (at >= narrowsAt) width = seed;
        if (at >= goesAt) height = 0;
      }
      break;
  }
  // Under the pointer it swells, a little taller; never as it goes.
  if (aim.hovered && m.phase !== "leaving" && m.phase !== "hidden") height += sizes.swell;
  return { height, width, words };
}

// Aimed anew, as when the pointer comes, the column resizes or the face
// opens as a list: a bead at rest isn't, until it gets there.
export function retarget(m: Motion, aim: Aim, sizes: Pick<Measures, "seed" | "swell">): Motion {
  const to = targets(m, m.at, aim, sizes);
  return {
    ...m,
    height: { ...m.height, target: to.height },
    width: { ...m.width, target: to.width },
    words: { ...m.words, target: to.words },
  };
}

function once(m: Motion, aim: Aim, sizes: Pick<Measures, "seed" | "swell">): Motion {
  const at = m.at + tick;
  const to = targets(m, at, aim, sizes);
  const { seed } = sizes;
  let next: Motion = {
    ...m,
    at,
    height: stepSpring({ ...m.height, target: to.height }, tick),
    width: stepSpring({ ...m.width, target: to.width }, tick),
    words: stepSpring({ ...m.words, target: to.words }, tick),
  };
  if (m.reduced) next = { ...next, height: snap(next.height), width: snap(next.width) };
  if (
    m.phase === "dropping" &&
    at >= spreadsAt &&
    next.width.value > aim.width * 0.82 &&
    next.height.value > aim.height * 0.8
  )
    return enter(next, "shown");
  if (m.phase === "changing" && next.words.value < 0.08) return enter(next, "swapping");
  if (m.phase === "leaving") {
    const gone = m.reduced
      ? next.words.value < 0.02
      : at >= goesAt && next.height.value < 0.2 && Math.abs(next.height.velocity) < 2;
    if (gone) return { ...still(seed), carry: next.carry };
  }
  return next;
}

const snap = (s: Spring): Spring => ({ ...s, value: s.target, velocity: 0 });

// Whether nothing moves: hidden, or shown and settled. A frame runs only
// while this is false.
export function resting(m: Motion): boolean {
  if (m.phase === "hidden") return true;
  return (
    m.phase === "shown" &&
    springSettled(m.height) &&
    springSettled(m.width) &&
    springSettled(m.words)
  );
}

// Settled, it sits exactly on its targets, so nothing drifts.
export const settle = (m: Motion): Motion =>
  resting(m) ? { ...m, height: snap(m.height), width: snap(m.width), words: snap(m.words) } : m;

// --- Frames ---------------------------------------------------------------

// The browser's animation frames, or a test's.
export type Frames = {
  request(run: (now: number) => void): number;
  cancel(id: number): void;
};

// Runs `step` once a frame, with the seconds since the last, only while
// `moving()` says something does. `kick` after anything that may start it
// moving; at rest it requests nothing.
export function frameDriver(frames: Frames, run: { moving(): boolean; step(dt: number): void }) {
  let id = 0;
  let last: number | null = null;
  const frame = (now: number) => {
    id = 0;
    const dt = last === null ? 0 : (now - last) / 1000;
    last = now;
    run.step(dt);
    if (run.moving()) id = frames.request(frame);
    else last = null;
  };
  return {
    kick() {
      if (id === 0 && run.moving()) id = frames.request(frame);
    },
    stop() {
      if (id !== 0) frames.cancel(id);
      id = 0;
      last = null;
    },
    get running() {
      return id !== 0;
    },
  };
}
