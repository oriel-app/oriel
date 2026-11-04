// Each process a thread starts, and each that ends, from Node's own
// `child_process` diagnostics channel. That channel tells only the thread
// that started the process, so a worker that starts any, as the compiler's
// does with tsc, relays each start and end on a broadcast channel, which
// the desktop server's watcher hears on the main thread
// (packages/server/src/desktop/utility.ts, watchChildren).
import type { ChildProcess } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { BroadcastChannel } from "node:worker_threads";

export const childrenChannel = "oriel.children";
export type ChildNews = { what: "started" | "ended"; pid: number };

export const isChildNews = (data: unknown): data is ChildNews => {
  const news = data as Partial<ChildNews> | null;
  return (
    (news?.what === "started" || news?.what === "ended") &&
    Number.isInteger(news.pid) &&
    news.pid! > 1
  );
};

// Each start, once the process has a PID, and its end, until the returned
// function stops it.
export function onChildren(heard: (news: ChildNews) => void): () => void {
  const listener = (message: unknown) => {
    const child = (message as { process?: ChildProcess }).process;
    child?.once("spawn", () => {
      const pid = child.pid;
      if (pid === undefined) return;
      heard({ what: "started", pid });
      child.once("exit", () => heard({ what: "ended", pid }));
    });
  };
  subscribe("child_process", listener);
  return () => unsubscribe("child_process", listener);
}

// For a worker: its children, to whoever listens on childrenChannel.
export function relayChildren(): void {
  const out = new BroadcastChannel(childrenChannel);
  out.unref();
  onChildren((news) => out.postMessage(news));
}
