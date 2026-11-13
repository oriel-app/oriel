import type { PreviewTable } from "./block.ts";
import type { Log } from "./run.ts";
import {
  boolean,
  type Described,
  type Infer,
  literal,
  nullable,
  number,
  object,
  optional,
  refine,
  string,
  union,
} from "./validate.ts";

export type ConnectStep =
  | {
      kind: "folder";
      field: string;
      prompt: string;
      what: string;
      choose: string;
      another: string;
      waiting: string;
      label: string;
      placeholder: string;
      note: string;
    }
  | ReviewStep;

export type ReviewStep = {
  kind: "review";
  label: string;
  title: string;
  lede: string;
  reading: string;
  ask: string;
  // `{at}` is the table's ID, never a name anyone wrote.
  fix: string;
};

export type OptionField =
  | { kind: "list"; name: string; label: string; about: string }
  | { kind: "read-only"; name: "readOnly" }
  | { kind: "mapping"; name: string; label: string; about: string };

// Any `readOnly` value but `false` is read-only, so a malformed option can't open writes.
export const readOnlyOf = (options: Readonly<Record<string, unknown>>): boolean =>
  options.readOnly !== undefined && options.readOnly !== false;

export type ConnectOffer = {
  firstRun?: number;
  mark: string;
  title: string;
  about: string;
  counts: string;
  empty: string;
  yours: string;
  changes: string;
  follow?: string;
  ready: string;
  catchUp: string;
  invite?: { note: string; readOnly: string; connected: string };
};

export type ConnectVia = { log: Log };

// In the person's words, never quoting a value.
export type ConnectRefusal = { problem: string; fields?: readonly string[] };

export type PickChoice = {
  value: string;
  name: string;
  count: number | null;
  updatedAt: string | null;
  unlisted?: true;
};

export type Made = { options: Record<string, unknown> };

export type ConnectOf<G = unknown> = {
  steps: readonly ConnectStep[];
  given: Described<G>;
  identify(given: G, via: ConnectVia): Promise<string | ConnectRefusal>;
  make(given: G, identity: string, via: ConnectVia): Promise<Made | ConnectRefusal>;
  failed: { open: string; sync: string };
};

// Set beside a connector's options, so no connector's options use these names, which a test checks.
// `every` is in minutes; null syncs when Oriel starts and when asked.
export const syncEvery = [5, 15, 60] as const;
export const connectionSettings = object({
  name: optional(
    nullable(
      refine(
        string,
        (name) => name.trim() !== "" && name.length <= 60,
        "expected a name of 1 to 60 characters",
      ),
    ),
  ),
  every: optional(
    nullable(
      refine(
        number,
        (minutes) => (syncEvery as readonly number[]).includes(minutes),
        "expected 5, 15 or 60 minutes",
      ),
    ),
  ),
});
export type ConnectionSettings = {
  [K in keyof Infer<typeof connectionSettings>]-?: Exclude<
    Infer<typeof connectionSettings>[K],
    undefined
  >;
};
export const settingNames = [
  "name",
  "every",
] as const satisfies readonly (keyof ConnectionSettings)[];

// Drawn from the source, never from the drafter's words.
export type ReviewTable = {
  name: string;
  at: string | null;
  columns: readonly { at: string; header: string | null; feeds: string | null }[];
  rows: readonly (readonly (string | null)[])[];
  lines: readonly string[];
  reads: ReviewReads | null;
};
export type ReviewReads = {
  header: number;
  end: "blank" | "grid";
  hidden: boolean;
  fields: Readonly<Record<string, string>>;
};

export type PreviewAsk = { first?: readonly string[]; names?: true };

export type ReviewOutline = { at: string; name: string; reads: string | null };

const ofTable = { table: refine(string, (at) => at.length <= 200, "expected a table's `at`") };
export const reviewEdit = union(
  object({ ...ofTable, read: boolean }),
  object({
    ...ofTable,
    field: refine(string, (name) => /^[a-z]{1,20}$/.test(name), "expected a field's name"),
    column: nullable(refine(string, (at) => /^[A-Z]{1,3}$/.test(at), "expected a column")),
  }),
  object({
    ...ofTable,
    header: refine(number, (n) => Number.isInteger(n) && n >= 1, "expected a row number"),
  }),
  object({ ...ofTable, end: union(literal("blank"), literal("grid")) }),
  object({ ...ofTable, hidden: boolean }),
);
export type ReviewEdit = Infer<typeof reviewEdit>;

export type ReviewField = { name: string; label: string; required: boolean };

// A draft names what it reads as the preview shows it, such as columns by letter, so a header can't steer what the card says.
export type ReviewOf = {
  step: ReviewStep;
  draft: Described<Record<string, unknown>>;
  doc: string;
  waits(options: Readonly<Record<string, unknown>>): boolean;
  settle(
    draft: Readonly<Record<string, unknown>>,
    tables: readonly PreviewTable[],
    options: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> | { problem: string };
  guess(tables: readonly PreviewTable[]): Record<string, unknown> | null;
  draw(draft: Readonly<Record<string, unknown>>, tables: readonly PreviewTable[]): ReviewTable[];
  fields: readonly ReviewField[];
  outline(
    options: Readonly<Record<string, unknown>>,
    tables: readonly PreviewTable[],
  ): ReviewOutline[];
  current(
    options: Readonly<Record<string, unknown>>,
    tables: readonly PreviewTable[],
  ): Record<string, unknown>;
  edit(
    draft: Readonly<Record<string, unknown>>,
    edit: ReviewEdit,
    tables: readonly PreviewTable[],
  ): Record<string, unknown> | { problem: string };
  said(
    before: Readonly<Record<string, unknown>>,
    after: Readonly<Record<string, unknown>>,
    tables: readonly PreviewTable[],
  ): string[];
};
