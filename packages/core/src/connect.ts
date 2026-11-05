// How a person makes a connection through a connector (decision 0049): the
// steps the window draws, the same way for every connector, in the words its
// connector declares; what the person gives across them, checked by the
// connector's own validator; and each step's server half, such as checking
// a site or listing its projects, which is the connector's own code. Under
// `pnpm dev`, how a flag's live connection is made from `.env`. And what
// every connection has, whatever its connector: its name and how often it
// syncs.
import type { PreviewTable } from "./block.ts";
import type { Instant } from "./ids.ts";
import type { ToOpen } from "./open.ts";
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

// One field the person types, in the words the window shows: its label, an
// example in the empty field, and a line under it. `input`: what it holds,
// for the browser, which otherwise takes it as text.
export type ConnectField = {
  name: string;
  label: string;
  secret?: true;
  input?: "url" | "email";
  placeholder?: string;
  hint?: string;
};

// Lines beside a step that help the person through it, such as making
// Jira's API token: a paragraph, then numbered lines. In either, `**text**`
// is strong and `[text](https://…)` a link that opens in the browser. They
// are the connector's own words, never a value anyone typed or synced.
export type ConnectHelp = { intro: string; lines: readonly string[] };

// One step of making a connection, with what the window says on it.
// `fields`: what the person types, with help beside it. `folder`: a folder,
// from the system's picker through the shell, or a typed path under
// `pnpm dev`, into `field`. `pick`: one from a list the connector fetches
// from what the steps before gave, into `field`; each choice counts its
// items as `counts` says one, such as "issue". `browser`: a sign-in in the
// person's own browser, on the source's page, after a line saying what they
// agree to (decision 0050). `review`: the options Oriel or the agent drafts
// from what the connection reads, for the person to apply (decision 0051).
export type ConnectStep =
  | {
      kind: "fields";
      // The form's name, to a screen reader; its heading and line in the
      // first run.
      label: string;
      title: string;
      lede: string;
      fields: readonly ConnectField[];
      help?: ConnectHelp;
    }
  | {
      kind: "folder";
      field: string;
      // What the system's picker asks, what it picks, and its button, and
      // the button once one is connected; the line while the picker is
      // open; what a typed path's field is called, with an example; and the
      // line under either.
      prompt: string;
      what: string;
      choose: string;
      another: string;
      waiting: string;
      label: string;
      placeholder: string;
      note: string;
    }
  | {
      kind: "pick";
      field: string;
      label: string;
      title: string;
      lede: string;
      // The list's name, to a screen reader, and the field that narrows it,
      // shown when the source has more than it listed.
      list: string;
      find: string;
      findLabel: string;
      // An empty list, and one the field narrowed to nothing.
      none: string;
      noMatch: string;
      counts: string;
      // The button, until one is picked: then it names the pick.
      use: string;
    }
  | {
      kind: "browser";
      label: string;
      title: string;
      lede: string;
      // What the person agrees to, said before the source's page opens; the
      // button that opens it; and the line while they finish there.
      consent: string;
      go: string;
      waiting: string;
    }
  | {
      kind: "review";
      label: string;
      title: string;
      lede: string;
      // The line while Oriel reads what a draft is made from, such as the
      // headers; and the person's words that start the window chat's turn
      // that drafts the options, which name nothing synced (decision 0051).
      reading: string;
      ask: string;
      // The person's words that start the window chat's turn that drafts a
      // change to how it reads one table, named by its `at`, `{at}` (OA-232):
      // an ID, never a name anyone wrote.
      fix: string;
    };

// How Settings draws one of a connector's options. `pick`: one from the list
// its pick step fetches, for the connection's own account. `list`: names the
// person types, such as Slack's channels. `read-only`: its
// `readOnly` option, on a connector that writes, drawn as whether Oriel may
// propose changes. `mapping`: how the source's tables feed Oriel's fields,
// drawn by the connector's review step, filled with the mapping it has, which
// the person changes and applies (OA-232). More kinds come with the
// connectors that need them (decision 0049 lists them).
export type OptionField =
  | { kind: "pick"; name: string; label: string }
  | { kind: "list"; name: string; label: string; about: string }
  | { kind: "read-only"; name: "readOnly" }
  | { kind: "mapping"; name: string; label: string; about: string };

// Whether a connection's options make it read-only: anything but off, or no
// option at all, is, so a malformed option can't open writes. No writer is
// built for one, and its namespace offers no write (decision 0049).
export const readOnlyOf = (options: Readonly<Record<string, unknown>>): boolean =>
  options.readOnly !== undefined && options.readOnly !== false;

// How the window offers a connector, in its words: its row in the first
// run's source step, which offers it at `firstRun`, in that order, if at
// all; and its card on the overview while it isn't connected. Each is a
// phrase the window fits into a sentence of its own.
export type ConnectOffer = {
  firstRun?: number;
  // Its row: a letter for its mark, its title, and what it brings.
  mark: string;
  title: string;
  about: string;
  // What one of its items is, counted, such as "issue" or "file".
  counts: string;
  // A connection that read nothing, said in its row.
  empty: string;
  // What a person keeps there, such as "your Jira" or "your notes", and
  // where nothing changes until they approve, such as "your files".
  yours: string;
  changes: string;
  // What a person follows in a workstream, such as "an epic"; "something"
  // where it has no such thing.
  follow?: string;
  // Its first sync read, or failed while another's read.
  ready: string;
  catchUp: string;
  // The overview's card while it isn't connected: what it brings, and
  // what it adds when only connections Oriel reads and never changes are.
  // `connected`: said after what a connection that read nothing reads.
  invite?: { note: string; readOnly: string; connected: string };
};

// What the composition root lends a step's server half.
export type ConnectVia = {
  // How requests reach the source: the global fetch unless given, as tests
  // give one that answers from memory.
  fetch?: typeof fetch;
  // What its `client` names, as the composition root has them: Oriel's own
  // client of the source, such as Google's, never a person's secret.
  client?: Readonly<Record<string, string>>;
  // The composition root's clock, which tokens' ends are read against;
  // the system's when absent.
  now?: () => Instant;
  // Whether any account or site may be connected, as on the desktop app;
  // otherwise only the ones Oriel's own tests use (SPEC §4).
  anywhere: boolean;
  log: Log;
};

// Why a step refused what the person gave, in their words, never quoting
// a value; and the fields it is about, for the window to mark.
export type ConnectRefusal = { problem: string; fields?: readonly string[] };

// One of a pick step's list, such as a Jira project.
export type PickChoice = {
  value: string;
  name: string;
  // How many items it holds, and when it last changed, when the source says.
  count: number | null;
  updatedAt: string | null;
};

// A connection as its connector made it: its options, and its secret as one
// value. `reading`: what its first sync reads and how many records it
// holds, for the first run's progress, when the source says.
// `name`: what the window calls it, such as the account's email, when
// the source says.
export type Made = {
  options: Record<string, unknown>;
  secret?: string;
  name?: string;
  reading?: { name: string; total: number | null };
};

// `G` is what the person gives across the steps, and `P` what the pick
// step's list is fetched from. Both carry what identifies the connection.
export type ConnectOf<G = unknown, P = unknown> = {
  steps: readonly ConnectStep[];
  offer: ConnectOffer;
  given: Described<G>;
  // While a kind opens one connection (OA-225), a new one takes the place of
  // the open one, as another folder picked does. Otherwise it is refused.
  replaces?: true;
  // What it identifies in its source, such as Jira's site or the folder's
  // real path, before anything reaches the source.
  identify(given: G | P, via: ConnectVia): Promise<string | ConnectRefusal>;
  // Why another than the kind's one connection is refused, while it opens
  // one (OA-225), naming the one it has: live, or disconnected before.
  taken(first: string, live: boolean): ConnectRefusal;
  // What a connection reads, in a word or two, such as Jira's project or
  // the folder's name.
  reads(connection: { identity: string; options: Readonly<Record<string, unknown>> }): string;
  // Checks what the person gave against the source, and makes the
  // connection to the thing `identity` names.
  make(given: G, identity: string, via: ConnectVia): Promise<Made | ConnectRefusal>;
  // What the person sees when the connection it made can't open, or its
  // first sync fails: nothing is kept then.
  failed: { open: string; sync: string };
  // The pick step's list, `query` narrowing it. `from`: the same list's
  // input for a connection it made, from its identity and secret, so
  // Settings can pick again; null when its secret doesn't give one.
  pick?: {
    given: Described<P>;
    from?(connection: ToOpen): P | null;
    list(
      given: P,
      identity: string,
      query: string,
      via: ConnectVia,
    ): Promise<{ choices: PickChoice[]; more: boolean } | ConnectRefusal>;
  };
  // A browser step's server half: a sign-in begun at `url`, which the window
  // opens in the person's browser, and what it gave once they finished
  // there, or why not. What it gives stays on the server.
  browser?: {
    begin(
      via: ConnectVia,
    ): Promise<{ url: string; done: Promise<G | ConnectRefusal> } | ConnectRefusal>;
  };
  // Oriel's own client of the source, such as Google's, by the `.env` names
  // `pnpm dev` reads it from; the desktop app has it once its release build
  // does. Without it, the window says `absent` and doesn't connect it.
  // `optional` names are given when set, and their absence isn't missed:
  // Google's client works without its secret.
  client?: { env: readonly string[]; optional?: readonly string[]; absent: string };
  // Signed in again, its options, from those it had and those the steps
  // gave; those it had, with the steps' over them, when absent. Sheets keeps
  // its mappings and adds any spreadsheet picked anew.
  again?(
    kept: Readonly<Record<string, unknown>>,
    made: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;
  // Whether a connection kept from an earlier start opens as this one
  // starts: false when its source turns it away now, as it does a revoked
  // token, so the window asks for it again. One that can't be reached opens.
  vet?(connection: ToOpen, via: ConnectVia): Promise<boolean>;
};

// A live connection a flag makes at start under `pnpm dev`, from `.env` and
// the flag's options: what it identifies, its options and its secret; or
// why it can't be made, naming what to set, never a value.
export type LiveOf = {
  // The `.env` names it reads: the only ones it is given.
  env: readonly string[];
  connection(
    env: Readonly<Record<string, string>>,
    options: Readonly<Record<string, string>>,
  ):
    | { identity: string; options: Record<string, unknown>; secret: string | null }
    | { problem: string };
};

// What every connection has, whatever its connector (decision 0049), set
// beside its connector's options: its name in the window, null for its
// connector's; and how often it syncs while Oriel is open, in minutes, null
// for when Oriel starts and when asked. No connector's options use these
// names, which a test checks.
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

// A draft of a connection's options as Oriel draws it from its source, never
// from the drafter's words (decision 0051): each table it would read, with
// each column by its name in the source, such as its letter, the header the
// source has there and the field it would feed, if any; the first rows as
// the source shows them; and what it reads and leaves out, in lines.
//
// `at` is the table's place in its source, as its preview gives it, which an
// edit names it by. `reads` is how it reads, for the review step's controls:
// its header row, where it ends, whether rows hidden by hand are read, and
// each field's column by its name in the source; null when it isn't read.
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

// What a preview reads (OA-232): `first`, tables by their `at`, read
// before any other, so one the person asks about is always there; `names`,
// each table's name and place alone, with no row, as Settings lists them.
export type PreviewAsk = { first?: readonly string[]; names?: true };

// One table as Settings sums it up (OA-232): its name and place, and how it
// reads in one line, such as "key ID · title Story", or null when it isn't
// read.
export type ReviewOutline = { at: string; name: string; reads: string | null };

// One change a person makes to a draft in the review step, to a table by
// its `at`: whether it's read; which column feeds a field, by the column's
// name in the source, or none; its header row; where it ends; whether rows
// hidden by hand are read.
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

// A field a column can feed, by its name, with its label; every table
// read maps the `required` ones.
export type ReviewField = { name: string; label: string; required: boolean };

// How Oriel helps a person set a connection's options while it waits for
// them (decision 0051), from its preview. A draft names what it reads the
// way the preview shows it, such as columns by letter, so a header can't
// steer what the card says; applying it settles it into options against the
// source as it is then, such as each letter's header.
export type ReviewOf = {
  // A draft, as the agent writes it and the card holds it, with a line on
  // how to write one, in the connector's own words, for the agent's module.
  draft: Described<Record<string, unknown>>;
  doc: string;
  // Whether options that check out still leave it nothing to read, as
  // spreadsheets picked with no tab mapped do, so it waits for its options.
  waits(options: Readonly<Record<string, unknown>>): boolean;
  // Its options, from a draft and the preview read now, over the options it
  // has; or why the draft no longer fits what the source shows.
  settle(
    draft: Readonly<Record<string, unknown>>,
    tables: readonly PreviewTable[],
    options: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> | { problem: string };
  // Oriel's own guess at a draft, calling no model, as the card shows with
  // no AI set up, or before the agent's draft arrives; null when it has none.
  guess(tables: readonly PreviewTable[]): Record<string, unknown> | null;
  draw(draft: Readonly<Record<string, unknown>>, tables: readonly PreviewTable[]): ReviewTable[];
  // What a column can feed, in the order the review step lists them.
  fields: readonly ReviewField[];
  // Each table, from the preview's names, and how the options read it.
  outline(
    options: Readonly<Record<string, unknown>>,
    tables: readonly PreviewTable[],
  ): ReviewOutline[];
  // The draft that reads as a connection's options do now, from its
  // preview, for the review step to show and the person to change: a table
  // whose mapping no longer fits what its source shows is left out.
  current(
    options: Readonly<Record<string, unknown>>,
    tables: readonly PreviewTable[],
  ): Record<string, unknown>;
  // A draft with one of the person's edits made; or why it can't be.
  edit(
    draft: Readonly<Record<string, unknown>>,
    edit: ReviewEdit,
    tables: readonly PreviewTable[],
  ): Record<string, unknown> | { problem: string };
  // What options set over those a connection has do to the items it
  // synced, in plain sentences, said before they apply: such as a new key,
  // which makes every row a new item (decision 0050). None when nothing
  // synced goes.
  said(
    before: Readonly<Record<string, unknown>>,
    after: Readonly<Record<string, unknown>>,
    tables: readonly PreviewTable[],
  ): string[];
};
