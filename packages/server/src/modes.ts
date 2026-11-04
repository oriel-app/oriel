// How each connector's connections are made (decision 0049): by a flag at
// start, as its fixture or live, or by the person in the window. `pnpm dev`'s
// `--source <kind>=<mode>` gives each kind its mode, and tests give the same.
// A flag's connection is its kind's first, opened through its declaration's
// `open`, or its fixture's over the fixture's stand-in, and made again at
// every start. It keeps no secret: `.env` holds that, and a fixture needs
// none.
import type { SourceKind } from "@oriel/core";
import { declarationOf } from "@oriel/sources";

// A kind's mode. The fixture is its synthetic data, as its declaration
// loads it. Live is the source itself, as a flag names it: what it
// identifies, its options and its secret, such as Jira's throwaway site,
// project and account from `.env`. From the window is live too, once the
// person connects it there; the connection is kept, so it's there again
// the next time the server starts. `fetch` is for tests, which answer from
// memory, and a fixture's stand-in they made, so they can act in the
// source as others do; the global fetch is used without it.
export type SourceMode =
  | { mode: "fixture"; fetch?: typeof fetch }
  | {
      mode: "live";
      identity: string;
      options: Record<string, unknown>;
      secret: string | null;
      fetch?: typeof fetch;
    }
  | { mode: "window"; fetch?: typeof fetch };

export type SourceModes = Readonly<Partial<Record<SourceKind, SourceMode>>>;

// Whether the window makes a kind's connections: when its mode says so, or
// when it has none and its connector declares how.
export const inWindow = (modes: SourceModes, kind: SourceKind): boolean =>
  modes[kind] === undefined
    ? declarationOf(kind)?.connect !== undefined
    : modes[kind].mode === "window";

// A connection a flag makes: its kind, whether it's the kind's fixture, what
// it identifies, its options and its secret, and how requests reach it.
// Slack's identity is the workspace its token is for, which opening finds.
export type Flagged = {
  kind: SourceKind;
  fixture: boolean;
  identity: string;
  options: Record<string, unknown>;
  secret: string | null;
  fetch?: typeof fetch;
};

export function flagged(modes: SourceModes): Flagged[] {
  return Object.entries(modes).flatMap(([kind, given]): Flagged[] => {
    if (!given || given.mode === "window") return [];
    const send = given.fetch ? { fetch: given.fetch } : {};
    if (given.mode === "live")
      return [
        {
          kind,
          fixture: false,
          identity: given.identity,
          options: given.options,
          secret: given.secret,
          ...send,
        },
      ];
    const declaration = declarationOf(kind);
    if (!declaration) throw new Error(`no source declares ${kind}`);
    return [{ kind, fixture: true, ...declaration.fixture.connection(), secret: null, ...send }];
  });
}

// `pnpm dev`'s database for a set of modes, by its name: one per set, so
// fixture, `.env` and window connections never share one. A set whose modes
// are all one, as `--source jira=live` alone or with `--source slack=live`,
// keeps the file it had before decision 0049; any other is named for each
// kind's mode.
export function databaseName(modes: Readonly<Record<SourceKind, string>>): string {
  const set = Object.entries(modes).toSorted(([a], [b]) => a.localeCompare(b));
  const [first] = new Set(set.map(([, mode]) => mode));
  if (set.length > 0 && set.every(([, mode]) => mode === first)) return first ?? "";
  return set.map(([kind, mode]) => `${kind}-${mode}`).join("+");
}
