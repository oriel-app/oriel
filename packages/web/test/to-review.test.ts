import assert from "node:assert/strict";
import { test } from "node:test";
import { type Box, placed, watching } from "../src/change-set.ts";

const room = 180;
const at = (top: number, height: number): Box => ({ top, bottom: top + height });

test("a change set taller than the room, at the latest, reads as shown", () => {
  assert.equal(placed(at(room - 600, 600), room), "shown");
  assert.equal(placed(at(-400, 1600), room), "shown");
});

// An IntersectionObserver, by its spec: it calls back on observing, and
// after that only in a frame where its threshold index has changed.
const index = (set: Box, from: number, thresholds: readonly number[]) => {
  const shows = Math.max(0, Math.min(set.bottom, room) - Math.max(set.top, from));
  const ratio = shows / (set.bottom - set.top);
  const reached = thresholds.filter((threshold) => ratio >= threshold).length;
  return shows > 0 ? reached : -1;
};

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
