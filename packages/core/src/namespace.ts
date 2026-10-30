// A writable source's namespace in a region's module (decision 0019): its
// read helpers, and a write for each op its catalogue lets a run capture. The
// adapter declares it; bindings generate the declarations, the guest stubs
// and the host side from it; the composition root hands it over by source
// kind. Each parameter carries its TypeScript type, as the agent sees it,
// beside the validator the host checks the guest's value with.
import type { ItemId } from "./ids.ts";
import type { NewRef } from "./sandbox.ts";
import type { OpCatalogue } from "./source.ts";
import { optional, type Validator } from "./validate.ts";

// An item that can't be read any more: deleted, hidden from Oriel, or moved
// out of reach.
export type Tombstone = { id: ItemId; gone: true; reason: "deleted" | "forbidden" | "moved" };

// What a namespace's functions get from the run.
export type NamespaceHost = {
  // Whether an ID is one of the region's items, from any source.
  has(id: string): id is ItemId;
  // Refs from creates this run has captured.
  created: ReadonlySet<NewRef>;
  // Reads items live, each shaped by `view`: a missing item is a tombstone,
  // never a throw, and a moved one is followed, since its identity is its
  // stable ID.
  read<V>(
    ids: readonly ItemId[],
    view: (id: ItemId, content: unknown) => V,
  ): Promise<(V | Tombstone)[]>;
};

// The region as one source's namespace sees it.
export type NamespaceScope = {
  // The region's items from this source, in RegionId order.
  ids: readonly ItemId[];
  // The item the region's group was made around, when it is from this source.
  anchor: ItemId | null;
};

export type Param<T> = { name: string; type: string; check: Validator<T>; optional: boolean };

type Values<P extends readonly Param<unknown>[]> = {
  -readonly [K in keyof P]: P[K] extends Param<infer T> ? T : never;
};

type Base = { name: string; doc: string; params: readonly Param<unknown>[] };

export type NamespaceRead = Base & {
  kind: "read";
  // The TypeScript type the read resolves to.
  returns: string;
  run(args: readonly unknown[], host: NamespaceHost): Promise<unknown>;
};

export type NamespaceWrite = Base & {
  kind: "write";
  // The op in the source's catalogue that checks what `build` returns.
  op: string;
  // A create returns the new item's ref; other writes return nothing.
  creates: boolean;
  // The target and the op's arguments, before the catalogue checks them.
  build(
    args: readonly unknown[],
    host: NamespaceHost,
  ): { target: ItemId | NewRef | null; args: Record<string, unknown> };
};

export type NamespaceFn = NamespaceRead | NamespaceWrite;

export type NamespaceSpec = {
  // The source's name as a person knows it, such as "Jira".
  name: string;
  // What its writes are checked against. A revert-only op is never offered.
  ops: OpCatalogue;
  // The declarations it adds: IDs and types only, never source text.
  types(scope: NamespaceScope): string[];
  // Its functions, in declaration order, which is part of the byte-stable
  // output.
  fns(scope: NamespaceScope): NamespaceFn[];
};

export const param = <T>(name: string, type: string, check: Validator<T>): Param<T> => ({
  name,
  type,
  check,
  optional: false,
});

export const optionalParam = <T>(name: string, type: string, check: Validator<T>) => ({
  name,
  type,
  check: optional(check),
  optional: true,
});

function checkArgs<P extends readonly Param<unknown>[]>(
  params: P,
  args: readonly unknown[],
): Values<P> {
  if (args.length > params.length)
    throw new TypeError(`expected at most ${params.length} arguments, got ${args.length}`);
  const values: unknown[] = [];
  const problems: string[] = [];
  params.forEach((p, i) => {
    const result = p.check(args[i], p.name);
    if (result.ok) values.push(result.value);
    else problems.push(...result.issues.map((issue) => `${issue.path}: ${issue.message}`));
  });
  if (problems.length) throw new TypeError(problems.join("; "));
  return values as Values<P>;
}

// A read whose arguments are checked against its parameters before `run`
// sees them, typed from those parameters.
export function read<
  const P extends readonly Param<unknown>[],
  H extends NamespaceHost = NamespaceHost,
>(
  spec: Omit<NamespaceRead, "kind" | "params" | "run"> & {
    params: P;
    run(values: Values<P>, host: H): Promise<unknown>;
  },
): Omit<NamespaceRead, "run"> & { run(args: readonly unknown[], host: H): Promise<unknown> } {
  return {
    ...spec,
    kind: "read",
    run: (args, host) => spec.run(checkArgs(spec.params, args), host),
  };
}

// A write whose arguments are checked the same way before `build`.
export function write<const P extends readonly Param<unknown>[]>(
  spec: Omit<NamespaceWrite, "kind" | "params" | "build"> & {
    params: P;
    build(values: Values<P>, host: NamespaceHost): ReturnType<NamespaceWrite["build"]>;
  },
): NamespaceWrite {
  return {
    ...spec,
    kind: "write",
    build: (args, host) => spec.build(checkArgs(spec.params, args), host),
  };
}

// `type Name =` then one `| "id"` line per ID.
export function idUnion(name: string, ids: readonly string[]): string[] {
  if (!ids.length) return [`type ${name} = never;`];
  return [
    `type ${name} =`,
    ...ids.map((id, i) => `  | ${JSON.stringify(id)}${i === ids.length - 1 ? ";" : ""}`),
  ];
}
