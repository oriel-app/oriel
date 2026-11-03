import {
  type Bindings,
  type CapturedMutation,
  type ItemId,
  type NewRef,
  noThreads,
  type OrielReads,
  type Reader,
  type Region,
  type SearchHit,
  type Ulid,
} from "@oriel/core";
import { intended } from "./actions.ts";
import { describe, type Fn, type ItemDocs, type Namespaces, pathOf, scopeOf } from "./describe.ts";
import { declarations } from "./dts.ts";
import { type Host, live, outside } from "./fn.ts";
import { shimFor } from "./shim.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Errors name the function, so the agent can find the call that failed.
function named(path: string, error: unknown): Error {
  return new Error(`${path}: ${message(error)}`, { cause: error });
}

const defined = (args: object) =>
  Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));

// A region's bindings for one run. Reads proxy to `reader`. Writes are
// captured, never sent: a write must target a region item from its own source
// or a story an earlier create in this run made, and its arguments must pass
// that source's op catalogue. `namespaces` are the sources' own namespaces,
// and `items` what each source's items are, as their adapters declare them;
// `oriel` reads the workspace's own threads, for Oriel's namespaces, and
// without it the workspace has none. Oriel's actions are recorded as
// intents, each checked against its declaration, with the region's
// workstream and `thread` as the agent's own, and each item a workstream
// gains in the region or found by this run's search(). `show` builds a
// block from a read the turn ran (decision 0030). The composition root
// passes them in.
export function bindingsFor(
  region: Region,
  options: {
    reader: Reader;
    namespaces: Namespaces;
    items?: ItemDocs;
    oriel?: OrielReads;
    thread?: Ulid;
    show?: (spec: unknown) => string;
    // The window chat's overview, with the items it shows as the index has
    // them; its thread's module gets `window` only with it (decision 0027).
    // `reachable`: the IDs of the items each cluster it names holds, which
    // an action in the run may take, as Make a workstream does, though the
    // read shows none of them, so none can be read (decision 0044).
    overview?: () => Promise<{ view: unknown; items: SearchHit[]; reachable?: readonly string[] }>;
  },
): Bindings {
  const scope = scopeOf(region, options.namespaces, options.items);
  const fns = describe(scope, { window: options.overview !== undefined });
  const byPath = new Map<string, Fn>(fns.map((fn) => [pathOf(fn), fn]));
  const members = new Set<string>(scope.ids);
  const created = new Map<NewRef, string>();
  const { reader } = options;
  // What creates items here, for messages: the namespaces' own names for it.
  const creates = fns.flatMap((fn) => (fn.kind === "write" && fn.creates ? [pathOf(fn)] : []));
  const makers = creates.length ? creates.join(" or ") : "a create";
  // IDs this run's search() returned. A namespace may read those too, and
  // nothing else outside the region: the host refuses before any adapter
  // code sees the ID, whatever the adapter checks itself.
  const found = new Set<string>();
  // IDs an action in this run may take though no read showed them: the items
  // of the clusters the overview named, as Make a workstream copies them.
  // Never read through: reading one still takes a search() that shows it.
  const joinable = new Set<string>();
  const host: Host = {
    ids: scope.ids,
    has: (id: string): id is ItemId => members.has(id),
    created,
    read: (ids, view) => {
      const stray = ids.find((id) => !members.has(id) && !found.has(id));
      if (stray !== undefined) throw outside(stray);
      return live(reader, ids, view);
    },
    search: async (query, limit) => {
      const hits = (await reader.search(query, limit)).slice(0, limit);
      for (const hit of hits) found.add(hit.id);
      return hits;
    },
    oriel: options.oriel ?? noThreads,
    show:
      options.show ?? (() => "Oriel shows blocks only in a thread's turn; this one isn't shown."),
    // Each read gets its own, below, which says what it reached.
    overview: async () => {
      throw new Error("only the window chat reads the overview");
    },
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
      // A read that reached any item outside the region, as a namespace read
      // of what search() found can, is the escape hatch too.
      let outsideRegion = entry.outsideRegion;
      // What it reached outside the region, for the escape-hatch block.
      const reached: SearchHit[] = [];
      const own: Host = {
        ...host,
        read: (ids, view) => {
          if (ids.some((id) => !members.has(id))) outsideRegion = true;
          return host.read(ids, view);
        },
        search: async (query, limit) => {
          const hits = await host.search(query, limit);
          reached.push(...hits);
          return hits;
        },
        overview: async () => {
          if (!options.overview) return host.overview();
          const { view, items, reachable = [] } = await options.overview();
          for (const item of items) found.add(item.id);
          for (const id of reachable) joinable.add(id);
          reached.push(...items);
          return view;
        },
      };
      try {
        const value = await entry.run(args, own);
        return { value, outsideRegion, ...(reached.length ? { found: reached } : {}) };
      } catch (error) {
        throw named(fn, error);
      }
    },

    fields(fn) {
      const entry = byPath.get(fn);
      return entry?.kind === "read" ? (entry.fields ?? null) : null;
    },

    capture(fn, args, ref): CapturedMutation {
      const entry = byPath.get(fn);
      if (entry?.kind !== "write") throw new Error(`${JSON.stringify(fn)} isn't a write here`);
      try {
        if (!entry.creates && ref !== null) throw new Error(`only ${makers} names a new item`);
        if (entry.creates && ref !== `new:${nextRef}`)
          throw new Error(`expected ref new:${nextRef}, got ${JSON.stringify(ref)}`);
        if (entry.creates) nextRef += 1;
        const built = entry.build(args, host);
        const checked = entry.spec.args(built.args);
        if (!checked.ok)
          throw new TypeError(checked.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
        if (typeof checked.value !== "object" || checked.value === null)
          throw new TypeError("an op's arguments are an object");
        if (ref !== null) created.set(ref, entry.op);
        return { op: entry.op, target: built.target, ref, args: defined(checked.value) };
      } catch (error) {
        throw named(fn, error);
      }
    },

    intend(fn, args) {
      const entry = byPath.get(fn);
      if (entry?.kind !== "intent") throw new Error(`${JSON.stringify(fn)} isn't an action here`);
      try {
        return intended(entry, args, {
          workstream: region.workstreamId,
          thread: options.thread ?? null,
          reaches: (id) => members.has(id) || found.has(id) || joinable.has(id),
        });
      } catch (error) {
        throw named(fn, error);
      }
    },
  };
}
