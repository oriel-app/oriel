// SPIKE: decision 0060's tool host in Effect 4: the process and its reader
// live in a Scope, calls queue on a one-permit Semaphore, a run ending is a
// fiber's interruption, and a deadline is `timeoutOrElse`. `openToolHost` at
// the bottom is the edge: plain callers get the same promises as plain.ts.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ToolAnswer } from "@oriel/core";
import { Cause, Deferred, Effect, Exit, Option, Scope, Semaphore, Stream } from "effect";
import {
  CallFailed,
  callRequest,
  capped,
  checkStart,
  declined,
  HostRefused,
  isObject,
  type Message,
  onList,
  type OpenToolHost,
  type ToolCall,
  type ToolHostOptions,
} from "./contract.ts";

// The host as Effect code sees it.
export type ToolHostE = {
  pid: number;
  dir: string;
  // `onSent` is told when the call leaves, so the edge can tell an
  // interruption before it from one after.
  call(call: ToolCall, onSent?: () => void): Effect.Effect<ToolAnswer, CallFailed>;
  close: Effect.Effect<void>;
};

type Process = { child: ChildProcessWithoutNullStreams; dir: string; exited: Promise<void> };

const start = (options: ToolHostOptions) =>
  Effect.sync((): Process => {
    const dir = mkdtempSync(join(tmpdir(), "oriel-host-"));
    const child = spawn(options.command, [...options.args], {
      cwd: dir,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stderr.resume();
    return { child, dir, exited };
  });

// SIGTERM, then SIGKILL after the grace, then the folder goes.
const stop = ({ child, dir, exited }: Process, graceMs: number) =>
  Effect.gen(function* () {
    const gone = Effect.promise(() => exited);
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      yield* gone.pipe(
        Effect.timeoutOrElse({
          duration: graceMs,
          orElse: () => Effect.sync(() => child.kill("SIGKILL")).pipe(Effect.andThen(gone)),
        }),
      );
    } else yield* gone;
    rmSync(dir, { recursive: true, force: true });
  });

export const makeToolHost = (options: ToolHostOptions): Effect.Effect<ToolHostE, HostRefused> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    let closed = false;
    const close = Effect.suspend(() => {
      closed = true;
      return Scope.close(scope, Exit.void);
    });
    return yield* Effect.gen(function* () {
      const process = yield* start(options);
      yield* Scope.addFinalizer(scope, stop(process, options.graceMs));

      // The control channel: Oriel's requests by ID, answered from stdout.
      const pending = new Map<string, Deferred.Deferred<Message, HostRefused>>();
      let ended = false;
      let requested = 0;
      const send = (message: Message) =>
        void process.child.stdin.write(`${JSON.stringify(message)}\n`);
      const read = (line: string) =>
        Effect.gen(function* () {
          let message: unknown;
          try {
            message = JSON.parse(line);
          } catch {
            return;
          }
          if (!isObject(message)) return;
          if (message.type === "control_request") return send(declined(message));
          if (message.type !== "control_response" || !isObject(message.response)) return;
          const response = message.response;
          const waiting = pending.get(String(response.request_id));
          if (!waiting) return;
          pending.delete(String(response.request_id));
          if (response.subtype === "success")
            yield* Deferred.succeed(waiting, isObject(response.response) ? response.response : {});
          else
            yield* Deferred.fail(
              waiting,
              new HostRefused(String(response.error ?? "Claude Code refused")),
            );
        });
      const failPending = Effect.gen(function* () {
        ended = true;
        for (const waiting of pending.values())
          yield* Deferred.fail(waiting, new HostRefused("Claude Code stopped"));
        pending.clear();
      });
      yield* Stream.fromAsyncIterable(
        createInterface({ input: process.child.stdout }),
        () => new HostRefused("Claude Code's output broke"),
      ).pipe(
        Stream.runForEach(read),
        Effect.ignore,
        Effect.ensuring(failPending),
        Effect.forkIn(scope),
      );
      const request = (body: Message) =>
        Effect.gen(function* () {
          if (ended) return yield* Effect.fail(new HostRefused("Claude Code stopped"));
          const id = `oriel-${++requested}`;
          const waiting = yield* Deferred.make<Message, HostRefused>();
          pending.set(id, waiting);
          send({ type: "control_request", request_id: id, request: body });
          return yield* Deferred.await(waiting).pipe(
            Effect.ensuring(Effect.sync(() => pending.delete(id))),
          );
        });

      const why = yield* Effect.gen(function* () {
        const init = yield* request({ subtype: "initialize" });
        const status = yield* request({ subtype: "mcp_status" });
        const hooks = yield* request({ subtype: "get_hooks_listing" });
        return checkStart(init, status, hooks, options.grants);
      }).pipe(
        Effect.timeoutOrElse({
          duration: options.startMs,
          orElse: () =>
            Effect.fail(new HostRefused("Claude Code didn't answer its start checks in time")),
        }),
      );
      if (why) return yield* Effect.fail(new HostRefused(why));

      // Closed now, so no call starts behind this one; the process ends in
      // the background.
      const closeSoon = Effect.sync(() => {
        closed = true;
      }).pipe(Effect.andThen(Effect.forkDetach(close)), Effect.asVoid);
      const lock = yield* Semaphore.make(1);
      const unsent = (why: string) => Effect.fail(new CallFailed(why, false));
      const call = (call: ToolCall, onSent?: () => void) =>
        !onList(options, call)
          ? unsent(`${call.server} ${call.tool} isn't on this caller's list`)
          : lock.withPermits(1)(
              Effect.suspend(() => {
                if (closed || ended) return unsent("the tool host is closed");
                onSent?.();
                return request(callRequest(call)).pipe(
                  Effect.timeoutOrElse({
                    duration: options.callMs,
                    orElse: () =>
                      Effect.fail(
                        new CallFailed(`${call.tool} took longer than ${options.callMs} ms`, true),
                      ),
                  }),
                  Effect.mapError((error) =>
                    error instanceof CallFailed ? error : new CallFailed(error.message, true),
                  ),
                  Effect.map(capped),
                  // A call in flight can only be stopped by ending its
                  // process.
                  Effect.onExit((exit) => (Exit.isFailure(exit) ? closeSoon : Effect.void)),
                );
              }),
            );

      return { pid: process.child.pid ?? -1, dir: process.dir, call, close };
    }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? close : Effect.void)));
  });

// The edge: an Effect's failure as the error plain callers catch, and an
// interruption (the signal aborted) as `interrupted()`.
function failureOf<E>(cause: Cause.Cause<E>, interrupted: () => Error): unknown {
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error)) return error.value;
  if (Cause.hasInterrupts(cause)) return interrupted();
  return Cause.squash(cause);
}

export const openToolHost: OpenToolHost = async (options, signal) => {
  const exit = await Effect.runPromiseExit(makeToolHost(options), { signal });
  if (Exit.isFailure(exit))
    throw failureOf(
      exit.cause,
      () => new HostRefused("Oriel stopped the tool host before it started"),
    );
  const host = exit.value;
  return {
    pid: host.pid,
    dir: host.dir,
    close: () => Effect.runPromise(host.close),
    async call(call, callSignal) {
      let sent = false;
      const done = await Effect.runPromiseExit(
        host.call(call, () => (sent = true)),
        { signal: callSignal },
      );
      if (Exit.isSuccess(done)) return done.value;
      throw failureOf(
        done.cause,
        () =>
          new CallFailed(
            sent
              ? "the run ended while this call was out"
              : "the run ended before this call was sent",
            sent,
          ),
      );
    },
  };
};
