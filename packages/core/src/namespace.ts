import type { ResultFields } from "./block.ts";
import type { ItemId } from "./ids.ts";
import type { NewRef } from "./sandbox.ts";
import type { OpCatalogue } from "./source.ts";
import { optional, type Validator } from "./validate.ts";

export type Tombstone = { id: ItemId; gone: true; reason: "deleted" | "forbidden" | "moved" };

export type NamespaceHost = {
  has(id: string): id is ItemId;
  created: ReadonlyMap<NewRef, string>;
  // A missing item is a tombstone, never a throw; a moved one is followed by its stable ID.
  read<V>(
    ids: readonly ItemId[],
    view: (id: ItemId, content: unknown) => V,
  ): Promise<(V | Tombstone)[]>;
};

export type NamespaceScope = {
  ids: readonly ItemId[];
  anchor: ItemId | null;
};

export type Param<T> = { name: string; type: string; check: Validator<T>; optional: boolean };

type Values<P extends readonly Param<unknown>[]> = {
  -readonly [K in keyof P]: P[K] extends Param<infer T> ? T : never;
};

type Base = { name: string; doc: string; params: readonly Param<unknown>[] };

export type NamespaceRead = Base & {
  kind: "read";
  returns: string;
  fields?: ResultFields;
  run(args: readonly unknown[], host: NamespaceHost): Promise<unknown>;
};

export type NamespaceWrite = Base & {
  kind: "write";
  op: string;
  creates: boolean;
  build(
    args: readonly unknown[],
    host: NamespaceHost,
  ): { target: ItemId | NewRef | null; args: Record<string, unknown> };
};

export type NamespaceFn = NamespaceRead | NamespaceWrite;

export type NamespaceSpec = {
  name: string;
  ops: OpCatalogue;
  // IDs and types only, never source text.
  types(scope: NamespaceScope): string[];
  // In declaration order: part of the byte-stable output.
  fns(scope: NamespaceScope): NamespaceFn[];
  blank?: boolean;
};

export const containerRules = {
  noNew: (a: string) => `Only an empty workstream can create ${a}.`,
  addFirst: (a: string) =>
    `For ${a} outside this region, workstream.add() it, then create in a later run.`,
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

export function idUnion(name: string, ids: readonly string[]): string[] {
  if (!ids.length) return [`type ${name} = never;`];
  return [
    `type ${name} =`,
    ...ids.map((id, i) => `  | ${JSON.stringify(id)}${i === ids.length - 1 ? ";" : ""}`),
  ];
}
