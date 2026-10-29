// A small architecture of our own: a model, messages, a pure `update`, and
// effects returned as data for `perform` to carry out. Only `perform` touches
// the world, so `update` is tested without a DOM.

export type Program<Model, Msg, Effect> = {
  init: readonly [Model, readonly Effect[]];
  update(model: Model, msg: Msg): readonly [Model, readonly Effect[]];
  perform(effect: Effect, dispatch: (msg: Msg) => void): void;
};

export type Running<Msg> = { dispatch(msg: Msg): void; stop(): void };

// Runs `program`, calling `render` with each new model. A message that leaves
// the model as it was renders nothing. After `stop`, messages are dropped.
export function start<Model, Msg, Effect>(
  program: Program<Model, Msg, Effect>,
  render: (model: Model) => void,
): Running<Msg> {
  let [model] = program.init;
  let stopped = false;
  const dispatch = (msg: Msg): void => {
    if (stopped) return;
    const [next, effects] = program.update(model, msg);
    if (next !== model) {
      model = next;
      render(next);
    }
    for (const effect of effects) program.perform(effect, dispatch);
  };
  for (const effect of program.init[1]) program.perform(effect, dispatch);
  return {
    dispatch,
    stop: () => {
      stopped = true;
    },
  };
}
