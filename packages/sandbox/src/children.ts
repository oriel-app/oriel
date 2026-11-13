// Node's `child_process` diagnostics channel tells only the thread that started the process, so a worker that starts any
// relays each start and end on a broadcast channel, which the desktop server's watcher hears on the main thread.
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

export function relayChildren(): void {
  const out = new BroadcastChannel(childrenChannel);
  out.unref();
  onChildren((news) => out.postMessage(news));
}
