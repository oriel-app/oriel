// A watcher ends what the server started once the desktop app is gone, and
// nothing else (OA-195, #164: what the server started outlived a crash).
import assert from "node:assert/strict";
import { test } from "node:test";
import { leftOver, processTable } from "./processes.ts";

const at = (minute: number) => `Tue Nov  3 10:${String(minute).padStart(2, "0")}:00 2026`;

test("once the server is gone, what it started goes, and nothing else", () => {
  const table = processTable(
    [
      `    1     0     1 ${at(0)}`,
      // The shell's group: the server's Deno, still running, and its child.
      `  610     1   500 ${at(5)}`,
      `  611   610   500 ${at(5)}`,
      // An install in its own group: the script, its download, and a helper
      // the script already left to launchd.
      `  700     1   700 ${at(6)}`,
      `  701   700   700 ${at(6)}`,
      `  702     1   700 ${at(6)}`,
      // A PID the server's tsc had, now someone else's.
      `  620     1   620 ${at(9)}`,
      // Another app's.
      `  800     1   800 ${at(1)}`,
      `  801   800   800 ${at(1)}`,
    ].join("\n"),
  );
  const started = new Map([
    [610, "Tue Nov 3 10:05:00 2026"],
    [700, "Tue Nov 3 10:06:00 2026"],
    [620, "Tue Nov 3 10:07:00 2026"],
    // Ended unseen; nothing has its PID.
    [630, "Tue Nov 3 10:08:00 2026"],
  ]);
  assert.deepEqual(leftOver(started, table), [610, 611, 700, 701, 702]);
  assert.deepEqual(leftOver(new Map(), table), []);
});
