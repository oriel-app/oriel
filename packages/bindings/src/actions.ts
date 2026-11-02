// Oriel's own actions in the agent's module (decision 0024), generated from
// the registry, never written per action: one function for each direct
// action open to the agent, in the namespace its name starts with, with the
// registry's one-line doc. Each takes one `input` object, as the action's
// declaration types it, less what only the user gives in the window. A
// workstream or thread the agent leaves out is its own. A run only records
// the call, checked here, as an intent; the turn applies it when it ends.
import {
  type ActionDeclaration,
  type ActionName,
  actions,
  alternatives,
  type Intent,
  type ItemId,
  ownedFields,
  type Shape,
  typeText,
  type Ulid,
  unknown,
} from "@oriel/core";
import { type IntentFn, orielSpaces, type OrielSpace } from "./fn.ts";

type ObjectShape = Extract<Shape, { kind: "object" }>;

const isOrielSpace = (space: string): space is OrielSpace =>
  (orielSpaces as readonly string[]).includes(space);

// An alternative's `kind`, when the union tells its alternatives apart by one.
const kindOf = (shape: ObjectShape): string | null => {
  const kind = shape.fields["kind"];
  return kind?.kind === "literal" && typeof kind.value === "string" ? kind.value : null;
};

// What of the action's input the agent gives: each alternative it may use,
// with only the fields it may set.
function agentShapes(name: ActionName): { kind: string | null; fields: Record<string, Shape> }[] {
  const declared: ActionDeclaration = actions[name];
  const userOnly = declared.userOnly ?? {};
  return alternatives(name).flatMap((shape) => {
    const kind = kindOf(shape);
    if (kind !== null && Object.hasOwn(userOnly, kind)) return [];
    const fields = Object.fromEntries(
      Object.entries(shape.fields).filter(([key]) => !Object.hasOwn(userOnly, key)),
    );
    return [{ kind, fields }];
  });
}

// An input type as the agent writes it: its own workstream or thread may be
// left out, as may an optional field.
function agentType(name: ActionName): { type: string; optional: boolean } {
  const owned = Object.assign({}, ...alternatives(name).map(ownedFields)) as Record<string, string>;
  const shapes = agentShapes(name);
  const types = shapes.map(({ fields }) => {
    const parts = Object.entries(fields).map(([key, field]) => {
      const inner = field.kind === "optional" ? field.inner : field;
      const leftOut = field.kind === "optional" || Object.hasOwn(owned, key);
      return `${key}${leftOut ? "?" : ""}: ${typeText(inner)}`;
    });
    return { type: `{ ${parts.join("; ")} }`, empty: parts.every((part) => part.includes("?:")) };
  });
  return {
    type: types.map((t) => t.type).join(" | "),
    optional: types.length === 1 && types[0]?.empty === true,
  };
}

// Each direct action not closed to the agent, in registry order.
export const intentFns: readonly IntentFn[] = (Object.keys(actions) as ActionName[]).flatMap(
  (action) => {
    const declared: ActionDeclaration = actions[action];
    if (declared.class.kind !== "direct" || declared.closed?.agent !== undefined) return [];
    const [space, name] = action.split(".");
    if (space === undefined || name === undefined || !isOrielSpace(space))
      throw new Error(`${action}: an action open to the agent is named for an Oriel namespace`);
    const { type, optional } = agentType(action);
    return [
      {
        kind: "intent",
        space,
        name,
        doc: declared.doc,
        action,
        params: [{ name: "input", type, check: unknown, optional }],
      },
    ];
  },
);

// What the actions are, and the types their inputs name.
export const actionTypes = [
  "/** The workstream and thread actions aren't writes and need no review: a run records them, and they apply as your turn ends, unless Oriel refuses one. The user can undo each. Use one only when asked. */",
  "type WorkstreamId = string;",
  "type ThreadId = string;",
  "/** One a workstream gains is in this region, or found by search() in this run. */",
  "type ItemId = string;",
];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// What the host checks a recorded call against, before any of it applies:
// the action's own declaration, with the agent's workstream and thread where
// it left them out, and every item a workstream gains within reach.
export function intended(
  fn: IntentFn,
  args: readonly unknown[],
  own: { workstream: Ulid; thread: Ulid | null; reaches(id: ItemId): boolean },
): Intent {
  const { action } = fn;
  const declared: ActionDeclaration = actions[action];
  if (args.length > 1) throw new TypeError(`expected at most 1 argument, got ${args.length}`);
  const given = args[0] ?? {};
  if (!isPlainObject(given)) throw new TypeError("$: expected an object");
  const userOnly = declared.userOnly ?? {};
  const kind = typeof given["kind"] === "string" ? given["kind"] : null;
  if (kind !== null && Object.hasOwn(userOnly, kind))
    throw new Error(`a ${JSON.stringify(kind)} input is the user's: ${userOnly[kind]}`);
  for (const key of Object.keys(given))
    if (Object.hasOwn(userOnly, key)) throw new Error(`$.${key} is the user's: ${userOnly[key]}`);
  const shapes = agentShapes(action);
  const shape = shapes.find((s) => s.kind === kind) ?? (shapes.length === 1 ? shapes[0] : null);
  const stray = shape && Object.keys(given).find((key) => !Object.hasOwn(shape.fields, key));
  if (stray) throw new TypeError(`$.${stray}: not part of ${action}'s input`);
  const input: Record<string, unknown> = { ...given };
  for (const alternative of alternatives(action))
    for (const [key, owned] of Object.entries(ownedFields(alternative))) {
      if (input[key] !== undefined) continue;
      if (owned === "workstream") input[key] = own.workstream;
      else if (own.thread !== null) input[key] = own.thread;
      else throw new Error(`$.${key}: there's no thread of the agent's here to default to`);
    }
  const checked = declared.input(input);
  if (!checked.ok)
    throw new TypeError(checked.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  const value = checked.value as Record<string, unknown>;
  const joining = declared.joins === undefined ? [] : value[declared.joins];
  for (const id of Array.isArray(joining) ? (joining as ItemId[]) : [])
    if (!own.reaches(id))
      throw new RangeError(
        `${JSON.stringify(id)} isn't in this region, and no search() in this run found it`,
      );
  return {
    action,
    input: Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)),
  };
}
