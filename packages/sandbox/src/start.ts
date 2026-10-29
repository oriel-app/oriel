// Stand-ins for what @oriel/bindings exports on PR 14 (commit 1757a4d), with
// the same contract: `guestStart`, `scriptLineOffset` and `typecheck`. When
// this branch is rebased onto PR 14, delete this file and import those three
// from "@oriel/bindings" in compile-worker.ts and sandbox.ts.
//
// Both `guestStart` and `typecheck` strip types with Node's stripper, which a
// deep enough script can break for the rest of its isolate. Only ever call
// them from the compile worker (compiler.ts).
import { stripTypeScriptTypes } from "node:module";
import type { HostReply, RunError } from "@oriel/core";

export type Started = { ok: true; reply: HostReply } | { ok: false; error: RunError };

// The names the script sees, in the order the guest passes them to it.
const globals = ["jira", "search"];

const opening = "async function __script() {\n";
const closing = "\n}\n";

// The compiled body opens with a "use strict" line, after the two lines the
// AsyncFunction constructor puts before every body. A runtime error at line
// L of the compiled function is at line L - 3 of the script, same column.
export const scriptLineOffset = 3;

type Compile = new (...paramsThenBody: string[]) => unknown;
const AsyncFunction = (async () => {}).constructor as Compile;

const refuse = (detail: string): { ok: false; error: RunError } => ({
  ok: false,
  error: {
    phase: "typecheck",
    message: `The script doesn't compile as the body of an async function: ${detail}`,
    hint: "Write statements only: no import or export declarations, nothing that closes the body early, and only types that erase (no enum, namespace or parameter properties).",
    logs: [],
  },
});

const firstLine = (error: unknown) =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).split("\n")[0] ?? "";

// What the sandbox sends the guest first, as reply 0, or why the script can't
// run: types stripped in place, then compiled once without running.
export function guestStart(script: string): Started {
  const wrapped = opening + script + closing;
  let stripped: string;
  try {
    stripped = stripTypeScriptTypes(wrapped, { mode: "strip" });
  } catch (error) {
    return refuse(firstLine(error));
  }
  const intact =
    stripped.length === wrapped.length &&
    stripped.startsWith(opening) &&
    stripped.endsWith(closing);
  if (!intact) return refuse("stripping its types moved it");
  const body = `"use strict";\n${stripped.slice(opening.length, stripped.length - closing.length)}`;
  try {
    void new AsyncFunction(...globals, body);
  } catch (error) {
    return refuse(firstLine(error));
  }
  return { ok: true, reply: { id: 0, ok: true, value: body } };
}

// The real one then runs tsc against the region's declarations; this one
// stops after the compile step.
export async function typecheck(
  script: string,
  _dts: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RunError | null> {
  options.signal?.throwIfAborted();
  const start = guestStart(script);
  return start.ok ? null : start.error;
}
