// SPIKE (OA-74), Effect 4: group remove declared once with Effect Schema,
// run through a dispatcher written with Effect's services and typed errors.
// Compare action.ts and group-remove.ts, which do the same in-house.
import type { GroupStore } from "@oriel/db";
import {
  type IndexRecord,
  type Instant,
  isItemId,
  type TelemetryEvent,
  type Ulid,
} from "@oriel/core";
import { Context, Effect, Exit, Schema, SchemaRepresentation } from "effect";
import { memberOf } from "../views.ts";
import type { Actor, ActionClass } from "./action.ts";
import { itemIdPattern } from "./group-remove.ts";

// Services: what an action may touch, provided per call.
export class Groups extends Context.Service<
  Groups,
  {
    workspaceId: Ulid;
    store: GroupStore;
    records(): readonly IndexRecord[];
    now(): Instant;
  }
>()("oriel/actions/Groups") {}

export class Window extends Context.Service<
  Window,
  { emit(event: TelemetryEvent): void; changed(groupId: Ulid): void }
>()("oriel/actions/Window") {}

// Typed errors: each door maps them by tag.
export class Invalid extends Schema.TaggedError<Invalid>()("Invalid", {
  message: Schema.String,
}) {}
export class NoSuchGroup extends Schema.TaggedError<NoSuchGroup>()("NoSuchGroup", {}) {}
export class NotInGroup extends Schema.TaggedError<NotInGroup>()("NotInGroup", {
  item: Schema.String,
}) {}

// The pattern needs the `u` flag, or JSON Schema silently drops it. The
// refine narrows the type to ItemId, but code generation still says string.
const ItemId = Schema.String.check(
  Schema.isPattern(new RegExp(itemIdPattern, "u"), { description: "an item ID" }),
).pipe(Schema.refine(isItemId, { toCode: () => ({ runtime: "Schema.refine(isItemId)" }) }));

export const GroupRemoveInput = Schema.Struct({
  group: Schema.String.check(Schema.isULID()),
  items: Schema.Array(ItemId).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
});

export const groupRemoveE = {
  name: "group.remove",
  doc: "Takes items out of the group. The items themselves don't change.",
  class: { kind: "direct", inverse: "group.add" } satisfies ActionClass,
  input: GroupRemoveInput,
  bound: ["group"] as const,
  run: Effect.fn("group.remove")(function* ({ group: id, items }: typeof GroupRemoveInput.Type) {
    const { workspaceId, store, records, now } = yield* Groups;
    const group = store.get(id as Ulid);
    if (!group || group.workspaceId !== workspaceId) return yield* new NoSuchGroup();
    const held = store.region(group.id, group.version)?.items ?? [];
    const indexed = records();
    const members = [];
    for (const item of items) {
      const member = memberOf(item, held, indexed);
      if (!member) return yield* new NotInGroup({ item });
      members.push(member);
    }
    const change = store.remove(group.id, members, { kind: "user" }, now());
    return change ? group.id : null;
  }),
};

export const dispatchE = Effect.fn("dispatch")(function* (raw: unknown, actor: Actor) {
  const action = groupRemoveE;
  const input = yield* Schema.decodeUnknownEffect(action.input)(raw, { errors: "all" }).pipe(
    Effect.mapError((error) => new Invalid({ message: error.message })),
  );
  const changed = yield* action.run(input);
  const { workspaceId, now } = yield* Groups;
  const window = yield* Window;
  window.emit({
    name: "action.called",
    at: now(),
    workspaceId,
    action: action.name,
    actor: actor.kind,
  });
  if (changed) window.changed(changed);
});

// The window's door: run with services provided, map each tag to a status.
export async function routeE(
  raw: unknown,
  services: { groups: Groups["Service"]; window: Window["Service"] },
): Promise<{ status: number; error?: string }> {
  const exit = await Effect.runPromiseExit(
    dispatchE(raw, { kind: "person" }).pipe(
      Effect.provideService(Groups, services.groups),
      Effect.provideService(Window, services.window),
    ),
  );
  if (Exit.isSuccess(exit)) return { status: 200 };
  const error = exit.cause.reasons.find((r) => r._tag === "Fail")?.error;
  if (!error) throw new Error("defect", { cause: exit.cause });
  switch (error._tag) {
    case "Invalid":
      return { status: 400, error: error.message };
    case "NoSuchGroup":
      return { status: 404, error: "no such group" };
    case "NotInGroup":
      return { status: 400, error: `${error.item} isn't in this group` };
  }
}

// The agent's door: the field types as Effect's code generator writes them.
export function agentDeclarationE(): string {
  const params = Object.entries(GroupRemoveInput.fields)
    .filter(([key]) => !(groupRemoveE.bound as readonly string[]).includes(key))
    .map(([key, field]) => {
      const code = SchemaRepresentation.toCodeDocument(
        SchemaRepresentation.toMultiDocument(Schema.toRepresentation(field)),
      );
      return `${key}: ${code.codes[0]?.Type}`;
    });
  return `  /** ${groupRemoveE.doc} */\n  remove(${params.join(", ")}): void;`;
}

// The MCP door.
export function mcpToolE() {
  const { schema } = Schema.toJsonSchemaDocument(GroupRemoveInput, { onExcessProperty: "error" });
  return { name: groupRemoveE.name, description: groupRemoveE.doc, inputSchema: schema };
}
