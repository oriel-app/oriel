// SPIKE (OA-74), in-house: group remove, declared once.
import { array, isItemId, isUlid, keyShapes, object, refine, string, type Ulid } from "@oriel/core";
import { memberOf } from "../views.ts";
import { action, ActionError } from "./action.ts";

const maxItems = 500;
export const itemIdPattern = `^(${Object.entries(keyShapes)
  .map(([kind, shape]) => `${kind}:${shape.source.slice(1, -1)}`)
  .join("|")})$`;

const itemIdValue = refine(string, isItemId, "expected an item ID", {
  type: "ItemId",
  json: { pattern: itemIdPattern },
});

export const groupRemove = action({
  name: "group.remove",
  doc: "Takes items out of the group. The items themselves don't change.",
  class: { kind: "direct", inverse: "group.add" },
  input: object({
    group: refine(string, isUlid, "expected a group ID", { type: "GroupId" }),
    items: refine(
      array(itemIdValue),
      (items) => items.length > 0 && items.length <= maxItems,
      `expected 1 to ${maxItems} items`,
      { json: { minItems: 1, maxItems } },
    ),
  }),
  bound: ["group"],
  run({ group: id, items }, _actor, deps) {
    const group = deps.groups.get(id as Ulid);
    if (!group || group.workspaceId !== deps.workspaceId)
      throw new ActionError("not-found", "no such group");
    // By identity: a moved item is removed under its current handle, and
    // one the index no longer has under the handle the group shows.
    const held = deps.groups.region(group.id, group.version)?.items ?? [];
    const records = deps.records();
    const members = items.map((item) => {
      const member = memberOf(item, held, records);
      if (!member) throw new ActionError("invalid", `${item} isn't in this group`);
      return member;
    });
    // SPIKE: the group log's cause has no agent or tool yet; the decision adds one.
    const change = deps.groups.remove(group.id, members, { kind: "user" }, deps.now());
    return { changed: change ? group.id : null };
  },
});
