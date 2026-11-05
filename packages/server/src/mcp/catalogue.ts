// The MCP door's tools (decision 0024), generated, never written per action:
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
import {
  decodeCursor,
  encodeCursor,
  type Later,
  type ThreadNews,
  threadNews,
  waitForNews,
} from "./threads.ts";
import type { ConnectedTool } from "./tokens.ts";

// What a call reaches besides the app: where the window is, for links, and
// whether the client left, which ends a wait.
export type CallContext = { window: URL; signal?: AbortSignal; later?: Later };

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
  call(
    args: Record<string, unknown>,
    by: ConnectedTool,
    outside: Outside,
    context: CallContext,
  ): Promise<unknown>;
  // Oriel's own words on what a call's result means and what to do next,
  // before the result; never anything a person, a source or the agent wrote.
  told?(result: unknown, by: ConnectedTool): string;
};

// What a program is told of a thread, by what it waits on.
const toldNews = (news: unknown): string => {
  const { waitingOn, heard, timedOut } = news as ThreadNews & { timedOut?: boolean };
  const replied = heard.some((each) => each.kind === "reply" && each.to === "you");
  const lead = timedOut
    ? "Nothing new yet."
    : replied
      ? "The agent answered you."
      : heard.length
        ? "Here is what happened."
        : "Nothing new.";
  if (waitingOn.startsWith("nobody"))
    return `${lead} The thread waits on ${waitingOn}, and nothing more happens in it unless someone says something.`;
  return `${lead} The thread waits on ${waitingOn}. A person may take hours: call thread_wait again with this cursor, or end your work and come back later with the thread's ID and cursor.`;
};

// What a program is told when it said something in a thread.
const toldSaid = (result: unknown, by: ConnectedTool): string => {
  const said = result as { started?: true; held?: true; why?: string };
  if (said.started)
    return `Your words started a turn in the thread, shown in Oriel's window as ${by.name}'s. Call thread_wait with this cursor to hear the agent's answer. Only the user approves a change set it proposes.`;
  return `Your words wait in the thread for the user: ${said.why ?? "they send them on"}. They send them on, edit them, or discard them in Oriel's window, which may take hours. Call thread_wait with this cursor to hear what becomes of them.`;
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
      description: `${declared.doc} It applies at once, and the user sees it in Oriel's window as yours${inverse ? ", with Undo" : ""}.`,
      inputSchema:
        schemas.length === 1 && schemas[0] ? schemas[0] : { type: "object", anyOf: schemas },
      annotations: {
        readOnlyHint: false,
        destructiveHint: inverse === null,
        idempotentHint: false,
        openWorldHint: false,
      },
      acts: true,
      call: async (args, by, outside, { window }) => {
        // Where the thread stood before the words, so a wait from it hears
        // what they started.
        const thread = action === "thread.say" && typeof args["thread"] === "string";
        const before = thread
          ? await threadNews(outside, window, args["thread"] as never, by, decodeCursor(null))
          : null;
        const { undo: _undo, ...output } = await outside.dispatch.untyped(
          action,
          notTheUsers(action, args),
          actorOf(by),
        );
        const opened = action === "thread.open" && (output as { thread?: string }).thread;
        return {
          ...output,
          ...(before ? { cursor: before.cursor } : {}),
          ...(opened ? { link: new URL(`threads/${opened}`, window).href } : {}),
        };
      },
      ...(action === "thread.say"
        ? { told: toldSaid }
        : action === "thread.open"
          ? {
              told: () =>
                "The thread is open, and empty. Say what you ask in it with thread_say: the user sees your words in Oriel's window under your name.",
            }
          : {}),
    },
  ];
});

const maxWaitSeconds = 600;

// A thread as a program hears it: what happened since its cursor, waiting
// for news up to `seconds` (the mcp-agents spike).
const waitTool: Tool = {
  name: "thread_wait",
  description: `What happened in a thread since \`after\`, a cursor an earlier thread_say or thread_wait gave you: who asked what, the agent's answer to each turn once it ends, each change set and the user's decision on it, and what the thread waits on now. Waits up to \`seconds\` (default 50, at most ${maxWaitSeconds}) for news. Without \`after\`, it answers at once with the thread so far.`,
  inputSchema: {
    type: "object",
    properties: {
      thread: { type: "string", description: "expected a thread ID" },
      after: { type: "string", description: "a cursor from an earlier call" },
      seconds: { type: "number" },
    },
    required: ["thread"],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  acts: false,
  call: async (args, by, outside, { window, signal, later }) => {
    const id = args["thread"];
    if (typeof id !== "string") throw new TypeError("$.thread: expected a thread ID");
    const seconds = typeof args["seconds"] === "number" ? args["seconds"] : 50;
    const after = args["after"] === undefined ? null : decodeCursor(args["after"]);
    const ms = after === null ? 0 : Math.min(Math.max(seconds, 0), maxWaitSeconds) * 1000;
    const news = await waitForNews(
      outside,
      window,
      id as never,
      by,
      after ?? decodeCursor(null),
      ms,
      signal,
      later,
    );
    if (!news) throw new TypeError("$.thread: expected a thread the window has");
    return news;
  },
  told: toldNews,
};
export { encodeCursor };

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
          call: (args, _by, outside, _context) =>
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

export const tools: readonly Tool[] = [...readTools, ...itemTools, waitTool, ...actionTools];

// The tools a connected tool may list and call.
export const toolsFor = (by: ConnectedTool): readonly Tool[] =>
  by.mode === "act" ? tools : tools.filter((tool) => !tool.acts);
