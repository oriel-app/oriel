import {
  type Bindings,
  type CapturedMutation,
  type ItemId,
  jiraOps,
  type NewRef,
  type Region,
} from "@oriel/core";
import { describe, type Fn, pathOf, type Reader, scopeOf } from "./describe.ts";
import { declarations } from "./dts.ts";
import { shimFor } from "./shim.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Errors name the function, so the agent can find the call that failed.
function named(path: string, error: unknown): Error {
  return new Error(`${path}: ${message(error)}`, { cause: error });
}

const defined = (args: object) =>
  Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));

// A region's bindings for one run. Reads proxy to `reader`. Writes are
// captured, never sent: a write must target a region item or a story an
// earlier create in this run made, and its arguments must pass the op
// catalogue.
export function bindingsFor(region: Region, options: { reader: Reader }): Bindings {
  const scope = scopeOf(region);
  const fns = describe(scope);
  const byPath = new Map<string, Fn>(fns.map((fn) => [pathOf(fn), fn]));
  const members = new Set<string>(scope.ids);
  const created = new Set<NewRef>();
  const host = {
    reader: options.reader,
    ids: scope.ids,
    has: (id: string): id is ItemId<"jira"> => members.has(id),
    created,
  };
  // The ref the next create must carry. Every correctly numbered create uses
  // one up, so a rejected create can't shift the numbering of later ones.
  let nextRef = 1;

  return {
    dts: declarations(scope, fns),
    shim: shimFor(fns),

    async read(fn, args) {
      const entry = byPath.get(fn);
      if (entry?.kind !== "read") throw new Error(`${JSON.stringify(fn)} isn't a read here`);
      try {
        return { value: await entry.run(args, host), outsideRegion: entry.outsideRegion };
      } catch (error) {
        throw named(fn, error);
      }
    },

    capture(fn, args, ref): CapturedMutation {
      const entry = byPath.get(fn);
      if (entry?.kind !== "write") throw new Error(`${JSON.stringify(fn)} isn't a write here`);
      try {
        if (!entry.creates && ref !== null) throw new Error(`only createStory names a new item`);
        if (entry.creates && ref !== `new:${nextRef}`)
          throw new Error(`expected ref new:${nextRef}, got ${JSON.stringify(ref)}`);
        if (entry.creates) nextRef += 1;
        const built = entry.build(args, host);
        const checked = jiraOps[entry.op](built.args);
        if (!checked.ok)
          throw new TypeError(checked.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
        if (ref !== null) created.add(ref);
        return { op: entry.op, target: built.target, ref, args: defined(checked.value) };
      } catch (error) {
        throw named(fn, error);
      }
    },
  };
}
