import { type ActionName, actions, type Call } from "./actions.ts";
import type { ItemId, Ulid } from "./ids.ts";
import type { Intent } from "./sandbox.ts";
import { type Shape, shapeOf } from "./validate.ts";

export type Owned = "workstream" | "thread";
const ownedTypes: Readonly<Record<string, Owned>> = {
  WorkstreamId: "workstream",
  ThreadId: "thread",
};

const unwrapped = (shape: Shape): Shape => (shape.kind === "optional" ? shape.inner : shape);

export function alternatives(name: ActionName): Extract<Shape, { kind: "object" }>[] {
  const shape = shapeOf(actions[name].input);
  const all = shape.kind === "union" ? shape.alternatives : [shape];
  return all.flatMap((alternative) => (alternative.kind === "object" ? [alternative] : []));
}

export function ownedFields(shape: Extract<Shape, { kind: "object" }>): Record<string, Owned> {
  const out: Record<string, Owned> = {};
  for (const [key, field] of Object.entries(shape.fields)) {
    const inner = unwrapped(field);
    const owned = inner.kind === "refined" && inner.type ? ownedTypes[inner.type] : undefined;
    if (owned) out[key] = owned;
  }
  return out;
}

function target(intent: Intent): string | null {
  const owned = alternatives(intent.action).flatMap((shape) => Object.keys(ownedFields(shape)));
  if (!owned.length) return null;
  return JSON.stringify([...new Set(owned)].sort().map((key) => intent.input[key] ?? null));
}

function merged(first: Intent, second: Intent): Intent {
  const input: Record<string, unknown> = { ...first.input };
  for (const [key, value] of Object.entries(second.input)) {
    const before = input[key];
    input[key] =
      Array.isArray(before) && Array.isArray(value) ? [...new Set([...before, ...value])] : value;
  }
  return { action: first.action, input };
}

export function planned(intents: readonly Intent[], own: { thread: Ulid }): Intent[] {
  const calls: Intent[] = [];
  for (const intent of intents) {
    const last = calls.at(-1);
    const at = target(intent);
    if (last && at !== null && last.action === intent.action && target(last) === at)
      calls[calls.length - 1] = merged(last, intent);
    else calls.push(intent);
  }
  const closes = (call: Intent) =>
    call.action === "thread.done" && call.input["thread"] === own.thread;
  const close = calls.find(closes);
  return [...calls.filter((call) => !closes(call)), ...(close ? [close] : [])];
}

export type Touched = { kind: Owned; id: Ulid | null; name: string | null };

// The model's own reply is never the record; `undo` stays as the apply gave it.
export type ActionLine = { call: Intent; touched: Touched } & (
  | {
      applied: true;
      undo: Call | null;
      gone?: ItemId[];
      since?: { undone: boolean; next: Call | null };
    }
  | { applied: false; why: string }
);
