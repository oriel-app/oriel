// A connection, opened by its connector (decision 0049): what the
// composition root runs for it, from its options and its secret. The server
// syncs, reads, recognizes and builds a namespace and a writer through what
// `open` gives, the same way for every connector, so it keeps no branch per
// source.
import type { Instant, ItemId, SourceKind, Ulid } from "./ids.ts";
import type { Log } from "./run.ts";
import type { ThroughServer } from "./servers.ts";
import type { FieldValues, IndexRecord, Source } from "./source.ts";
import type { Validator } from "./validate.ts";

// A connection as its connector opens it.
export type ToOpen = {
  id: Ulid;
  number: number;
  // Whose its items are: its kind, with its number after the first, as
  // `jira` or `folder.2`.
  prefix: string;
  // What identifies it in its source, such as Jira's site or the folder's
  // path.
  identity: string;
  options: Readonly<Record<string, unknown>>;
  // Its secret, as one value; null when it keeps none.
  secret: string | null;
};

// Oriel's own store of a stand-in's items (decision 0059), which the
// composition root lends the connector that declares a stand-in: their index
// rows, which are their source of truth, as nothing syncs them, and what each
// keeps beyond its row.
export type OwnItems = {
  // Its live records, as the index has them now.
  records(): readonly IndexRecord[];
  // What a live item keeps beyond its row, as its connector wrote it, or null.
  content(stableId: string): unknown;
  // Every key its items have had, gone ones too, so none is given twice.
  keys(): readonly string[];
  // Lands `records`, each with its text for search and its content, and
  // takes `gone` away, in one transaction with their change log entries,
  // once no sync is running: the overview, Browse and search see it at once.
  // `what` is what the write was, for telemetry, never its words: who made
  // it, whether it created, edited or deleted the item, and the fields it
  // set, by name.
  write(change: {
    records: readonly IndexRecord[];
    texts: Readonly<Record<string, string>>;
    contents: Readonly<Record<string, unknown>>;
    gone: readonly string[];
    what: OwnWrite;
  }): Promise<void>;
};

export type OwnWrite = {
  by: "person" | "change-set";
  change: "created" | "edited" | "deleted";
  fields: readonly string[];
};

// What the composition root lends a connector to open a connection with.
export type OpenVia = {
  // How requests reach the source: the global fetch unless given, as tests
  // give one that answers from memory, and a fixture its stand-in.
  fetch?: typeof fetch;
  // Whether a person made it in the window, and so signs in to it again
  // there, rather than a flag at start.
  kept: boolean;
  log: Log;
  now: () => Instant;
  // Oriel's own client of the source, as its connector's `client` names it,
  // such as Google's, which refreshes a token. Absent where there's none.
  client?: Readonly<Record<string, string>>;
  // Keeps the connection's secret anew, as a refreshed token is, for its
  // next start. Absent for a flag's connection, which keeps none.
  keep?(secret: string): Promise<void>;
  // Oriel's own store of its items, for a stand-in's connection; absent
  // for any other.
  own?: OwnItems;
  // The source server its kind is on through (decision 0059), which it
  // reads and writes through in place of its own connection's: absent
  // while it's on through a connection.
  server?: ThroughServer;
};

// Why a new connection waits, as one of a connector with a preview does
// while its options don't check out (decision 0051).
export const noOptionsYet = "It has no options yet.";
// What preview() says of a connection that reads, whose options the agent
// drafts only when the person asks for a change (OA-232).
export const readsNow = "It reads with these options. Draft a change only when the user asks.";

// Why a connection can't open: its options no longer fit its source, such
// as a channel they name gone, so it waits for its options (decision 0051),
// rather than for a person to sign in again. Its message names what doesn't
// fit, never a secret.
export class OptionsUnfit extends Error {
  override name = "OptionsUnfit";
}

// The read side a change set's diff needs: field values as they are now in
// the source. Not `Reader`, which reads whole items for a run.
export type FieldReader<K extends SourceKind = SourceKind> = {
  // Field names as in the source's op specs; "gone" when the item no longer
  // exists or can't be seen.
  current(id: ItemId<K>, fields: readonly string[]): Promise<FieldValues | "gone">;
  // What a person calls an ID an op names, for a diff line; null when
  // unknown.
  name(id: string): Promise<string | null>;
};

// An open connection. `C` is what its namespace takes, `R` what its
// recognizer does, and `W` what its writer is built from.
export type Opened<C = unknown, R = unknown, W = unknown> = {
  // Syncs into the index under the connection's prefix, and reads its items.
  source: Source<SourceKind, unknown>;
  // Its index records' attrs.
  attrs: Validator<unknown>;
  // What identifies it, where opening found it, as a token says which Slack
  // workspace it reads; its connection's identity when absent.
  identity?: string;
  // What it reads, as the sidebar says it, such as "SYN on acme.atlassian.net".
  about: string;
  // Its recognizer's scope, such as the projects it syncs.
  scope: R;
  // Its namespace's context, asked for each time a region's bindings are
  // built, as what Jira's boards estimate in changes with each sync.
  context: () => C;
  // What `packages/changeset/src/writers.ts` builds its writer from, with
  // the line its connector has there. Without it the connection is
  // read-only: no writer is built, so a write is unreachable.
  writes?: W;
  // How its change sets read current values while it has no writer, so they
  // can still be shown.
  fields?: FieldReader;
  // A person's own edit of one of its items in its panel, applied at once,
  // for a stand-in (decision 0059): never the agent's, whose writes are
  // change sets. It sets `values`, by the names its panel's form gives,
  // which it checks, and gives what they were before, which its Undo sets
  // back, and what they are now. It throws a RangeError for a field it
  // doesn't know or a value it can't take, and for an item it doesn't have.
  // Absent: its items change only through change sets.
  edit?(
    id: ItemId,
    values: Readonly<Record<string, unknown>>,
  ): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
  // A fixture frozen as of this instant: the window is built for it, so its
  // "stuck" rules come out the same on every run, and nothing syncs it but
  // the start and a Sync asked for.
  frozen?: Instant;
  // Its source lists changes since its cursor, so a sync between the Syncs
  // a person asks for needn't sweep everything. Otherwise every sync does.
  incremental?: true;
  // How long its listing may lag a write. Until then each sync reads what
  // Oriel wrote by key, as Jira's search finds a write only a while after.
  lagMs?: number;
  // A sync that failed, in the person's words.
  problem(error: unknown): string;
  // What its last sync or read left out, and why, in the person's words, a
  // line each, such as rows that share a key, by row number, or what a cap
  // stopped. Settings shows them under the connection. None is empty.
  report?(): readonly string[];
  // Whether its source turned its sign-in away since it opened, as Google
  // refusing a refresh does: it reads as signed out, and signing in to it
  // again in the window reopens it, keeping its number and items.
  signedOut?(): boolean;
  // Why its options no longer fit its source, from its last sync, such as a
  // mapped column gone, so it waits for options (decision 0051); null
  // while they fit.
  unfit?(): string | null;
  // Why it's read-only whatever its `readOnly` option says, from its
  // records, as a spreadsheet the person can only view is: `all` when none
  // of it can be written, so Settings shows its switch locked.
  viewOnly?(records: readonly IndexRecord[]): { why: string; all: boolean } | null;
  // What its records name that isn't an item, such as Slack's channels and
  // authors, by ID, for what a change set wrote.
  names?(records: readonly IndexRecord[]): Iterable<readonly [string, string]>;
  // Removes anything it made, such as a fixture's temporary folder.
  close?(): void;
};
