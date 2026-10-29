// The agent's script is the body of an async function: it can `await` and
// `return`. The host strips its types and checks it here, then sends the
// JavaScript to the guest as data, where it becomes a function through the
// AsyncFunction constructor. It never becomes module source, so it can't add a
// static `import`, which Deno would load before the script runs and outside
// `--deny-read`.
import { stripTypeScriptTypes } from "node:module";
import { Script } from "node:vm";

const head = "(async () => {\n";
const tail = "\n})";

const AsyncFunction = (async () => {}).constructor as new (body: string) => unknown;

export type Compiled = { ok: true; js: string } | { ok: false; message: string };

export function compileScript(script: string): Compiled {
  let wrapped: string;
  try {
    // Wrapped so that a top-level `return` and `await` parse. Strip mode only
    // blanks types, so positions in the result match the script's.
    wrapped = stripTypeScriptTypes(`${head}${script}${tail}`, { mode: "strip" });
  } catch (error) {
    return { ok: false, message: `the script doesn't parse: ${errorText(error)}` };
  }
  if (!wrapped.startsWith(head) || !wrapped.endsWith(tail))
    return { ok: false, message: "the script must be the body of one function" };
  const js = wrapped.slice(head.length, -tail.length);
  try {
    // Compiles without running. The constructor parses the body on its own, so
    // a script that closes the wrapper above is refused here.
    void new AsyncFunction(js);
  } catch (error) {
    return { ok: false, message: `${errorText(error)}${codeFrame(js)}` };
  }
  return { ok: true, js };
}

// Where a body that doesn't compile goes wrong, as "script.ts:N" and a code
// frame. Diagnostics only: this compiles, never runs, the source.
function codeFrame(js: string): string {
  try {
    void new Script(`(async function () {\n${js}\n})`, { filename: "script.ts", lineOffset: -1 });
    return "";
  } catch (error) {
    const stack = error instanceof Error ? (error.stack ?? "") : "";
    const frame = stack.split("\n\n")[0] ?? "";
    return frame.startsWith("script.ts:") ? `\n${frame}` : "";
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
