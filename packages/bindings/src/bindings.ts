import {
  type Bindings,
  type CapturedMutation,
  type ChallengeRun,
  type ItemId,
  type NewRef,
  noThreads,
  type OrielReads,
  type PreviewTable,
  type Reader,
  type Region,
  type SearchHit,
  type Shown,
  type Ulid,
} from "@oriel/core";
import { intended } from "./actions.ts";
import type { Waiting } from "./drafts.ts";
import { describe, type Fn, type ItemDocs, type Namespaces, pathOf, scopeOf } from "./describe.ts";
import { declarations } from "./dts.ts";
import { type Host, live, outside } from "./fn.ts";
import { shimFor } from "./shim.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Errors name the function, so the agent can find the call that failed.
function named(path: string, error: unknown): Error {
  return new Error(`${path}: ${message(error)}`, { cause: error });
}

const notShown = (what: string) =>
  `Oriel shows ${what} only in a thread's turn; this one isn't shown.`;

const defined = (args: object) =>
  Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));

// Writes are captured, never sent: a write must target a region item from its own source or a story an earlier
// create in this run made, and its arguments must pass that source's op catalogue.
export function bindingsFor(
  region: Region,
  options: {
    reader: Reader;
    namespaces: Namespaces;
    items?: ItemDocs;
    oriel?: OrielReads;
    thread?: Ulid;
    shown?: Shown;
    // `reachable`: items an action in the run may take, as Make a workstream does, though none of them can be read.
    overview?: () => Promise<{ view: unknown; items: SearchHit[]; reachable?: readonly string[] }>;
    waiting?: Waiting;
    // Items the messages were about outside the region: a run may read them, read-only.
    looking?: readonly string[];
    history?: (of: string | null) => Promise<unknown>;
    challenge?: ChallengeRun;
    revise?: (id: string) => Promise<string>;
  },
): Bindings {
  const scope = scopeOf(region, options.namespaces, options.items, options.looking);
  const { waiting } = options;
  const fns = describe(scope, {
    window: options.overview !== undefined,
    ...(waiting ? { waiting } : {}),
    challenge: options.challenge !== undefined,
  });
  const byPath = new Map<string, Fn>(fns.map((fn) => [pathOf(fn), fn]));
  const members = new Set<string>(scope.ids);
  const created = new Map<NewRef, string>();
  const { reader } = options;
  const creates = fns.flatMap((fn) => (fn.kind === "write" && fn.creates ? [pathOf(fn)] : []));
  const makers = creates.length ? creates.join(" or ") : "a create";
  // A namespace may read these too, and nothing else outside the region: the host refuses before any adapter
  // code sees the ID, whatever the adapter checks itself.
  const found = new Set<string>(scope.looked);
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
    show: options.shown?.show ?? (() => notShown("blocks")),
    sketch: options.shown?.sketch ?? (() => notShown("sketches")),
    ...(options.challenge ? { challenge: options.challenge } : {}),
    ...(options.revise ? { revise: options.revise } : {}),
    reaches: (id) => members.has(id) || found.has(id),
    overview: async () => {
      throw new Error("only the window chat reads the overview");
    },
    preview: async () => {
      throw new Error("only the window chat reads a waiting connection's preview");
    },
    history: async (of) => {
      if (!options.history) throw new Error("Oriel keeps no change log here");
      return options.history(of);
    },
  };
  // Every correctly numbered create uses one up, so a rejected create can't shift the numbering of later ones.
  let nextRef = 1;

  return {
    dts: declarations(scope, fns, waiting),
    shim: shimFor(fns, scope.spaces),

    async read(fn, args) {
      const entry = byPath.get(fn);
      if (entry?.kind !== "read") throw new Error(`${JSON.stringify(fn)} isn't a read here`);
      // A namespace read that reached outside the region, as one of what search() found can, is the escape hatch too.
      let outsideRegion = entry.outsideRegion;
      const reached: SearchHit[] = [];
      const previewed: PreviewTable[] = [];
      const own: Host = {
        ...host,
        read: (ids, view) => {
          if (ids.some((id) => !members.has(id))) outsideRegion = true;
          return host.read(ids, view);
        },
        // The block shows the hits, never an excerpt.
        search: async (query, limit) => {
          const hits = await host.search(query, limit);
          reached.push(
            ...hits.map(({ id, title, location, updatedAt }) => ({
              id,
              title,
              location,
              updatedAt,
            })),
          );
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
        preview: async () => {
          if (!waiting) return host.preview();
          const connections = await waiting.preview();
          previewed.push(...connections.flatMap((each) => each.tables));
          return connections;
        },
      };
      try {
        const value = await entry.run(args, own);
        return {
          value,
          outsideRegion,
          ...(reached.length ? { found: reached } : {}),
          ...(previewed.length ? { preview: previewed } : {}),
        };
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
        return {
          op: entry.op,
          target: built.target,
          ref,
          args: defined(checked.value),
          // A create writes to its namespace's kind, which a shared op can't say.
          ...(entry.creates && built.target === null && entry.space !== null
            ? { into: entry.space }
            : {}),
        };
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

    draft(fn, args) {
      const entry = byPath.get(fn);
      if (entry?.kind !== "draft" || (entry.space === "source" && !waiting))
        throw new Error(`${JSON.stringify(fn)} isn't a draft here`);
      try {
        const drafted = intended(entry, args, {
          workstream: region.workstreamId,
          thread: options.thread ?? null,
          reaches: () => false,
        });
        if (waiting && entry.space === "source") return waiting.check(drafted);
        // Only an item the user chose: one their messages were about, or one in the region, never one a read found,
        // which synced text could have steered it to.
        const item = drafted.input["item"];
        if (
          typeof item !== "string" ||
          !(members.has(item) || scope.looked.includes(item as never))
        )
          throw new RangeError(
            `${JSON.stringify(item)} isn't an item the user's message was about`,
          );
        return drafted;
      } catch (error) {
        throw named(fn, error);
      }
    },
  };
}
