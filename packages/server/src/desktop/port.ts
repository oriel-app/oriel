// The desktop app's port, kept in its data folder (decision 0036). Web
// storage belongs to an origin, and an origin includes its port, so the page
// keeps what it stored only while the port stays the same.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The first launch's choice: clear of `pnpm dev`'s 4310 and of the ports
// the OS hands out for outgoing connections.
export const firstPort = 4320;
// How far up from the kept port the server looks for a free one.
const scan = 100;

const file = (data: string) => join(data, "port");

// The port the folder keeps, or null before the first launch. A file that
// doesn't hold one counts as none.
export function keptPort(data: string): number | null {
  let text: string;
  try {
    text = readFileSync(file(data), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const port = Number(text.trim());
  return /^\d+$/.test(text.trim()) && port > 0 && port <= 65_535 ? port : null;
}

// Written whole and renamed into place.
export function keepPort(data: string, port: number): void {
  const next = `${file(data)}.${process.pid}.tmp`;
  writeFileSync(next, `${port}\n`);
  renameSync(next, file(data));
}

// The ports to try, in order: the kept one, then upward from it. Port 0
// lets the OS pick, as tests do.
export function portsFrom(start: number): number[] {
  if (start === 0) return [0];
  const last = Math.min(65_535, start + scan);
  return Array.from({ length: last - start + 1 }, (_, i) => start + i);
}
