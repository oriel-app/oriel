// How change sets treat a writable source's ops: each op's entry in the
// source's catalogue, plus what a diff, an apply and a revert need from it.
// The adapter declares them; the composition root hands them to change sets
// by source kind (decision 0019).
import type { ItemId } from "./ids.ts";
import type { NewRef } from "./sandbox.ts";
import type { FieldValues, OpCatalogue, WriteResult } from "./source.ts";
import type { Validator } from "./validate.ts";

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

// How the change-set engine treats one of a source's ops: its entry in the
// source's `OpCatalogue` (`args`, which validates captured or edited
// arguments, and replay sends what it returns; `revertOnly`), and more.
export type OpSpec = OpCatalogue[string] & {
  // A create has no target and may give its item a NewRef.
  creates: boolean;
  // Sending it twice leaves the source as sending it once does, so a failed
  // attempt may be retried. Anything else that failed may have landed and is
  // never sent again.
  idempotent: boolean;
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

// One source's op specs, and what change sets need to name its items.
export type OpSpecs = {
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

// One op: its entry in the source's own catalogue (how to check its
// arguments, and whether it exists only as a revert), and how change sets
// treat it. Typed from the entry's validator, then erased so a catalogue can
// hold ops with different argument shapes. Arguments are re-validated on the
// way in, since they come back from the database.
export function op<T>(
  entry: { args: Validator<T>; revertOnly: boolean },
  spec: {
    creates?: boolean;
    idempotent?: boolean;
    refs?(args: T): string[];
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
    idempotent: spec.idempotent ?? false,
    revertOnly: entry.revertOnly,
    refs: (args) => spec.refs?.(parse(args)) ?? [],
    after: (args) => spec.after(parse(args)),
    describe: async (args, context) => spec.describe(parse(args), context),
    undo: (args, applied) => spec.undo(parse(args), applied),
  };
}
