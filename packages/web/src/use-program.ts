import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { carrying } from "./carry.ts";
import { type Program, type Running, start } from "./program.ts";

// Runs `program` for as long as the calling component is mounted. The program
// is read once, on mount. `carried`: whether a change from one model to the
// next carries the composer, which a View Transition draws (carry.ts).
export function useProgram<Model, Msg, Effect>(
  program: Program<Model, Msg, Effect>,
  carried?: (before: Model, after: Model) => boolean,
): [Model, (msg: Msg) => void] {
  const [model, setModel] = useState(program.init[0]);
  const running = useRef<Running<Msg> | null>(null);
  useEffect(() => {
    let shown = program.init[0];
    let latest = shown;
    let carry: { pending(): boolean } | null = null;
    const show = () => setModel(latest);
    running.current = start(program, (next) => {
      const before = shown;
      shown = latest = next;
      if (carry?.pending()) return;
      if (carried?.(before, next)) carry = carrying(show);
      else show();
    });
    return () => running.current?.stop();
  }, []);
  const dispatch = useCallback((msg: Msg) => running.current?.dispatch(msg), []);
  return [model, dispatch];
}
