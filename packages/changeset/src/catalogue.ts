import type { FieldValues, ItemId, NewRef, Validator, WriteResult } from "@oriel/core";

// What a diff line knows about the item a mutation changes. `title` is its
// title as of this line, after earlier lines in the same change set.
export type Subject =
  | { kind: "item"; id: ItemId; title: string | null }
  | { kind: "new"; ref: NewRef; title: string | null }
  | null;

export type LineContext = {
  subject: Subject;
  // Field values just before this mutation.
  before: FieldValues;
  person(accountId: string): Promise<string | null>;
  title(id: ItemId): Promise<string | null>;
};

export type Undo = { op: string; args: unknown } | { refused: string };

// How the change-set engine treats one of a source's ops.
export type OpSpec = {
  // Validates captured or edited arguments; replay sends what it returns.
  args: Validator<unknown>;
  // A create has no target and may give its item a NewRef.
  creates: boolean;
  // Sending it twice leaves the source as sending it once does, so a failed
  // attempt may be retried. Anything else that failed may have landed and is
  // never sent again.
  idempotent: boolean;
  // Exists only as the reverse of another op; a run can't capture it.
  revertOnly: boolean;
  // The item IDs among its arguments, which must be in the run's region.
  refs(args: unknown): string[];
  // The fields a diff shows, with the values this op sets. Keys are field
  // names as the source's reader and writer report them.
  after(args: unknown): FieldValues;
  // One plain-language sentence for a person who isn't an engineer.
  describe(args: unknown, context: LineContext): Promise<string>;
  // The mutation that undoes an applied one, or why it can't be undone.
  undo(args: unknown, applied: WriteResult): Undo;
};

export type Catalogue = {
  // The source's name as a person knows it.
  name: string;
  // The field holding an item's title, read for every line.
  titleField: string;
  // The field holding an item's last update time. Every write result's
  // `after` carries it, except a delete's. Field conflict checks skip it;
  // reverting a create checks only it.
  updatedField: string;
  ops: Readonly<Record<string, OpSpec>>;
};

// Types one op from its validator, then erases the type so a catalogue can
// hold ops with different argument shapes. Arguments are re-validated on the
// way in, since they come back from the database.
export function op<T>(spec: {
  args: Validator<T>;
  creates?: boolean;
  idempotent?: boolean;
  revertOnly?: boolean;
  refs?(args: T): string[];
  after(args: T): FieldValues;
  describe(args: T, context: LineContext): Promise<string> | string;
  undo(args: T, applied: WriteResult): Undo;
}): OpSpec {
  const parse = (args: unknown): T => {
    const result = spec.args(args);
    if (!result.ok) throw new TypeError(`bad arguments: ${JSON.stringify(result.issues)}`);
    return result.value;
  };
  return {
    args: spec.args,
    creates: spec.creates ?? false,
    idempotent: spec.idempotent ?? false,
    revertOnly: spec.revertOnly ?? false,
    refs: (args) => spec.refs?.(parse(args)) ?? [],
    after: (args) => spec.after(parse(args)),
    describe: async (args, context) => spec.describe(parse(args), context),
    undo: (args, applied) => spec.undo(parse(args), applied),
  };
}
