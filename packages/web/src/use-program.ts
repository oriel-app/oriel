import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { type Program, type Running, start } from "./program.ts";

// Runs `program` for as long as the calling component is mounted. The program
// is read once, on mount.
export function useProgram<Model, Msg, Effect>(
  program: Program<Model, Msg, Effect>,
): [Model, (msg: Msg) => void] {
  const [model, setModel] = useState(program.init[0]);
  const running = useRef<Running<Msg> | null>(null);
  useEffect(() => {
    running.current = start(program, setModel);
    return () => running.current?.stop();
  }, []);
  const dispatch = useCallback((msg: Msg) => running.current?.dispatch(msg), []);
  return [model, dispatch];
}
