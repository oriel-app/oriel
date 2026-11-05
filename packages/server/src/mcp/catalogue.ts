// The MCP door's tools (decisions 0024, 0058), generated, never written per action:
// one for each of Oriel's direct actions open to outside tools, from the
// registry, as the agent's module is; one for each of Oriel's own reads the
// agent's module has; and the two reads of items only this door needs, as
// it has no region. A tool connected to read only lists and calls the reads.
// A person's actions are never offered, as tools or as anything else.
import {
  type ActionDeclaration,
  type ActionName,
  actions,
  type Actor,
  isItemId,
  jsonSchema,
  type JsonSchema,
  type Shape,
  shapeOf,
} from "@oriel/core";
import { agentShapes, type Host, notTheUsers, orielFns, type ReadFn } from "@oriel/bindings";
import { refusal } from "../actions.ts";
import type { Outside } from "./door.ts";
import type { ConnectedTool } from "./tokens.ts";

export type Tool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: false;
  };
  // Whether it changes Oriel's data, which only a tool connected to read
  // and act may.
  acts: boolean;
  call(args: Record<string, unknown>, by: ConnectedTool, outside: Outside): Promise<unknown>;
};

// Who a tool is to the dispatcher and every record: the name the user gave it.
export const actorOf = (tool: ConnectedTool): Actor => ({ kind: "tool", name: tool.name });

// An MCP tool's name for an action: `workstream.remove` is `workstream_remove`,
// as some clients refuse a dot.
export const toolNameOf = (action: string) => action.replace(".", "_");

const objectSchema = (fields: Record<string, Shape>): JsonSchema =>
  jsonSchema({ kind: "object", fields });

// Each direct action open to outside tools, in registry order: the
// dispatcher refuses no tool its class or doors.
const actionTools: Tool[] = (Object.keys(actions) as ActionName[]).flatMap((action) => {
  if (refusal(action, { kind: "tool", name: "any" }) !== null) return [];
  const declared: ActionDeclaration = actions[action];
  const shapes = agentShapes(action);
  const schemas = shapes.map(({ fields }) => objectSchema(fields));
  const inverse = declared.class.kind === "direct" ? declared.class.inverse : null;
  return [
    {
      name: toolNameOf(action),
      description: `${declared.doc} It applies at once${inverse ? ", and the user sees it in Oriel's window as yours, with Undo" : ""}.`,
      inputSchema:
        schemas.length === 1 && schemas[0] ? schemas[0] : { type: "object", anyOf: schemas },
      annotations: {
        readOnlyHint: false,
        destructiveHint: inverse === null,
        idempotentHint: false,
        openWorldHint: false,
      },
      acts: true,
      call: async (args, by, outside) => {
        const { undo: _undo, ...output } = await outside.dispatch.untyped(
          action,
          notTheUsers(action, args),
          actorOf(by),
        );
        return output;
      },
    },
  ];
});

// A read's parameters as one object's fields, by name.
const paramsSchema = (fn: ReadFn): JsonSchema =>
  objectSchema(Object.fromEntries(fn.params.map((p) => [p.name, shapeOf(p.check)])));

// Oriel's own reads, as the agent's module has them. They reach only
// Oriel's reads, never a region, so they take a host of those alone.
const readTools: Tool[] = orielFns.flatMap((fn) =>
  fn.kind === "read" && fn.space !== null
    ? [
        {
          name: `${fn.space}_${fn.name}`,
          description: fn.doc,
          inputSchema: paramsSchema(fn),
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
          acts: false,
          call: (args, _by, outside) =>
            fn.run(
              fn.params.map((p) => args[p.name]),
              { oriel: outside.reads } as unknown as Host,
            ),
        },
      ]
    : [],
);

const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
const searchLimit = (limit: unknown) =>
  Math.min(Math.max(Math.trunc(typeof limit === "number" ? limit : 10), 1), 50);

// What the window holds, from every source: found by key, title or text, and
// one item read live. Only an item the window has is read, never one its
// source has that the user didn't connect Oriel to.
const itemTools: Tool[] = [
  {
    name: "item_search",
    description:
      "Items in the window, from every connected source, by key, title or text words; title hits first.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { ...read, openWorldHint: false },
    acts: false,
    call: async (args, _by, outside) => {
      if (typeof args["query"] !== "string") throw new TypeError("$.query: expected a string");
      return outside.reader.search(args["query"], searchLimit(args["limit"]));
    },
  },
  {
    name: "item_read",
    description: "One item in the window, read live from its source: its title and text.",
    inputSchema: {
      type: "object",
      properties: { item: { type: "string", description: "expected an item ID" } },
      required: ["item"],
      additionalProperties: false,
    },
    annotations: { ...read, openWorldHint: false },
    acts: false,
    call: async (args, _by, outside) => {
      const id = args["item"];
      if (typeof id !== "string" || !isItemId(id) || !outside.indexed(id))
        throw new TypeError("$.item: expected an item the window has");
      return (await outside.reader.read([id]))[0];
    },
  },
];

export const tools: readonly Tool[] = [...readTools, ...itemTools, ...actionTools];
// A client calls a tool by its name alone, so no two share one.
const named = new Set<string>();
for (const tool of tools) {
  if (named.has(tool.name)) throw new Error(`two MCP tools are called ${tool.name}`);
  named.add(tool.name);
}

// The tools a connected tool may list and call.
export const toolsFor = (by: ConnectedTool): readonly Tool[] =>
  by.mode === "act" ? tools : tools.filter((tool) => !tool.acts);
