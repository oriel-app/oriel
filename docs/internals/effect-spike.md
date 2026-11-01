# Spike OA-74: Effect 4 or in-house for Oriel's actions

Throwaway branch `spike/effect-actions`; it never merges. It feeds the decision in OA-67.

One real action, group remove (`POST /api/groups/:id/remove`, `groups.remove`), built twice. Each version has one declaration, which should give four things: the runtime check, the TypeScript type, the line in the agent's `.d.ts` (decision 0016), and an MCP `inputSchema`.

- **In-house:** `packages/core/src/validate.ts` gains a `shape` on every validator, `packages/core/src/shape.ts` turns a shape into type text and JSON Schema, and `packages/server/src/actions/action.ts` holds the registry, the dispatcher and the doors. `group-remove.ts` is the declaration, and the route calls the dispatcher.
- **Effect:** `effect@4.0.6`, the newest 4.x past pnpm's 7-day floor. `packages/server/src/actions/effect.ts` holds the Schema declaration, a dispatcher written with `Context.Service`, `Schema.TaggedError` and `Effect.fn`, and the same doors.
- `spike.test.ts` checks that both versions accept and refuse the same eight inputs and remove, refuse and publish alike. It also prints each version's outputs.

## The declaration

In-house:

```ts
input: object({
  group: refine(string, isUlid, "expected a group ID", { type: "GroupId" }),
  items: refine(array(itemIdValue), (items) => items.length > 0 && items.length <= maxItems,
    `expected 1 to ${maxItems} items`, { json: { minItems: 1, maxItems } }),
}),
// itemIdValue = refine(string, isItemId, "expected an item ID", { type: "ItemId", json: { pattern } })
```

Effect:

```ts
const ItemId = Schema.String.check(
  Schema.isPattern(new RegExp(itemIdPattern, "u"), { description: "an item ID" }),
).pipe(Schema.refine(isItemId, { toCode: () => ({ runtime: "Schema.refine(isItemId)" }) }));
Schema.Struct({
  group: Schema.String.check(Schema.isULID()),
  items: Schema.Array(ItemId).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
});
```

## What each one gives

|                   | In-house                                                                                                          | Effect 4.0.6                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime check     | Same verdict on all 8 inputs; reports every issue                                                                 | Same verdict on all 8 inputs; stops at the first issue unless `errors: "all"`                                                        |
| Type              | `{ group: Ulid; items: ItemId[] }`: guards keep our brands                                                        | `{ readonly group: string; readonly items: readonly ItemId[] }`: `isULID()` leaves a string                                          |
| `.d.ts` line      | `remove(items: RegionId[]): void;`                                                                                | `remove(items: ReadonlyArray<string>): void;`: the code generator writes a refined ID as its base type                               |
| MCP `inputSchema` | Object, `required`, `additionalProperties: false`, item pattern, `minItems`/`maxItems`; no group pattern (unsaid) | The same, plus the ULID pattern for free; `additionalProperties` is open unless `onExcessProperty: "error"`                          |
| What it took      | A 4th argument to `refine` saying its type name and JSON keywords, where they matter                              | A `toCode` annotation on every opaque refine, or the generator throws; a `u` flag on every pattern, or JSON Schema silently drops it |

Neither library knows the agent's door. In both versions the door leaves out what it binds (the thread's group), and it narrows `ItemId` to `RegionId`, because the agent names items in its region. That is a door rule, written once, whichever library is used.

Getting `ItemId` in the type text and its pattern in JSON Schema from one Effect schema needs a `Schema.declare` with codec annotations. A `declare` alone gives the type text but drops the array's `items` from JSON Schema entirely. The in-house `refine` says both in one place.

## Services and typed errors

The Effect dispatcher reads well, and its exhaustive `switch` over error tags fails to compile if a door forgets an error. The in-house `ActionError.code` union gives the same check with an ordinary `switch`.

The rest is a second way to write code. Each action body becomes a generator with `yield*`. Each door needs `Effect.runPromiseExit`, a `provideService` per service and a walk of `exit.cause.reasons`. The stores are synchronous SQLite, so Effect's async, resource and retry machinery buys nothing here. Every other module in the repo is plain functions and `throw`. An agent that reads one would have to learn the other.

## Cost

Measured on the maintainer's Mac, under Node 26.13 (pinned by `mise.toml`), median of 10 runs.

- **Install:** `effect@4.0.6` has no dependencies, but it is 58.7 MB and 2,777 files. `node_modules/.pnpm` grows from 78 MB to 137 MB (+75%).
- **Startup:** importing the in-house action takes 63 ms, most of it core, db and views, which the server loads anyway. The Effect version takes 145 ms: Effect adds about 82 ms and 225 modules through its barrel import, or about 53 ms with subpath imports. In-house adds nothing measurable.
- **Web bundle:** untouched. `packages/web` depends only on `preact` and its import map lists only preact. The built `dist/` hashes the same before and after (`a8bf7ff…`, 264 KB), and nothing in it imports `effect`. `module-size.test.ts` passes.
- **Policy:** Effect is none of SPEC §6's exceptions (security-critical, a protocol standard, a database driver), and decision 0016 says the `.d.ts` comes from one description, "no wrapper library".
- **In-house cost:** shapes on the validator change no call site (the repo typechecks as is, and 1,051 tests pass). That is `shape.ts` (74 lines) plus about 65 net lines in `validate.ts`. `lazy` describes as `unknown`. Action inputs are flat, so that holds until one isn't.

## Verdict

**In-house.** Extend the validator to describe itself. Effect Schema is the better library in general, with more checks and richer JSON Schema for free. For Oriel's four outputs, though, it needs as many hand annotations as ours. Its code generator loses our ID types in the agent's `.d.ts`, which is the output that matters most. Its services and typed errors would make Oriel's code two-styled for no gain in a synchronous dispatcher. It costs 59 MB and 82 ms, against a dependency policy it doesn't meet.

What the spike also found, for the decision:

- The group log's cause is `user` or `change-set`. An action from the agent or an outside tool needs its own cause, so markers and telemetry say who acted.
- `POST /groups/:id/remove` emits no telemetry today. One event per call fixes that for every action.
- The route's order changes slightly: input is checked before the group exists, so a bad body to a missing group is a 400, not a 404.
