// SPIKE (OA-74), in-house: one registry of Oriel's own actions, one
// dispatcher, three doors (the window's routes, the agent's module, MCP).
// Each action is declared once; its input validator describes itself, so the
// doors' `.d.ts` text and JSON Schema come from the same declaration.
import {
  type Described,
  type IndexRecord,
  type Infer,
  type Instant,
  jsonSchema,
  type Shape,
  shapeOf,
  type TelemetryEvent,
  typeText,
  type Ulid,
} from "@oriel/core";
import type { GroupStore } from "@oriel/db";

// Who acted. Recorded with every call.
export type Actor =
  | { kind: "person" }
  | { kind: "agent"; threadId: Ulid }
  | { kind: "tool"; client: string };

// Direct: anyone, at once, with an inverse for Undo. Change set: captured,
// a person approves. Person only: never the agent or a tool, and says why.
export type ActionClass =
  | { kind: "direct"; inverse: string }
  | { kind: "change-set" }
  | { kind: "person-only"; reason: string };

// What an action may touch. One object, passed in; no service container.
export type ActionDeps = {
  workspaceId: Ulid;
  groups: GroupStore;
  records(): readonly IndexRecord[];
  now(): Instant;
  emit(event: TelemetryEvent): void;
  // The window's streams: a group changed, so its working threads follow it.
  changed(groupId: Ulid): void;
};

// A refusal the doors map: a route to 400/404, the agent to a run error, MCP
// to `isError`.
export class ActionError extends Error {
  readonly code: "invalid" | "not-found";
  constructor(code: "invalid" | "not-found", message: string) {
    super(message);
    this.code = code;
  }
}

export type Action<V extends Described<unknown>> = {
  name: string;
  doc: string;
  class: ActionClass;
  input: V;
  // Fields a door fills in for the agent: its thread's group.
  bound: readonly (keyof Infer<V> & string)[];
  run(input: Infer<V>, actor: Actor, deps: ActionDeps): { changed: Ulid | null };
};

export const action = <V extends Described<unknown>>(declared: Action<V>) => declared;

export function dispatch<V extends Described<unknown>>(
  declared: Action<V>,
  raw: unknown,
  actor: Actor,
  deps: ActionDeps,
): void {
  if (declared.class.kind === "person-only" && actor.kind !== "person")
    throw new ActionError("invalid", `${declared.name} is a person's: ${declared.class.reason}`);
  const decoded = declared.input(raw);
  if (!decoded.ok)
    throw new ActionError(
      "invalid",
      decoded.issues.map((i) => `${i.path}: ${i.message}`).join("; "),
    );
  const { changed } = declared.run(decoded.value as Infer<V>, actor, deps);
  deps.emit({
    name: "action.called",
    at: deps.now(),
    workspaceId: deps.workspaceId,
    action: declared.name,
    actor: actor.kind,
  });
  if (changed) deps.changed(changed);
}

// The agent's door: one line of the region's `.d.ts`, with the bound fields
// left out and the rest positional. An item the agent names is one of its
// region's.
export function agentDeclaration(declared: Action<Described<unknown>>): string {
  const shape = shapeOf(declared.input);
  if (shape.kind !== "object") throw new Error(`${declared.name}: input isn't an object`);
  const params = Object.entries(shape.fields)
    .filter(([key]) => !declared.bound.includes(key as never))
    .map(([key, field]) => `${key}: ${typeText(field).replaceAll("ItemId", "RegionId")}`);
  const fn = declared.name.split(".").at(-1);
  return `  /** ${declared.doc} */\n  ${fn}(${params.join(", ")}): void;`;
}

// The MCP door: a tool per action that isn't a person's.
export function mcpTool(declared: Action<Described<unknown>>) {
  return {
    name: declared.name,
    description: declared.doc,
    inputSchema: jsonSchema(shapeOf(declared.input) satisfies Shape),
  };
}
