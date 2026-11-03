import assert from "node:assert/strict";
import { test } from "node:test";
import { leftOver, processTable, startTime, toldLine } from "./processes.ts";

const at = (minute: number) => `Tue Nov  3 10:${String(minute).padStart(2, "0")}:00 2026`;

test("the process table reads each row's group and start time", () => {
  const rows = processTable(
    [
      `    1     0     1 ${at(0)}`,
      `  612   600   600 ${at(5)}`,
      "",
      "junk",
      "  613   600   600",
    ].join("\n"),
  );
  assert.deepEqual(rows, [
    { pid: 1, ppid: 0, pgid: 1, started: "Tue Nov 3 10:00:00 2026" },
    { pid: 612, ppid: 600, pgid: 600, started: "Tue Nov 3 10:05:00 2026" },
  ]);
  // `ps -o lstart= -p` pads as the table does; both read the same.
  assert.equal(startTime(`  ${at(5)}\n`), rows[1]!.started);
  assert.equal(startTime("\n"), "");
});

test("the watcher takes only the lines the server writes", () => {
  assert.deepEqual(toldLine("started 612"), { what: "started", pid: 612 });
  assert.deepEqual(toldLine("ended 612\r"), { what: "ended", pid: 612 });
  for (const line of ["started 1", "started 0", "started -5", "started 61x", "kill 612", ""])
    assert.equal(toldLine(line), null, line);
});

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

test("a group is killed only while the process that led it is the one the server started", () => {
  const table = processTable(
    [`  700     1   700 ${at(9)}`, `  702     1   700 ${at(9)}`, `  703     1   703 ${at(6)}`].join(
      "\n",
    ),
  );
  const started = new Map([
    [700, "Tue Nov 3 10:06:00 2026"],
    [703, "Tue Nov 3 10:06:00 2026"],
  ]);
  assert.deepEqual(leftOver(started, table), [703]);
});
