// Oriel asks the agent picked in Settings for its MCP servers, never its files. Only a person turns a kind on;
// a look that fails says so, naming the agent, and leaves what's on as it was.
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

export type Discovery =
  | { agent: { id: string; name: string }; found: readonly FoundServer[] }
  | { agent: { id: string; name: string }; problem: string }
  | null;

export const discoverWith =
  (models: Models | undefined) =>
  (settings: Settings): Promise<Discovery> =>
    models ? models.servers(settings) : Promise.resolve(null);

export type SourceServersDeps = {
  store: SourceKindStore;
  workspaceId: Ulid;
  known: readonly { kind: string; server: SourceServer }[];
  kinds: readonly { kind: string; name: string }[];
  connected(kind: string): boolean;
  discover(): Promise<Discovery>;
  changed(): Promise<void>;
  heard(): void;
  // Minutes; null for when Oriel opens and when the person presses sync.
  sync(): { every: number | null };
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
  let recognized: Recognized[] | null = null;
  let agent: string | null = store.finds(workspaceId)?.agent ?? null;
  let problem: string | null = null;
  // Whether the last look found no AI to ask: nothing it listed before is
  // said to be found now.
  let noAgent = false;
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

  // Never another found for the kind, though it report the same name: it would feed the kind unasked.
  const through = (kind: string): string | null => {
    const chosen = choice(kind);
    if (chosen?.state !== "on" || chosen.server === null) return null;
    return found().some((each) => each.kind === kind && each.server === chosen.server)
      ? chosen.server
      : null;
  };
  const on = (kind: string): boolean => {
    const chosen = choice(kind);
    if (chosen?.state === "off") return false;
    if (deps.connected(kind)) return true;
    return through(kind) !== null;
  };
  const onKinds = () => deps.kinds.filter(({ kind }) => on(kind)).map(({ kind }) => kind);
  const turnedOff = () =>
    deps.kinds.filter(({ kind }) => choice(kind)?.state === "off").map(({ kind }) => kind);

  const nameOf = (kind: string) => deps.kinds.find((each) => each.kind === kind)?.name ?? kind;
  const knows = (kind: string) => deps.kinds.some((each) => each.kind === kind);

  // What its sync and replay start, and nothing else.
  function serverFor(kind: string): Recognized | null {
    const name = through(kind);
    return recognized?.find((each) => each.kind === kind && each.found.name === name) ?? null;
  }
  const state = () =>
    JSON.stringify(
      onKinds().map((kind) => {
        const at = serverFor(kind)?.found;
        return [kind, at ? [at.name, at.url, at.command, [...at.tools]] : null];
      }),
    );

  async function lookNow(): Promise<void> {
    const before = state();
    let discovery: Discovery;
    let failed = false;
    try {
      discovery = await deps.discover();
    } catch (error) {
      discovery = null;
      failed = true;
      deps.log("source servers: the look failed", { error: String(error) });
      problem = "Oriel couldn't ask your agent for its MCP servers. Press Sync to try again.";
    }
    if (closed) return;
    noAgent = discovery === null && !failed;
    if (noAgent) {
      agent = null;
      problem = null;
    }
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
    if (before !== state()) await deps.changed();
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
    serverFor,
    turnedOff,
    went: (kind: string) => choice(kind)?.state === "on" && !on(kind),
    // One asked while another runs runs once that ends, so it asks the agent picked now; every ask meanwhile joins it.
    look,
    close(): void {
      closed = true;
    },
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
        noAgent,
        // With no AI to ask, nothing is found now, whatever one listed before.
        found: noAgent ? [] : listed.filter((each) => knows(each.kind)).map(row),
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
          const unlisted = noAgent
            ? choice(kind)?.state !== "off"
            : !listed.some((each) => each.kind === kind);
          if (!first || on(kind) || !unlisted) return [];
          return [{ kind, server: first.server.name, instructions: first.server.instructions }];
        }),
        card:
          !noAgent && shown && (shown.appeared.some((each) => !each.on) || shown.gone.length > 0)
            ? shown
            : null,
        sync: deps.sync(),
      };
    },
  };
}
