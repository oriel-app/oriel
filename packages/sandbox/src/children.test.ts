import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { BroadcastChannel, Worker } from "node:worker_threads";
import { type ChildNews, childrenChannel, isChildNews } from "./children.ts";

test(
  "a worker's children reach the main thread, as they start and end",
  { skip: process.platform === "win32" },
  async () => {
    const heard = new BroadcastChannel(childrenChannel);
    const news: ChildNews[] = [];
    const ended = new Promise<void>((resolve) => {
      heard.onmessage = (event) => {
        const data = (event as { data?: unknown }).data;
        if (!isChildNews(data)) return;
        news.push(data);
        if (data.what === "ended") resolve();
      };
    });
    const code = `
      import { spawn } from "node:child_process";
      import { parentPort } from "node:worker_threads";
      import { relayChildren } from ${JSON.stringify(new URL("./children.ts", import.meta.url).href)};
      relayChildren();
      const child = spawn("/usr/bin/true", [], { stdio: "ignore" });
      child.once("spawn", () => parentPort.postMessage(child.pid));
    `;
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`));
    const [pid] = (await once(worker, "message")) as [number];
    await ended;
    assert.deepEqual(news, [
      { what: "started", pid },
      { what: "ended", pid },
    ]);
    heard.close();
    await worker.terminate();
  },
);

test("only news of a real process is taken", () => {
  assert.ok(isChildNews({ what: "started", pid: 612 }));
  for (const data of [
    null,
    {},
    { what: "kill", pid: 612 },
    { what: "ended", pid: 1 },
    { what: "ended", pid: "612" },
  ])
    assert.equal(isChildNews(data), false, JSON.stringify(data));
});
