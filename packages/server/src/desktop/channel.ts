// The server's end of the line protocol with the desktop shell (PROTOCOL.md):
// the launch secret first, then requests out and answers in, matched by id.
// The shell is the server's parent, so a line it sends that can't be read is
// logged and dropped, not trusted and not fatal.
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { Log } from "@oriel/core";
import {
  type Answer,
  answers,
  isLaunchSecret,
  reply,
  request as requestShape,
  type RequestKind,
  type ServerLine,
  type ShellRequest,
} from "./protocol.ts";

export type Shell = {
  ask<K extends RequestKind>(request: ShellRequest & { kind: K }): Promise<Answer<K>>;
};

export type Channel = {
  // The first line; rejects if stdin ends first or the line isn't one.
  secret: Promise<string>;
  shell: Shell;
  // The first line out: the URL the shell loads. Requests asked before it
  // go after it.
  ready(url: string): void;
  // Resolves when stdin ends, which means the shell is gone.
  ended: Promise<void>;
};

export class ShellGone extends Error {}

// `write` sends one line, with its newline, to the shell.
export function channel(input: Readable, write: (line: string) => void, log: Log): Channel {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const pending = new Map<number, { kind: RequestKind; settle(answer: Settled): void }>();
  let nextId = 1;
  let first = true;
  let gone = false;
  const secret = Promise.withResolvers<string>();
  const ended = Promise.withResolvers<void>();
  // Requests wait for the ready line, which is always the first out.
  let held: ServerLine[] | null = [];
  const send = (line: ServerLine) => (held ? held.push(line) : write(`${JSON.stringify(line)}\n`));

  lines.on("line", (line) => {
    if (first) {
      first = false;
      // Never quoted: it is the secret, or close to it.
      if (isLaunchSecret(line)) secret.resolve(line);
      else secret.reject(new Error("the first line on stdin isn't a launch secret"));
      return;
    }
    const parsed = (() => {
      try {
        return reply(JSON.parse(line));
      } catch {
        return null;
      }
    })();
    if (!parsed?.ok) {
      log("desktop: a line from the shell isn't an answer", {});
      return;
    }
    const answer = parsed.value;
    const waiting = pending.get(answer.id);
    if (!waiting) {
      log("desktop: the shell answered a request it wasn't asked", { id: answer.id });
      return;
    }
    pending.delete(answer.id);
    if (!answer.ok) {
      log("desktop: the shell refused a request", { kind: waiting.kind, error: answer.error });
      waiting.settle({ ok: false, error: new Error(`the shell refused ${waiting.kind}`) });
      return;
    }
    const value = answers[waiting.kind](answer.value);
    if (!value.ok) {
      log("desktop: the shell's answer isn't one for its request", { kind: waiting.kind });
      waiting.settle({ ok: false, error: new Error(`the shell's answer to ${waiting.kind}`) });
      return;
    }
    waiting.settle({ ok: true, value: value.value });
  });
  lines.once("close", () => {
    gone = true;
    if (first) secret.reject(new Error("stdin ended before the launch secret"));
    for (const waiting of pending.values())
      waiting.settle({ ok: false, error: new ShellGone("the shell is gone") });
    pending.clear();
    ended.resolve();
  });
  // Nobody may be waiting on these when they settle.
  secret.promise.catch(() => {});

  return {
    secret: secret.promise,
    ended: ended.promise,
    ready(url) {
      const waiting = held ?? [];
      held = null;
      for (const line of [{ kind: "ready", url } as const, ...waiting]) send(line);
    },
    shell: {
      ask(request) {
        if (gone) return Promise.reject(new ShellGone("the shell is gone"));
        const checked = requestShape(request);
        if (!checked.ok)
          return Promise.reject(new Error(`${request.kind} isn't a request the shell takes`));
        const id = nextId++;
        const answer = Promise.withResolvers<Answer<typeof request.kind>>();
        pending.set(id, {
          kind: request.kind,
          settle: (settled) =>
            settled.ok
              ? answer.resolve(settled.value as Answer<typeof request.kind>)
              : answer.reject(settled.error),
        });
        send({ id, ...checked.value });
        return answer.promise;
      },
    },
  };
}

type Settled = { ok: true; value: unknown } | { ok: false; error: Error };
