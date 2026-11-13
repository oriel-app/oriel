import type { Conflict } from "./changeset.ts";
import type { ItemId } from "./ids.ts";
import type { NewRef } from "./sandbox.ts";
import type { FieldValues, OpCatalogue, WriteResult } from "./source.ts";
import type { Validator } from "./validate.ts";

export type Subject =
  | { kind: "item"; id: ItemId; title: string | null }
  | { kind: "new"; ref: NewRef; title: string | null }
  | null;

export type LineContext = {
  subject: Subject;
  before: FieldValues;
  name(id: string): Promise<string | null>;
  title(id: ItemId | NewRef): Promise<string | null>;
};

export type Undo = { op: string; args: unknown } | { refused: string };

export type OpSpec = OpCatalogue[string] & {
  creates: boolean;
  makes: string | null;
  deletes: boolean;
  // Sending it twice leaves the source as sending it once does, so a failed attempt may be retried.
  // Anything else that failed may have landed and is never sent again.
  idempotent: boolean;
  // Its item IDs, which must be in the run's region.
  refs(args: unknown): string[];
  newRefArgs: Readonly<Record<string, string>>;
  after(args: unknown): FieldValues;
  describe(args: unknown, context: LineContext): Promise<string>;
  undo(args: unknown, applied: WriteResult): Undo;
};

export type OpSpecs = {
  name: string;
  titleField: string;
  fields: Readonly<Record<string, "item" | "value">>;
  // Field conflict checks skip it; reverting a create checks only it.
  updatedField: string;
  ops: Readonly<Record<string, OpSpec>>;
  explain?(conflict: Conflict, title: string | null): string | null;
};

// Arguments are re-validated on the way in: they come back from the database.
export function op<T>(
  entry: { args: Validator<T>; revertOnly: boolean },
  spec: {
    creates?: boolean;
    makes?: string;
    deletes?: boolean;
    idempotent?: boolean;
    refs?(args: T): string[];
    newRefArgs?: Readonly<Record<string, string>>;
    after(args: T): FieldValues;
    describe(args: T, context: LineContext): Promise<string> | string;
    undo(args: T, applied: WriteResult): Undo;
  },
): OpSpec {
  const parse = (args: unknown): T => {
    const result = entry.args(args);
    if (!result.ok) throw new TypeError(`bad arguments: ${JSON.stringify(result.issues)}`);
    return result.value;
  };
  return {
    args: entry.args,
    creates: spec.creates ?? false,
    makes: spec.makes ?? null,
    deletes: spec.deletes ?? false,
    idempotent: spec.idempotent ?? false,
    revertOnly: entry.revertOnly,
    refs: (args) => spec.refs?.(parse(args)) ?? [],
    newRefArgs: spec.newRefArgs ?? {},
    after: (args) => spec.after(parse(args)),
    describe: async (args, context) => spec.describe(parse(args), context),
    undo: (args, applied) => spec.undo(parse(args), applied),
  };
}
