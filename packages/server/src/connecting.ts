// Connections a person makes in the window (decision 0049), which since
// decision 0059 only the folder's connector declares: what they gave across
// its steps, checked by its declared validator; what it identifies, before
// anything reaches the source; then its own server half makes it, and the
// server's one loop over connections (`Opening`) opens it, syncs it in full
// and keeps it only once both worked. A new one takes the place of the
// kind's open one, as another folder picked does. The server makes every
// connection's ID: the page only names a kind and what the person gave.
// Nothing here knows a source.
import {
  type ConnectRefusal,
  type ConnectVia,
  type Log,
  type SourceKind,
  type Validator,
} from "@oriel/core";
import type { Connection } from "@oriel/db";
import { declarationOf } from "@oriel/sources";
import { ActionError } from "./actions.ts";
import type { Connections } from "./connections.ts";
import { inWindow, type SourceModes } from "./modes.ts";

// What the server's loop over connections offers the window's connects.
export type Opening = {
  connections: Connections;
  // Connects what a person made, taking turns with the kind's syncs: opened,
  // synced in full, and kept only once both worked, in the place of the
  // kind's open connection. The same thing as the kind's open connection is
  // synced again instead.
  connect(
    kind: SourceKind,
    made: { identity: string; options: Record<string, unknown> },
  ): Promise<{ connection: Connection } | { failed: "open" | "sync" | "keep"; error: unknown }>;
};

// What a connect gave: the connection kept, or why not, in the person's
// words, with the fields it is about.
export type Connected = { connection: Connection } | ConnectRefusal;

const notHere = (name: string) => `${name} can't be connected from this window.`;

export function connecting(deps: { modes: SourceModes; opening: Opening; log: Log }) {
  const { modes, opening, log } = deps;
  const via: ConnectVia = { log };
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
  // Why the window can't connect a kind: it doesn't.
  const refused = (kind: SourceKind): ConnectRefusal | null => {
    const { declaration, connect } = connector(kind);
    return connect ? null : { problem: notHere(declaration.name) };
  };

  return {
    // Whether the window may connect a kind now, and why not.
    connectable: (kind: SourceKind): boolean => refused(kind) === null,
    why: (kind: SourceKind): string | null => refused(kind)?.problem ?? null,

    // Connects what the person gave across a connector's steps: checked,
    // identified, made by the connector, then opened, synced and kept.
    async connect(kind: SourceKind, raw: unknown): Promise<Connected> {
      const no = refused(kind);
      if (no) return no;
      const { connect } = connector(kind);
      if (!connect) return { problem: notHere(kind) };
      const given = check(connect.given, raw);
      const identity = await connect.identify(given, via);
      if (typeof identity !== "string") return identity;
      const made = await connect.make(given, identity, via);
      if ("problem" in made) return made;
      const kept = await opening.connect(kind, { identity, options: made.options });
      if ("failed" in kept) {
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
      log("connections: connected", { kind, number: kept.connection.number });
      return kept;
    },

    // A kind's folder step, for the system's folder picker: the field it
    // fills and what the picker asks. Null when it has none, or the window
    // doesn't connect it now.
    folderStep(kind: SourceKind): { field: string; prompt: string } | null {
      const { connect } = connector(kind);
      const step = connect?.steps.find((each) => each.kind === "folder");
      return step?.kind === "folder" ? { field: step.field, prompt: step.prompt } : null;
    },
  };
}
