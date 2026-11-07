// Which kinds are on (decision 0059), and what Oriel found in the person's
// agent to turn one on with. Oriel asks the agent picked in Settings for
// its MCP servers, never its files, when Oriel opens, when the person
// presses sync, every so often if they set that, and when they pick another
// agent; it looks each one up among the source servers the connectors know.
// A kind is on while a person turned it on and a server Oriel knows for it is
// still found, or while it has a connection of its own, until its
// connector's REST connection goes (OA-280), unless a person or the agent
// turned it off. Only a person turns one on. A look that fails says so,
// naming the agent, and leaves what's on as it was.
import {
  type FoundServer,
  type Instant,
  recognize,
  type Recognized,
  type SourceServer,
  type Ulid,
} from "@oriel/core";
import type { FoundChange, FoundKind, KindChoice, SourceKindStore } from "@oriel/db";
import type { SourceServersView } from "@oriel/web/view";
import { ActionError } from "./actions.ts";
import type { Models } from "./model.ts";
import type { Settings } from "./settings.ts";

// What a look at the agent's servers came to: the agent asked, by its
// Settings ID and name, and what it listed, or why it couldn't. Null when
// no agent runs, as with an API key, which has no servers to bring.
export type Discovery =
  | { agent: { id: string; name: string }; found: readonly FoundServer[] }
  | { agent: { id: string; name: string }; problem: string }
  | null;

// How the composition root asks: the CLI Settings' models run threads on.
export const discoverWith =
  (models: Models | undefined) =>
  (settings: Settings): Promise<Discovery> =>
    models ? models.servers(settings) : Promise.resolve(null);

export type SourceServersDeps = {
  store: SourceKindStore;
  workspaceId: Ulid;
  // The servers the connectors know, by kind.
  known: readonly { kind: string; server: SourceServer }[];
  // Each kind that may be on or off, with its name as a person knows it:
  // every declared kind but a stand-in, which is on by its own rule.
  kinds: readonly { kind: string; name: string }[];
  // Whether a kind has a connection of its own: a flag's, or one the window
  // made, open or shut.
  connected(kind: string): boolean;
  // Asks the agent picked in Settings now.
  discover(): Promise<Discovery>;
  // What's on changed: the composition root opens what turned on, closes
  // what turned off, and tells the pages.
  changed(): Promise<void>;
  // A look ended: every page hears, as what it found may have changed.
  heard(): void;
  // How often sync runs, in minutes, or null for when Oriel opens and when
  // the person presses sync; and whether the agent spends the person's
  // plan on it, as Claude Code does.
  sync(): { every: number | null; plan: boolean };
  now(): Instant;
  log(message: string, fields: Record<string, unknown>): void;
};

export type SourceServers = ReturnType<typeof sourceServers>;

const sameKinds = (a: readonly FoundKind[], b: readonly FoundKind[]) =>
  a.length === b.length &&
  a.every((x) => b.some((y) => y.kind === x.kind && y.server === x.server));

const minus = (a: readonly FoundKind[], b: readonly FoundKind[]) =>
  a.filter((x) => !b.some((y) => y.kind === x.kind && y.server === x.server));

export function sourceServers(deps: SourceServersDeps) {
  const { store, workspaceId } = deps;
  // What the last look found that Oriel knows, with each entry it matched;
  // until a look ends, what the one before this start found, as kept.
  let recognized: Recognized[] | null = null;
  let agent: string | null = store.finds(workspaceId)?.agent ?? null;
  let problem: string | null = null;
  let looking: Promise<void> | null = null;
  // The look asked for while one runs, which every later ask joins.
  let queued: Promise<void> | null = null;
  // Once the app closes, a look that ends keeps nothing.
  let closed = false;

  const knownFor = (kind: string) => deps.known.filter((each) => each.kind === kind);
  const found = (): FoundKind[] =>
    recognized
      ? recognized.map(({ kind, found: each }) => ({ kind, server: each.name }))
      : (store.finds(workspaceId)?.found ?? []);
  const choice = (kind: string): KindChoice | undefined => store.choices(workspaceId).get(kind);

  // Whether a kind is on now.
  const on = (kind: string): boolean => {
    const chosen = choice(kind);
    if (chosen?.state === "off") return false;
    if (deps.connected(kind)) return true;
    return chosen?.state === "on" && found().some((each) => each.kind === kind);
  };
  // The kinds on now, in declared order.
  const onKinds = () => deps.kinds.filter(({ kind }) => on(kind)).map(({ kind }) => kind);
  // Kinds a person or the agent turned off, whose surfaces don't show.
  const turnedOff = () =>
    deps.kinds.filter(({ kind }) => choice(kind)?.state === "off").map(({ kind }) => kind);

  const nameOf = (kind: string) => deps.kinds.find((each) => each.kind === kind)?.name ?? kind;
  const knows = (kind: string) => deps.kinds.some((each) => each.kind === kind);

  async function lookNow(): Promise<void> {
    const before = onKinds();
    let discovery: Discovery;
    try {
      discovery = await deps.discover();
    } catch (error) {
      discovery = null;
      deps.log("source servers: the look failed", { error: String(error) });
      problem = "Oriel couldn't ask your agent for its MCP servers. Press Sync to try again.";
    }
    if (closed) return;
    if (discovery !== null && "problem" in discovery) {
      agent = discovery.agent.name;
      problem = `${discovery.agent.name} didn't list its MCP servers: ${discovery.problem}`;
    } else if (discovery !== null) {
      agent = discovery.agent.name;
      problem = null;
      recognized = recognize(discovery.found, deps.known);
      const kept = store.finds(workspaceId);
      const now = found();
      const change: FoundChange = {
        appeared: minus(now, kept?.found ?? []),
        gone: minus(kept?.found ?? [], now),
      };
      const changed = !sameKinds(now, kept?.found ?? []);
      store.keepFinds(
        workspaceId,
        { agent: discovery.agent.id, found: now, card: changed ? change : (kept?.card ?? null) },
        deps.now(),
      );
    }
    const after = onKinds();
    if (before.join() !== after.join()) await deps.changed();
    deps.heard();
  }

  function look(): Promise<void> {
    if (closed) return Promise.resolve();
    if (!looking) {
      looking = lookNow().finally(() => (looking = null));
      return looking;
    }
    queued ??= looking
      .catch(() => {})
      .then(() => {
        queued = null;
        return look();
      });
    return queued;
  }

  return {
    on,
    onKinds,
    turnedOff,
    // A kind a person turned on whose source server went: off until it's
    // back.
    went: (kind: string) => choice(kind)?.state === "on" && !on(kind),
    // Looks again, or joins the look running now.
    // One asked while another runs, as when the person picks another agent,
    // runs once that ends, so it asks the agent picked now; every ask
    // meanwhile joins it.
    look,
    // Starts no look after, and one running keeps nothing when it ends.
    close(): void {
      closed = true;
    },
    // Turns a kind on: through `server`, one Oriel found for it, or, with
    // none, one that was off by choice and has a connection. Gives what it
    // was before, for its Undo.
    async turnOn(kind: string, server: string | undefined): Promise<{ server: string | null }> {
      if (!knows(kind)) throw new ActionError("not-found", `Oriel has no source kind ${kind}.`);
      const via = server ?? found().find((each) => each.kind === kind)?.server ?? null;
      if (
        server !== undefined &&
        !found().some((each) => each.kind === kind && each.server === server)
      )
        throw new ActionError(
          "conflict",
          `${agent ?? "Your agent"} doesn't list a server called ${server} for ${nameOf(kind)} now.`,
        );
      if (via === null && !deps.connected(kind))
        throw new ActionError(
          "conflict",
          `Oriel hasn't found a server for ${nameOf(kind)} in ${agent ?? "your agent"}.`,
        );
      const before = choice(kind);
      store.choose(workspaceId, kind, { state: "on", server: via, by: "person" }, deps.now());
      await deps.changed();
      return { server: before?.server ?? null };
    },
    // Turns a kind off, by the person or the agent. Gives the server it
    // came through, for its Undo.
    async turnOff(kind: string, by: "person" | "agent"): Promise<{ server: string | null }> {
      if (!knows(kind) || !on(kind))
        throw new ActionError("not-found", `${knows(kind) ? nameOf(kind) : kind} isn't on.`);
      const before = choice(kind);
      const server = before?.server ?? null;
      store.choose(workspaceId, kind, { state: "off", server, by }, deps.now());
      await deps.changed();
      return { server };
    },
    dismiss(): void {
      store.dismiss(workspaceId);
    },
    // As Settings, the first run and the overview's card show it.
    view(): SourceServersView {
      const finds = store.finds(workspaceId);
      const listed = found();
      const card = finds?.card ?? null;
      const entry = (kind: string, server: string) => {
        const match = recognized?.find(
          (each) => each.kind === kind && each.found.name === server,
        )?.known;
        return match?.name ?? knownFor(kind)[0]?.server.name ?? server;
      };
      const row = ({ kind, server }: FoundKind) => ({
        kind,
        server,
        known: entry(kind, server),
        on: on(kind),
      });
      const shown = card && {
        appeared: card.appeared.filter((each) => knows(each.kind)).map(row),
        gone: card.gone
          .filter((each) => knows(each.kind))
          .map((each) => ({ ...each, on: on(each.kind) })),
      };
      return {
        agent,
        looking: looking !== null,
        problem,
        found: listed.filter((each) => knows(each.kind)).map(row),
        kinds: deps.kinds.flatMap(({ kind }) => {
          const chosen = choice(kind);
          const via = listed.find((each) => each.kind === kind)?.server ?? null;
          if (!on(kind) && chosen?.state !== "off") return [];
          return [
            {
              kind,
              on: on(kind),
              server: chosen?.server ?? (deps.connected(kind) ? null : via),
              offBy: chosen?.state === "off" ? chosen.by : null,
            },
          ];
        }),
        missing: deps.kinds.flatMap(({ kind }) => {
          const first = knownFor(kind)[0];
          if (!first || on(kind) || listed.some((each) => each.kind === kind)) return [];
          return [{ kind, server: first.server.name, instructions: first.server.instructions }];
        }),
        // Shown while it offers something to turn on or says what went.
        card:
          shown && (shown.appeared.some((each) => !each.on) || shown.gone.length > 0)
            ? shown
            : null,
        sync: deps.sync(),
      };
    },
  };
}
