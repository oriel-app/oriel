// The to-review pill's view of a change set (OA-260, OA-272): shown, or
// above or below what's on screen, against the room the window leaves
// above the composer; and observers that hear every change of it, even
// across a jump that crosses no half.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Box, placed, watching } from "../src/change-set.ts";

// A phone on its side: a window 390 tall, a 210px dock, so the room is 180.
const room = 180;
const at = (top: number, height: number): Box => ({ top, bottom: top + height });

test("a change set taller than the room, at the latest, reads as shown", () => {
  // 600 tall, its decision just over the composer: it fills the room.
  assert.equal(placed(at(room - 600, 600), room), "shown");
  // Filling the room from top to bottom, taller than twice it.
  assert.equal(placed(at(-400, 1600), room), "shown");
});

test("a change set reads as shown with half of it, or of the room, in the room", () => {
  assert.equal(placed(at(40, 100), room), "shown");
  assert.equal(placed(at(room - 50, 100), room), "shown");
  assert.equal(placed(at(room - 49, 100), room), "below");
  assert.equal(placed(at(-51, 100), room), "above");
  // Behind the composer, though on screen, is out of the room.
  assert.equal(placed(at(room + 10, 100), room), "below");
  assert.equal(placed(at(-3000, 100), room), "above");
  // Taller than the room: half the room, 90, is enough.
  assert.equal(placed(at(room - 90, 1200), room), "shown");
  assert.equal(placed(at(room - 89, 1200), room), "below");
  assert.equal(placed(at(90 - 1200, 1200), room), "shown");
  assert.equal(placed(at(89 - 1200, 1200), room), "above");
});

// An IntersectionObserver, by its spec: it calls back on observing, and
// after that only in a frame where its threshold index has changed.
const index = (set: Box, from: number, thresholds: readonly number[]) => {
  const shows = Math.max(0, Math.min(set.bottom, room) - Math.max(set.top, from));
  const ratio = shows / (set.bottom - set.top);
  const reached = thresholds.filter((threshold) => ratio >= threshold).length;
  return shows > 0 ? reached : -1;
};

// Frames of one change set's place, each as a box. What its observers
// last said, as `placed` reads the frame they last called back in.
function heard(frames: readonly Box[]): ReturnType<typeof placed> | undefined {
  const first = frames[0];
  if (!first) return undefined;
  const views = watching(first.bottom - first.top, room);
  let said: ReturnType<typeof placed> | undefined;
  let was = views.map(() => Number.NaN);
  for (const frame of frames) {
    const now = views.map(({ top, thresholds }) => index(frame, top, thresholds));
    if (now.some((n, i) => n !== was[i])) said = placed(frame, room);
    was = now;
  }
  return said;
}

test("the observers hear each change, a jump that crosses no half too", () => {
  for (const height of [60, 120, 180, 255, 400, 1100, 1600])
    for (let from = -2400; from <= 1400; from += 37)
      for (let to = -2400; to <= 1400; to += 41) {
        const frames = [at(from, height), at(to, height)];
        assert.equal(heard(frames), placed(at(to, height), room), `${height}: ${from} → ${to}`);
      }
});

test("the observers hear a scroll through a change set taller than twice the room", () => {
  const frames = Array.from({ length: 130 }, (_, n) => at(room - n * 15, 1600));
  for (let n = 1; n <= frames.length; n++) {
    const last = frames[n - 1];
    if (last) assert.equal(heard(frames.slice(0, n)), placed(last, room), `frame ${n}`);
  }
});
