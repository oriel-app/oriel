// A tooltip shows above its control, or below when there's no room, and
// stays inside the window, however narrow.
import assert from "node:assert/strict";
import { test } from "node:test";
import { placeTooltip, repeatsName } from "../src/tooltips.ts";

const phone = { width: 390, height: 844 };
const box = (left: number, top: number, size = 28) => ({
  left,
  top,
  right: left + size,
  bottom: top + size,
});

test("a tooltip shows above its control, centred, or below it at the window's top", () => {
  const tip = { width: 100, height: 24 };
  assert.deepEqual(placeTooltip(box(150, 400), tip, phone), { top: 370, left: 114, side: "above" });
  assert.deepEqual(placeTooltip(box(150, 10), tip, phone), { top: 44, left: 114, side: "below" });
});

test("a tooltip near either edge of a narrow window stays inside it", () => {
  const tip = { width: 240, height: 40 };
  assert.equal(placeTooltip(box(2, 400), tip, phone).left, 8);
  assert.equal(placeTooltip(box(360, 400), tip, phone).left, 390 - 240 - 8);
});

test("a tooltip that only repeats its control's name isn't heard twice", () => {
  assert.equal(repeatsName("Search threads", " Search\n  threads "), true);
  assert.equal(repeatsName("Close (Esc)", "Close the panel"), false);
  assert.equal(repeatsName("Close (Esc)", null), false);
});
