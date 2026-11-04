// What the server started, read from the process table: by the server as it
// exits (utility.ts), and by its watcher once it's gone (watcher.ts). No
// imports, so the watcher loads nothing else.

// Every process descended from `root` in `ps -A -o pid=,ppid=`'s table,
// parents before their children, so a kill in this order leaves none behind
// to start another.
export function descendants(table: string, root: number): number[] {
  const children = new Map<number, number[]>();
  for (const row of table.split("\n")) {
    const [pid, ppid] = row.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid === ppid) continue;
    children.set(ppid!, [...(children.get(ppid!) ?? []), pid!]);
  }
  const found: number[] = [];
  const seen = new Set([root]);
  for (let at = [root]; at.length > 0;) {
    const next = at.flatMap((pid) => children.get(pid) ?? []).filter((pid) => !seen.has(pid));
    for (const pid of next) seen.add(pid);
    found.push(...next);
    at = next;
  }
  return found;
}

// One process: its group, and when it started, as `ps` prints `lstart`. A
// PID and its start time name one process; a PID alone may be reused.
export type Row = { pid: number; ppid: number; pgid: number; started: string };

// The arguments for `ps` that print `processTable`'s rows.
export const tableColumns = ["-A", "-o", "pid=,ppid=,pgid=,lstart="];

export const startTime = (text: string): string => text.trim().split(/\s+/).join(" ");

export function processTable(text: string): Row[] {
  return text.split("\n").flatMap((line) => {
    const [pid, ppid, pgid, ...started] = line.trim().split(/\s+/);
    const ids = [pid, ppid, pgid].map(Number);
    if (!ids.every((id) => Number.isInteger(id) && id >= 0) || started.length === 0) return [];
    return [{ pid: ids[0]!, ppid: ids[1]!, pgid: ids[2]!, started: startTime(started.join(" ")) }];
  });
}

// What the server tells its watcher: each process it started, once it has a
// PID, and each that ended.
export type Told = { what: "started" | "ended"; pid: number };

export function toldLine(line: string): Told | null {
  const match = /^(started|ended) ([1-9]\d{0,9})$/.exec(line.trim());
  if (!match) return null;
  const pid = Number(match[2]);
  return pid > 1 ? { what: match[1] as Told["what"], pid } : null;
}

// What to kill once the server is gone: each process it started that is
// still the same process, by its start time, so a reused PID is never
// killed; the rest of the group each one leads, as the first run's CLI
// commands do, which holds what a command left to launchd; and everything
// under them all. Parents first.
export function leftOver(started: ReadonlyMap<number, string>, rows: readonly Row[]): number[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const same = [...started].flatMap(([pid, at]) => (byPid.get(pid)?.started === at ? [pid] : []));
  const leads = new Set(same.filter((pid) => byPid.get(pid)!.pgid === pid));
  const members = rows.filter((row) => leads.has(row.pgid)).map((row) => row.pid);
  const pairs = rows.map((row) => `${row.pid} ${row.ppid}`).join("\n");
  const found = new Set<number>();
  for (const pid of [...same, ...members]) {
    found.add(pid);
    for (const under of descendants(pairs, pid)) found.add(under);
  }
  return [...found];
}
