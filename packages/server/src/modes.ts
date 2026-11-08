// How each connector's connections are made (decision 0049): by a flag at
// start, as its fixture, or by the person in the window, as the folder's;
// and, since decision 0059, through a source server a person turns on.
// `pnpm dev`'s `--source <kind>=<mode>` gives each kind its mode, and tests
// give the same. A flag's connection is its kind's first, opened through
// its fixture's over the fixture's stand-in, and made again at every start.
// It keeps no secret: a fixture needs none.
import type { SourceKind } from "@oriel/core";
import { declarationOf, sourceKinds } from "@oriel/sources";

// A kind's mode. The fixture is its synthetic data, as its declaration
// loads it. Memory is a site of the source in memory that a test, a shot or
// a timing made, by its own `fetch`, read and written through the
// fixture's in-memory transport, with what it identifies and its options,
// so a sync sees what changed there. From the window is the person
// connecting it there, as the folder; the connection is kept, so it's there
// again the next time the server starts. A fixture's `fetch` is for tests,
// which answer from memory, and a fixture's stand-in they made, so they can
// act in the source as others do.
export type SourceMode =
  | { mode: "fixture"; fetch?: typeof fetch }
  | {
      mode: "memory";
      identity: string;
      options: Record<string, unknown>;
      fetch: typeof fetch;
    }
  | { mode: "window" };

export type SourceModes = Readonly<Partial<Record<SourceKind, SourceMode>>>;

// Whether the window makes a kind's connections: when its mode says so, or
// when it has none and its connector declares how, as the folder's.
export const inWindow = (modes: SourceModes, kind: SourceKind): boolean =>
  modes[kind] === undefined
    ? declarationOf(kind)?.connect !== undefined
    : modes[kind].mode === "window";

// A connection a flag makes: its kind, whether it's the kind's fixture or a
// site in memory, what it identifies, its options, and how requests reach
// it.
export type Flagged = {
  kind: SourceKind;
  how: "fixture" | "memory";
  identity: string;
  options: Record<string, unknown>;
  fetch?: typeof fetch;
};

export function flagged(modes: SourceModes): Flagged[] {
  return Object.entries(modes).flatMap(([kind, given]): Flagged[] => {
    if (!given || given.mode === "window") return [];
    if (given.mode === "memory")
      return [
        {
          kind,
          how: "memory",
          identity: given.identity,
          options: given.options,
          fetch: given.fetch,
        },
      ];
    const declaration = declarationOf(kind);
    if (!declaration) throw new Error(`no source declares ${kind}`);
    const send = given.fetch ? { fetch: given.fetch } : {};
    return [{ kind, how: "fixture", ...declaration.fixture.connection(), ...send }];
  });
}

// `pnpm dev`'s database for a set of modes, by its name: one per set, so
// fixture and real connections never share one. A kind turned on through
// its source server at start (`--on <kind>`) is `live`, as its own
// connection was before decision 0059, so the database it was kept in
// opens, with its connection, items and options. A set whose modes are all
// one keeps that one's name; any other is named for each kind's mode.
export function databaseName(modes: Readonly<Record<SourceKind, string>>): string {
  const set = Object.entries(modes).toSorted(([a], [b]) => a.localeCompare(b));
  const [first] = new Set(set.map(([, mode]) => mode));
  if (set.length > 0 && set.every(([, mode]) => mode === first)) return first ?? "";
  return set.map(([kind, mode]) => `${kind}-${mode}`).join("+");
}

// What `pnpm dev`'s flags ask for: each kind's mode, from `--source
// <kind>=fixture|window`; the kinds `--on <kind>` turns on through their
// source servers at start, as a person's click in Settings does (decision
// 0059); and the database they name. Jira is its fixture unless a flag
// names it. Or why the flags can't be, naming the flag.
export function devModes(
  source: readonly string[],
  on: readonly string[],
):
  | {
      modes: Record<SourceKind, { mode: "fixture" | "window" }>;
      on: SourceKind[];
      database: string;
    }
  | { problem: string } {
  const modes: Record<SourceKind, { mode: "fixture" | "window" }> = {};
  const unknown = (kind: string, flag: string) =>
    `${flag}: no connector is called ${kind}; there are ${sourceKinds.join(", ")}`;
  for (const each of source) {
    const [, kind = "", mode = ""] = /^([a-z][a-z0-9]*)=([a-z]+)$/.exec(each) ?? [];
    if (!kind)
      return { problem: `--source takes <kind>=fixture|window, got ${JSON.stringify(each)}` };
    const declaration = declarationOf(kind);
    if (!declaration) return { problem: unknown(kind, "--source") };
    if (modes[kind]) return { problem: `--source: ${kind}'s mode is given twice` };
    if (!(mode === "fixture" || mode === "window") || (mode === "window" && !declaration.connect))
      return { problem: `--source: ${declaration.name} can't be ${mode}` };
    modes[kind] = { mode };
  }
  const turned = [...new Set(on)];
  for (const kind of turned) {
    const declaration = declarationOf(kind);
    if (!declaration) return { problem: unknown(kind, "--on") };
    if (!declaration.servers?.length)
      return { problem: `--on: ${declaration.name} has no source server to turn on through` };
    if (modes[kind]) return { problem: `--on: ${declaration.name} can't have --source too` };
  }
  if (!modes.jira && !turned.includes("jira")) modes.jira = { mode: "fixture" };
  return {
    modes,
    on: turned,
    database: databaseName({
      ...Object.fromEntries(Object.entries(modes).map(([kind, given]) => [kind, given.mode])),
      ...Object.fromEntries(turned.map((kind) => [kind, "live"])),
    }),
  };
}
