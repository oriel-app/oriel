// The bead's shape and motion (decision 0056, amended), with the geometry
// and the time step passed in: no layout, no clock.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Aim,
  advance,
  arrive,
  beadPath,
  change,
  fit,
  frameDriver,
  type Frames,
  leave,
  lipPath,
  type Measures,
  type Motion,
  resting,
  retarget,
  room,
  settle,
  springSettled,
  still,
  stepSpring,
  swapped,
  tick,
  wordsClip,
} from "../src/bead-motion.ts";

const m: Measures = { seed: 22, neck: 13, corner: 26, gap: 12, radius: 16, swell: 5 };
const aim: Aim = { width: 260, height: 44, hovered: false };

// The points of a path, in the order drawn: x, y or both.
const points = (d: string) => {
  // Each command is one value (H or V) or pairs.
  const out: { x?: number; y?: number }[] = [];
  for (const [, command, args] of d.matchAll(/([MCVHZ])([^MCVHZ]*)/g)) {
    const values = ((args ?? "").match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (command === "H") out.push({ x: values[0] });
    else if (command === "V") out.push({ y: values[0] });
    else for (let i = 0; i < values.length; i += 2) out.push({ x: values[i], y: values[i + 1] });
  }
  return out;
};

// Runs `motion` for `seconds` at `fps`, aimed at `to`.
const run = (motion: Motion, seconds: number, fps: number, to: Aim = aim) => {
  let next = motion;
  for (let i = 0; i < Math.round(seconds * fps); i += 1) next = advance(next, 1 / fps, to, m);
  return next;
};

const shown = () => settle(run(arrive(still(m.seed), m.seed, false), 2, 60));

test("the room is the column less, each side, the corner, a neck and the gap", () => {
  assert.equal(room(1000, m), 1000 - 2 * (26 + 13 + 12));
  assert.deepEqual(fit(300, 1000, m), { width: 300, clamped: false });
  assert.deepEqual(fit(1200, 1000, m), { width: 898, clamped: true });
  // On a phone's column it still fits, cut short.
  assert.deepEqual(fit(420, 390, m), { width: 288, clamped: true });
  // Never narrower than the bead it drops as.
  assert.equal(fit(400, 60, m).width, m.seed);
});

test("its necks never reach past the corner curve, gathering or spread", () => {
  for (const column of [300, 390, 760, 1280])
    for (const width of [m.seed, 40, 120, room(column, m), column])
      for (const height of [1, 8, 20, 44]) {
        const d = beadPath({ width, height, wanted: room(column, m) }, column, m);
        for (const { x } of points(d))
          if (x !== undefined) {
            assert.ok(x >= m.corner - 0.01, `${x} past the left corner at ${column}`);
            assert.ok(x <= column - m.corner + 0.01, `${x} past the right corner at ${column}`);
          }
      }
});

test("clamped to the room, spread, it keeps the gap to the corners", () => {
  const column = 390;
  const { width } = fit(2000, column, m);
  const d = beadPath({ width, height: 44, wanted: width }, column, m);
  const xs = points(d).flatMap(({ x }) => (x === undefined ? [] : [x]));
  assert.ok(Math.min(...xs) >= m.corner + m.gap - 0.01);
  assert.ok(Math.max(...xs) <= column - m.corner - m.gap + 0.01);
});

test("a near-zero height is flat: nothing drawn below the band", () => {
  assert.equal(beadPath({ width: 200, height: 0.1, wanted: 200 }, 800, m), "");
  assert.equal(beadPath({ width: 200, height: 0, wanted: 200 }, 800, m), "");
  // Just past it, nothing lower than its height.
  const d = beadPath({ width: 200, height: 0.5, wanted: 200 }, 800, m);
  for (const { y } of points(d)) if (y !== undefined) assert.ok(y <= 0.5);
  assert.equal(lipPath({ width: 200, height: 0.5 }, 800, m, 1), "");
});

test("its words are revealed by a clip, never moved", () => {
  assert.equal(
    wordsClip({ width: 260, height: 44 }, 260, 44, 16),
    "inset(0 0px 0px 0px round 0 0 16px 16px)",
  );
  assert.equal(
    wordsClip({ width: 22, height: 20 }, 260, 44, 16),
    "inset(0 119px 24px 119px round 0 0 11px 11px)",
  );
  // Overshooting its rest, nothing is cut.
  assert.equal(
    wordsClip({ width: 270, height: 47 }, 260, 44, 16),
    "inset(0 0px 0px 0px round 0 0 16px 16px)",
  );
});

test("a spring settles on its target", () => {
  let s = { value: 0, velocity: 0, target: 44, stiffness: 260, damping: 19 };
  let peak = 0;
  for (let i = 0; i < 240 * 2; i += 1) {
    s = stepSpring(s, tick);
    peak = Math.max(peak, s.value);
  }
  assert.ok(springSettled(s));
  // Height leads with a little overshoot.
  assert.ok(peak > 44 && peak < 44 * 1.15, `peaked at ${peak}`);
});

test("it settles, its words in, and rests", () => {
  const motion = shown();
  assert.equal(motion.phase, "shown");
  assert.ok(resting(motion));
  assert.equal(motion.height.value, aim.height);
  assert.equal(motion.width.value, aim.width);
  assert.equal(motion.words.value, 1);
});

test("a step at any frame rate lands in the same place", () => {
  const start = arrive(still(m.seed), m.seed, false);
  const at30 = run(start, 0.5, 30);
  const at60 = run(start, 0.5, 60);
  const at144 = run(start, 0.5, 144);
  const at240 = run(start, 0.5, 240);
  for (const other of [at60, at144, at240]) {
    assert.equal(other.phase, at30.phase);
    assert.equal(other.at, at30.at);
    assert.equal(other.height.value, at30.height.value);
    assert.equal(other.width.value, at30.width.value);
    assert.equal(other.words.value, at30.words.value);
  }
});

test("it drops as a bead, then spreads, its words after", () => {
  let motion = arrive(still(m.seed), m.seed, false);
  motion = run(motion, 0.08, 60);
  assert.equal(motion.phase, "dropping");
  assert.ok(motion.height.value > 10, "the height leads");
  assert.equal(motion.width.target, m.seed, "the width waits");
  assert.equal(motion.words.value, 0);
  motion = run(motion, 0.3, 60);
  assert.ok(motion.width.value > m.seed * 3, "then it spreads");
});

test("reduced motion skips the drop: at its size at once, and it only fades", () => {
  let motion = arrive(still(m.seed), m.seed, true);
  assert.equal(motion.phase, "shown");
  // Not at rest until it has faded in, so its frames run.
  assert.equal(resting(motion), false);
  motion = advance(motion, 1 / 60, aim, m);
  assert.equal(motion.height.value, aim.height);
  assert.equal(motion.width.value, aim.width);
  assert.ok(motion.words.value > 0 && motion.words.value < 1, "fading in");
  motion = settle(run(motion, 1, 60));
  assert.ok(resting(motion));
  // A new note swaps its words at once.
  const swapping = change(motion);
  assert.equal(swapping.phase, "swapping");
  assert.equal(swapped(swapping).phase, "shown");
  // Leaving, it fades where it is, at its size, and is gone.
  let going = run(leave(motion), 0.05, 60);
  assert.equal(going.height.value, aim.height);
  assert.equal(going.width.value, aim.width);
  going = run(going, 1, 60);
  assert.equal(going.phase, "hidden");
});

test("a new note while one shows: the words go, the shape reflows, the new ones come", () => {
  let motion = change(shown());
  motion = run(motion, 0.3, 60);
  assert.equal(motion.phase, "swapping");
  assert.ok(motion.words.value < 0.08);
  motion = swapped(motion);
  const wider = { ...aim, width: 340 };
  motion = settle(run(motion, 2, 60, wider));
  assert.equal(motion.phase, "shown");
  assert.equal(motion.width.value, 340);
});

test("leaving: the words go first, it narrows to the bead, and the band takes it back", () => {
  let motion = leave(shown());
  motion = run(motion, 1 / 12, 60);
  assert.ok(motion.words.value < 0.65, "the words first");
  assert.equal(motion.width.target, aim.width, "still its width");
  motion = run(motion, 1 / 30, 60);
  assert.equal(motion.width.target, m.seed, "then it narrows");
  assert.equal(motion.height.target, aim.height);
  motion = run(motion, 2, 60);
  assert.equal(motion.phase, "hidden");
  assert.equal(motion.height.value, 0);
});

test("at rest, a new aim wakes it: the pointer, a resize, a list", () => {
  const rested = shown();
  for (const to of [
    { ...aim, hovered: true },
    { ...aim, width: 180 },
    { ...aim, height: 108 },
  ]) {
    const aimed = retarget(rested, to, m);
    assert.equal(resting(aimed), false);
    const settled = settle(run(aimed, 2, 60, to));
    assert.ok(resting(settled));
    assert.equal(settled.width.value, to.width);
    assert.equal(settled.height.value, to.height + (to.hovered ? m.swell : 0));
  }
  // The same aim leaves it at rest.
  assert.equal(resting(retarget(rested, aim, m)), true);
});

test("under the pointer it swells about 5px, then rests again", () => {
  const motion = settle(run(shown(), 2, 60, { ...aim, hovered: true }));
  assert.ok(resting(motion));
  assert.equal(motion.height.value, aim.height + m.swell);
});

// A test's frames: what was asked for, run by hand.
const fakeFrames = () => {
  const asked = new Map<number, (now: number) => void>();
  let next = 0;
  let now = 0;
  const frames: Frames = {
    request(fn) {
      next += 1;
      asked.set(next, fn);
      return next;
    },
    cancel(id) {
      asked.delete(id);
    },
  };
  const flush = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      const pending = [...asked.entries()];
      asked.clear();
      now += 1000 / 60;
      for (const [, fn] of pending) fn(now);
    }
  };
  return { frames, flush, pending: () => asked.size, total: () => next };
};

test("no animation frame is requested at rest, with a note or without", () => {
  const { frames, flush, pending, total } = fakeFrames();
  let motion = still(m.seed);
  let to = aim;
  const driver = frameDriver(frames, {
    moving: () => !resting(motion),
    step: (dt) => {
      motion = settle(advance(motion, dt, to, m));
    },
  });
  // No note: nothing.
  driver.kick();
  assert.equal(total(), 0);
  // A note: frames run while it moves, and stop once it rests.
  motion = arrive(motion, m.seed, false);
  driver.kick();
  driver.kick();
  assert.equal(pending(), 1, "one frame at a time");
  flush(240);
  assert.ok(resting(motion));
  assert.equal(pending(), 0);
  const asked = total();
  // At rest with its note, a kick asks for none.
  driver.kick();
  flush(10);
  assert.equal(total(), asked);
  // Aimed anew at rest, as the pointer comes, it moves again, then stops.
  to = { ...aim, hovered: true };
  motion = retarget(motion, to, m);
  driver.kick();
  assert.equal(pending(), 1);
  flush(240);
  assert.equal(pending(), 0);
  // It goes, and once hidden, none again.

  motion = leave(motion);
  driver.kick();
  flush(240);
  assert.equal(motion.phase, "hidden");
  assert.equal(pending(), 0);
});
