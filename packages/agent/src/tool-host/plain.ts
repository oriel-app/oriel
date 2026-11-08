// SPIKE: decision 0060's tool host in plain TypeScript: promises, an
// AbortSignal per call, and timers.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ToolAnswer } from "@oriel/core";
import {
  CallFailed,
  callRequest,
  capped,
  checkStart,
  declined,
  HostRefused,
  isObject,
  type Message,
  messageOf,
  onList,
  type OpenToolHost,
  type ToolCall,
} from "./contract.ts";

// `work`, failed by `fail()` after `ms` or when `signal` aborts, whichever
// comes first. Its listener and timer go either way.
function bounded<T>(
  work: Promise<T>,
  ms: number,
  late: () => Error,
  signal: AbortSignal | undefined,
  aborted: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(late()), ms);
    const onAbort = () => reject(aborted());
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

export const openToolHost: OpenToolHost = async (options, signal) => {
  const dir = mkdtempSync(join(tmpdir(), "oriel-host-"));
  const child = spawn(options.command, [...options.args], {
    cwd: dir,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const pending = new Map<string, PromiseWithResolvers<Message>>();
  let ended: Error | null = null;
  let requested = 0;
  const end = (why: Error) => {
    ended ??= why;
    for (const waiting of pending.values()) waiting.reject(ended);
    pending.clear();
  };
  child.on("error", () => end(new HostRefused("Oriel couldn't start Claude Code")));
  child.on("close", (code) => end(new HostRefused(`Claude Code stopped (exit code ${code})`)));
  child.stdin.on("error", () => {});
  child.stderr.resume();

  const send = (message: Message) => {
    if (!ended) child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObject(message) || ended) return;
    if (message.type === "control_request") return send(declined(message));
    if (message.type !== "control_response" || !isObject(message.response)) return;
    const response = message.response;
    const id = String(response.request_id);
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    if (response.subtype === "success")
      waiting.resolve(isObject(response.response) ? response.response : {});
    else waiting.reject(new Error(String(response.error ?? "Claude Code refused")));
  });
  const request = (body: Message): Promise<Message> => {
    if (ended) return Promise.reject(ended);
    const id = `oriel-${++requested}`;
    const waiting = Promise.withResolvers<Message>();
    pending.set(id, waiting);
    send({ type: "control_request", request_id: id, request: body });
    return waiting.promise;
  };

  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      end(new CallFailed("Oriel closed the tool host", true));
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const kill = setTimeout(() => child.kill("SIGKILL"), options.graceMs);
        await exited;
        clearTimeout(kill);
      } else await exited;
      rmSync(dir, { recursive: true, force: true });
    })());

  try {
    const why = await bounded(
      (async () => {
        const init = await request({ subtype: "initialize" });
        const status = await request({ subtype: "mcp_status" });
        const hooks = await request({ subtype: "get_hooks_listing" });
        return checkStart(init, status, hooks, options.grants);
      })(),
      options.startMs,
      () => new HostRefused("Claude Code didn't answer its start checks in time"),
      signal,
      () => new HostRefused("Oriel stopped the tool host before it started"),
    );
    if (why) throw new HostRefused(why);
  } catch (error) {
    await close();
    throw error instanceof HostRefused ? error : new HostRefused(messageOf(error));
  }

  // One call at a time. `queue` settles when the call ahead of this one has.
  let queue: Promise<unknown> = Promise.resolve();
  const unsent = (why: string) => new CallFailed(why, false);

  const once = async (call: ToolCall, callSignal: AbortSignal | undefined): Promise<ToolAnswer> => {
    if (ended || closing) throw unsent("the tool host is closed");
    if (callSignal?.aborted) throw unsent("the run ended before this call was sent");
    try {
      const response = await bounded(
        request(callRequest(call)),
        options.callMs,
        () => new CallFailed(`${call.tool} took longer than ${options.callMs} ms`, true),
        callSignal,
        () => new CallFailed("the run ended while this call was out", true),
      );
      return capped(response);
    } catch (error) {
      // A call in flight can only be stopped by ending its process.
      void close();
      throw error instanceof CallFailed ? error : new CallFailed(messageOf(error), true);
    }
  };

  return {
    pid: child.pid ?? -1,
    dir,
    close,
    call(call, callSignal) {
      if (!onList(options, call))
        return Promise.reject(unsent(`${call.server} ${call.tool} isn't on this caller's list`));
      let started = false;
      const turn = queue.then(() => {
        started = true;
        return once(call, callSignal);
      });
      queue = turn.catch(() => {});
      if (!callSignal) return turn;
      // A queued call fails as soon as its run ends, not when the call ahead
      // settles; `once` then sees the abort and sends nothing. A call already
      // out is failed by `once`'s own bound.
      return new Promise<ToolAnswer>((resolve, reject) => {
        const onAbort = () => {
          if (!started) reject(unsent("the run ended before this call was sent"));
        };
        if (callSignal.aborted) onAbort();
        callSignal.addEventListener("abort", onAbort, { once: true });
        turn.then(resolve, reject).finally(() => callSignal.removeEventListener("abort", onAbort));
      });
    },
  };
};
