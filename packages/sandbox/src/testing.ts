// Test support. The sandbox tests' shared parts: they run in several files,
// so that the tests that wait out a deadline wait in parallel. And real
// bindings from @oriel/bindings over a two-story region whose reader has
// nothing, with Jira's production namespace, so the escape tests run the
// production shim, stubs and typecheck rather than a stand-in.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { bindingsFor } from "@oriel/bindings";
import {
  type Bindings,
  type ItemId,
  type Region,
  type RunError,
  type RunLimits,
  type TranscriptEntry,
  ulid,
} from "@oriel/core";
import { jiraNamespace } from "@oriel/jira";
import { fakeBindings } from "./fake-bindings.ts";
import type { DenoSandbox } from "./sandbox.ts";

export const limits: RunLimits = {
  wallMs: 60_000,
  maxScriptBytes: 16_384,
  maxReads: 20,
  maxMutations: 20,
  maxIntents: 20,
  maxResultBytes: 65_536,
  maxConsoleBytes: 16_384,
};

export type Logged = { message: string; fields: Record<string, unknown> | undefined };

// Runs a script in `sandbox` under `limits` and the caps given, and keeps
// what it logs.
export const runner =
  (sandbox: DenoSandbox) =>
  async (script: string, caps: Partial<RunLimits> = {}, bindings: Bindings = fakeBindings()) => {
    const logged: Logged[] = [];
    const result = await sandbox.run(script, bindings, {
      limits: { ...limits, ...caps },
      signal: new AbortController().signal,
      log: (message, fields) => logged.push({ message, fields }),
    });
    return { result, logged };
  };

export function errorOf(entry: TranscriptEntry | undefined): RunError {
  assert.equal(entry?.kind, "error", JSON.stringify(entry));
  return entry.error;
}

// Types that keep tsc busy for seconds: a 100,000-member union compared
// against tuples it doesn't fit.
export const slowTypes = [
  "type D = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;",
  "type Flat<T extends unknown[]> = T extends [infer H, ...infer R] ? (H extends unknown ? [H, ...Flat<R>] : never) : [];",
  "const all = null as unknown as Flat<[D, D, D, D, D]>;",
  "const a: [number, number, number, number, string] = all;",
  "const b: [string, number, number, number, number] = all;",
  "const c: [number, string, number, number, number] = all;",
  "return [a, b, c];",
].join("\n");

// Whether a process is still there, zombies included.
export const exists = (pid: number) =>
  spawnSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim() !==
  "";

export function tscPid(logged: Logged[]): number {
  const pid = logged.find((line) => line.message === "sandbox.typecheck")?.fields?.["tsc_pid"];
  assert.equal(typeof pid, "number");
  return Number(pid);
}

const ids: ItemId<"jira">[] = ["jira:SYN-1", "jira:SYN-2"];
const fixedId = ulid(0, new Uint8Array(10));

export function regionBindings(): Bindings {
  const region: Region = {
    workstreamId: fixedId,
    version: 1,
    workspaceId: fixedId,
    items: ids.map((id, i) => ({ id, stableId: String(10001 + i) })),
    origin: { kind: "picked" },
  };
  return bindingsFor(region, {
    reader: {
      read: async (wanted) => wanted.map((id) => ({ id, status: "gone", reason: "deleted" })),
      search: async () => [],
    },
    namespaces: { jira: jiraNamespace(new Map(ids.map((id) => [id, "story"]))) },
  });
}
