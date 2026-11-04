// Connections a person makes in the window (decision 0049), the same way for
// every connector: what they gave across its steps, checked by its declared
// validator; what it identifies, before anything reaches the source; then
// its own server half makes it, and the server's one loop over connections
// (`Opening`) opens it, syncs it in full and keeps it only once both worked.
// The server makes every connection's ID: the page only names a kind and
// what the person typed. Nothing here knows a source.
import {
  type ConnectRefusal,
  type ConnectVia,
  type Log,
  type PickChoice,
  type SourceKind,
  type ToOpen,
  type Validator,
} from "@oriel/core";
import type { Connection } from "@oriel/db";
import { jiraSite } from "@oriel/jira";
import { declarationOf } from "@oriel/sources";
import type { FirstRunView } from "@oriel/web/view";
import { ActionError } from "./actions.ts";
import { type LegacyJira, parsedLegacy } from "./connection.ts";
import type { Connections } from "./connections.ts";
import { inWindow, type SourceModes } from "./modes.ts";

// What the server's loop over connections offers the window's connects.
export type Opening = {
  connections: Connections;
  // Whether a kind has a connection open now, as the server opens one of
  // each for now.
  open(kind: SourceKind): boolean;
  // Connects what a person made, taking turns with the kind's syncs: opened,
  // synced in full, and kept only once both worked. The same thing as the
  // kind's open connection is synced again instead. `replaces`: it takes
  // the place of the kind's open connection. `counting` hears how many
  // records each page of its first sync read. `signedIn`: a live one,
  // signed in again, keeping its number and items.
  connect(
    kind: SourceKind,
    made: { identity: string; options: Record<string, unknown>; secret?: string },
    how?: { replaces?: boolean; counting?: (records: number) => void },
  ): Promise<
    | { connection: Connection; signedIn: boolean }
    | { failed: "open" | "sync" | "keep"; error: unknown }
  >;
};

// What a connect gave: the connection kept, or why not, in the person's
// words, with the fields it is about.
export type Connected = { connection: Connection; signedIn: boolean } | ConnectRefusal;

const notHere = (name: string) => `${name} can't be connected from this window.`;

export function connecting(deps: {
  modes: SourceModes;
  // Any account or site may be connected, as on the desktop app.
  anywhere: boolean;
  opening: Opening;
  log: Log;
}) {
  const { modes, opening, log } = deps;
  const { connections } = opening;
  const viaFor = (kind: SourceKind): ConnectVia => {
    const send = modes[kind]?.fetch;
    return { anywhere: deps.anywhere, log, ...(send ? { fetch: send } : {}) };
  };
  // A kind's connector, if the window connects it: one declared with steps,
  // in window mode.
  const connector = (kind: SourceKind) => {
    const declaration = declarationOf(kind);
    if (!declaration) throw new ActionError("not-found", "no such connector");
    if (!declaration.connect || !inWindow(modes, kind))
      return { declaration, connect: null } as const;
    return { declaration, connect: declaration.connect } as const;
  };
  const check = <T>(validator: Validator<T>, raw: unknown): T => {
    const decoded = validator(raw);
    if (!decoded.ok)
      throw new ActionError(
        "invalid",
        decoded.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
      );
    return decoded.value;
  };
  // A kind opens only its first connection for now (OA-225): another thing
  // than the one its live connection has, or than one disconnected before,
  // is refused, unless it replaces the kind's open one.
  const another = (kind: SourceKind, identity: string): ConnectRefusal | null => {
    const { connect } = connector(kind);
    if (!connect || connect.replaces) return null;
    const existing = connections.first(kind);
    if (existing)
      return existing.identity === identity ? null : connect.taken(existing.identity, true);
    const plan = connections.planned(kind, identity);
    const number = "revives" in plan ? plan.revives.number : "number" in plan ? plan.number : 1;
    if (number === 1) return null;
    // Disconnected since: the kind's first is the one it opens.
    const first = connections.list().find((each) => each.kind === kind && each.number === 1);
    return connect.taken(first?.identity ?? identity, false);
  };
  // Why the window can't connect a kind now: it doesn't, or one is open
  // that a new one wouldn't replace.
  const refused = (kind: SourceKind): ConnectRefusal | null => {
    const { declaration, connect } = connector(kind);
    if (!connect) return { problem: notHere(declaration.name) };
    if (opening.open(kind) && !connect.replaces)
      return { problem: `${declaration.name} is already connected to this window.` };
    return null;
  };

  // The first sync of what the person connected last, while it reads, and
  // after it stopped, until the next connect or one that worked.
  let reading: (NonNullable<FirstRunView["reading"]> & { kind: SourceKind }) | null = null;

  return {
    // Whether the window may connect a kind now, and why not.
    connectable: (kind: SourceKind): boolean => refused(kind) === null,
    why: (kind: SourceKind): string | null => refused(kind)?.problem ?? null,

    // How a kind's connections reach its source, for opening one.
    viaFor,

    reading: (): FirstRunView["reading"] =>
      reading && {
        project: reading.project,
        read: reading.read,
        total: reading.total,
        stopped: reading.stopped,
      },

    // Connects what the person gave across a connector's steps: checked,
    // identified, made by the connector, then opened, synced and kept.
    async connect(kind: SourceKind, raw: unknown): Promise<Connected> {
      const no = refused(kind);
      if (no) return no;
      const { connect } = connector(kind);
      if (!connect) return { problem: notHere(kind) };
      const given = check(connect.given, raw);
      const via = viaFor(kind);
      const identity = await connect.identify(given, via);
      if (typeof identity !== "string") return identity;
      const taken = another(kind, identity);
      if (taken) return taken;
      const made = await connect.make(given, identity, via);
      if ("problem" in made) return made;
      const progress = made.reading && {
        kind,
        project: made.reading.name,
        read: 0,
        total: made.reading.total,
        stopped: false,
      };
      if (progress) reading = progress;
      const kept = await opening.connect(
        kind,
        {
          identity,
          options: made.options,
          ...(made.secret === undefined ? {} : { secret: made.secret }),
        },
        {
          ...(connect.replaces ? { replaces: true } : {}),
          ...(progress ? { counting: (records: number) => (progress.read += records) } : {}),
        },
      );
      if ("failed" in kept) {
        if (progress) progress.stopped = true;
        if (kept.failed === "keep") {
          log("connections: one couldn't be kept", {
            kind,
            error: (kept.error as NodeJS.ErrnoException).code ?? "",
          });
          return { problem: "Oriel couldn't save the connection on this computer. Try again." };
        }
        log("connections: one couldn't connect", {
          kind,
          failed: kept.failed,
          error: String(kept.error),
        });
        return { problem: connect.failed[kept.failed] };
      }
      if (progress && reading === progress) reading = null;
      log("connections: connected", { kind, number: kept.connection.number });
      return kept;
    },

    // A pick step's list, from what the steps before it gave, before
    // anything is connected. Nothing is kept.
    async pick(
      kind: SourceKind,
      raw: unknown,
      query: string,
    ): Promise<{ choices: PickChoice[]; more: boolean } | ConnectRefusal> {
      const no = refused(kind);
      if (no) return { fields: [], ...no };
      const { connect } = connector(kind);
      if (!connect?.pick) throw new ActionError("not-found", "it has no list to pick from");
      const given = check(connect.pick.given, raw);
      const via = viaFor(kind);
      const identity = await connect.identify(given, via);
      if (typeof identity !== "string") return identity;
      const taken = another(kind, identity);
      if (taken) return taken;
      return connect.pick.list(given, identity, query, via);
    },

    // A pick step's list again, for a connection it made, from its own
    // identity and secret, so Settings can pick again. The page names only
    // the connection; its secret stays here.
    async choices(
      connection: Connection,
      query: string,
    ): Promise<{ choices: PickChoice[]; more: boolean } | ConnectRefusal> {
      const declaration = declarationOf(connection.kind);
      const pick = declaration?.connect?.pick;
      if (!declaration || !pick?.from)
        throw new ActionError("not-found", "it has no list to pick from");
      const secret = await connections.secret(connection);
      const given = pick.from({ ...connection, secret });
      if (given === null)
        return { problem: `Sign in to ${declaration.name} again first.`, fields: [] };
      return pick.list(given, connection.identity, query, viaFor(connection.kind));
    },

    // A kind's folder step, for the system's folder picker: the field it
    // fills and what the picker asks. Null when it has none, or the window
    // doesn't connect it now.
    folderStep(kind: SourceKind): { field: string; prompt: string } | null {
      const { connect } = connector(kind);
      const step = connect?.steps.find((each) => each.kind === "folder");
      return step?.kind === "folder" ? { field: step.field, prompt: step.prompt } : null;
    },

    // Whether a kept connection opens at start, as its connector vets it.
    async vet(connection: Connection, secret: string | null): Promise<boolean> {
      const connect = declarationOf(connection.kind)?.connect;
      const toOpen: ToOpen = { ...connection, secret };
      return connect?.vet ? connect.vet(toOpen, viaFor(connection.kind)) : true;
    },
  };
}

// Jira's saved connection from before connections (decision 0049) moves
// into one, its kind's first, with its account as the secret, and the old one
// is deleted. One that can't be read is left, and logged; a move that fails
// leaves it for the next start. Never a value in a log line.
export async function moveLegacy(
  connections: Connections,
  legacy: LegacyJira,
  log: Log,
): Promise<void> {
  let text: string | null;
  try {
    text = await legacy.load();
  } catch {
    log("jira: the saved connection couldn't be read", {});
    return;
  }
  if (text === null) return;
  const saved = parsedLegacy(text);
  const site = saved && jiraSite(saved.site);
  if (!saved || !site) {
    log("jira: the saved connection isn't one Oriel can read", {});
    return;
  }
  try {
    // One a start before moved, and couldn't delete the old one after, is
    // kept as it is.
    if (!connections.first("jira"))
      await connections.connect({
        kind: "jira",
        identity: site,
        options: { project: saved.project },
        secret: JSON.stringify({ email: saved.email, token: saved.token }),
      });
    await legacy.delete();
    log("jira: the saved connection moved", {});
  } catch {
    log("jira: the saved connection couldn't move", {});
  }
}
