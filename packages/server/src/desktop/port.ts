// Web storage belongs to an origin, which includes its port, so the page keeps what it stored only while the port stays.
// The MCP door's is kept beside it and never moves: a client's config names it.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The first launch's choice: clear of `pnpm dev`'s 4310 and of the ports
// the OS hands out for outgoing connections.
export const firstPort = 4320;
// The MCP door's first choice, clear of every port the window's scan may
// take, since a client's config names it.
export const firstDoorPort = 4430;
const scan = 100;

const file = (data: string, name: string) => join(data, name);

export function keptPort(data: string, name = "port"): number | null {
  let text: string;
  try {
    text = readFileSync(file(data, name), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const port = Number(text.trim());
  return /^\d+$/.test(text.trim()) && port > 0 && port <= 65_535 ? port : null;
}

export function keepPort(data: string, port: number, name = "port"): void {
  const next = `${file(data, name)}.${process.pid}.tmp`;
  writeFileSync(next, `${port}\n`);
  renameSync(next, file(data, name));
}

export function portsFrom(start: number): number[] {
  if (start === 0) return [0];
  const last = Math.min(65_535, start + scan);
  return Array.from({ length: last - start + 1 }, (_, i) => start + i);
}

// The kept one alone, since a client's config names it and sends its token there.
export const doorPorts = (kept: number | null, first: number): number[] =>
  kept === null ? portsFrom(first) : [kept];
