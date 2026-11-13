// Read through a stand-in of Linear's MCP server in memory, so tests, evals and fixture mode go through the same parser as Linear's own server.
import {
  type FoundServer,
  type ItemId,
  itemId,
  listed,
  type OpenVia,
  type SourceFixture,
  type ThroughServer,
  type ToOpen,
} from "@oriel/core";
import { linearServer } from "./linear-mcp.ts";
import { linearStandIn, standInCaller, standInWorld } from "./linear-standin.ts";
import {
  type LinearContext,
  type LinearScope,
  type LinearWrites,
  openThrough,
  type OpenedLinear,
} from "./open-connection.ts";
import { identifierOf, type LinearWorld, loadLinearWorld, projectKey } from "./world.ts";

const team = "ENG";

export const standInFound: FoundServer = {
  name: "linear",
  status: "connected",
  reports: linearServer.reports,
  url: linearServer.at && "url" in linearServer.at ? linearServer.at.url : null,
  command: null,
  tools: [...linearServer.reads, ...linearServer.writes],
  transport: "http",
};

export function standInServer(world: LinearWorld = standInWorld()): ThroughServer {
  const calls = standInCaller(linearStandIn(world));
  return { known: linearServer, found: standInFound, read: calls, write: calls };
}

const opened = (connection: ToOpen, via: OpenVia): Promise<OpenedLinear> => {
  const world = loadLinearWorld();
  return openThrough(connection, via, via.server ?? standInServer(), world.frozen);
};

const keyOf = (world: LinearWorld) => (name: string) =>
  world.issues.some((each) => identifierOf(world, each) === name) ||
  world.projects.some((each) => projectKey(each.slugId) === name);

export const linearDeclaredFixture: SourceFixture<
  LinearContext | undefined,
  LinearScope,
  LinearWrites
> = {
  load: () => {
    const world = loadLinearWorld();
    const has = keyOf(world);
    const stableIds = new Map<string, string>([
      ...world.issues.map((each) => [`linear:${identifierOf(world, each)}`, each.id] as const),
      ...world.projects.map((each) => [`linear:${projectKey(each.slugId)}`, each.id] as const),
    ]);
    const connect = async () => {
      const open = await opened(
        {
          id: "01JLINEARFIXTURE0000000000" as ToOpen["id"],
          number: 1,
          prefix: "linear",
          identity: "",
          options: { team },
        },
        { log: () => {}, now: () => world.frozen },
      );
      const { records, texts } = await listed(open.source.sync(null));
      return { open, records, texts };
    };
    return {
      edits: 0,
      firstEdit: null,
      regions: world.regions,
      item: (name) =>
        has(name)
          ? { id: itemId("linear", name) }
          : { problem: `no item ${name} in the Linear fixture` },
      stableId: (id) => stableIds.get(id) ?? "",
      chips: () =>
        [
          ...world.projects.map((each) => [projectKey(each.slugId), each.name] as const),
          ...world.issues
            .filter((each) => identifierOf(world, each).startsWith(`${team}-`))
            .map((each) => [identifierOf(world, each), each.title] as const),
        ].map(([key, title]) => [itemId("linear", key), `${key} ${title}`] as const),
      connect: async () => {
        const { open, records, texts } = await connect();
        return {
          records,
          texts,
          read: (ids: readonly ItemId[]) => open.source.read(ids as ItemId<"linear">[]),
          context: open.context(),
          changes: () => [],
          close: () => {},
        };
      },
    };
  },
  connection: () => ({ identity: "", options: { team } }),
  open: opened,
};
