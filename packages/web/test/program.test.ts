import assert from "node:assert/strict";
import { test } from "node:test";
import { type Program, start } from "../src/program.ts";

type Msg = { type: "add"; n: number } | { type: "echo"; n: number };
type Effect = { type: "echo"; n: number };

// A counter whose "echo" effect dispatches its number back, synchronously.
function counter(log: string[]): Program<number, Msg, Effect> {
  return {
    init: [0, [{ type: "echo", n: 1 }]],
    update(model, msg) {
      if (msg.type === "echo") return [model + msg.n, []];
      if (msg.n === 0) return [model, []];
      return [model + msg.n, msg.n > 10 ? [{ type: "echo", n: 1 }] : []];
    },
    perform(effect, dispatch) {
      log.push(`perform ${effect.n}`);
      dispatch({ type: "echo", n: effect.n });
    },
  };
}

test("start performs init effects and renders each new model", () => {
  const log: string[] = [];
  const running = start(counter(log), (model) => log.push(`render ${model}`));
  running.dispatch({ type: "add", n: 2 });
  assert.deepEqual(log, ["perform 1", "render 1", "render 3"]);
});

test("a message that leaves the model as it was renders nothing", () => {
  const log: string[] = [];
  const running = start(counter(log), (model) => log.push(`render ${model}`));
  log.length = 0;
  running.dispatch({ type: "add", n: 0 });
  assert.deepEqual(log, []);
});

test("effects run after the model they came with is rendered", () => {
  const log: string[] = [];
  const running = start(counter(log), (model) => log.push(`render ${model}`));
  log.length = 0;
  running.dispatch({ type: "add", n: 20 });
  assert.deepEqual(log, ["render 21", "perform 1", "render 22"]);
});

test("after stop, messages are dropped", () => {
  const log: string[] = [];
  const running = start(counter(log), (model) => log.push(`render ${model}`));
  running.stop();
  log.length = 0;
  running.dispatch({ type: "add", n: 2 });
  assert.deepEqual(log, []);
});
