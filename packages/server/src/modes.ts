import type { SourceKind } from "@oriel/core";
import { declarationOf, sourceKinds } from "@oriel/sources";

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

export const inWindow = (modes: SourceModes, kind: SourceKind): boolean =>
  modes[kind] === undefined
    ? declarationOf(kind)?.connect !== undefined
    : modes[kind].mode === "window";

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

// One per set of modes, so fixture and real connections never share one.
export function databaseName(modes: Readonly<Record<SourceKind, string>>): string {
  const set = Object.entries(modes).toSorted(([a], [b]) => a.localeCompare(b));
  const [first] = new Set(set.map(([, mode]) => mode));
  if (set.length > 0 && set.every(([, mode]) => mode === first)) return first ?? "";
  return set.map(([kind, mode]) => `${kind}-${mode}`).join("+");
}

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
