// Asking before quitting (decision 0045): the threads Oriel works on, a turn
// running or a change set applying, counted once each, and told to the
// shell only when the number changes, or 0 while Settings has it off.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Ulid, ulid } from "@oriel/core";
import { quitGuard, workingThreads } from "./working.ts";

const id = (n: number) => ulid(n, new Uint8Array(10));

test("a thread counts once, for its running turn or a change set applying, done or not", async () => {
  const [a, b, c, d] = [id(1), id(2), id(3), id(4)];
  const sets = new Map<Ulid, Ulid[]>([
    [a, [id(10)]],
    [b, [id(11), id(12)]],
    [c, [id(13)]],
    [d, [id(14)]],
  ]);
  const applying = new Set([id(10), id(12), id(14)]);
  const asked: Ulid[] = [];
  const count = await workingThreads({
    // d is done, and its revert is applying.
    threads: [{ id: a }, { id: b }, { id: c }, { id: d }],
    // a's turn runs and a change set of it applies: still one thread.
    running: (thread) => thread === a,
    changeSets: async (thread) => {
      asked.push(thread);
      return (sets.get(thread) ?? []).map((set) => ({ id: set }));
    },
    applying: (set) => applying.has(set),
  });
  assert.equal(count, 3);
  // A running thread's change sets aren't read.
  assert.deepEqual(asked, [b, c, d]);
});

test("the shell hears the number only when it changes, and 0 while asking is off", async () => {
  let working = 0;
  let on = true;
  const told: number[] = [];
  const guard = quitGuard({
    working: async () => working,
    on: () => on,
    tell: async (threads) => void told.push(threads),
    log: () => {},
  });
  const look = async () => {
    guard.changed();
    await guard.idle();
  };
  await look();
  assert.deepEqual(told, []);
  working = 2;
  await look();
  await look();
  assert.deepEqual(told, [2]);
  on = false;
  await look();
  working = 3;
  await look();
  assert.deepEqual(told, [2, 0]);
  on = true;
  await look();
  assert.deepEqual(told, [2, 0, 3]);
  await guard.stop();
  working = 0;
  await look();
  assert.deepEqual(told, [2, 0, 3]);
});

test("a number the shell didn't take is told again at the next look", async () => {
  const told: number[] = [];
  let fails = true;
  const logged: string[] = [];
  const guard = quitGuard({
    working: async () => 1,
    on: () => true,
    tell: async (threads) => {
      if (fails) throw new Error("the shell is gone");
      told.push(threads);
    },
    log: (message) => void logged.push(message),
  });
  guard.changed();
  await guard.idle();
  assert.deepEqual([told, logged], [[], ["working: the shell didn't take it"]]);
  fails = false;
  guard.changed();
  await guard.idle();
  assert.deepEqual(told, [1]);
});
