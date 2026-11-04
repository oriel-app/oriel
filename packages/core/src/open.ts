// A connection, opened by its connector (decision 0049): what the
// composition root runs for it, from its options and its secret. The server
// syncs, reads, recognizes and builds a namespace and a writer through what
// `open` gives, the same way for every connector, so it keeps no branch per
// source.
import type { Instant, ItemId, SourceKind, Ulid } from "./ids.ts";
import type { Log } from "./run.ts";
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
};

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
  // What its records name that isn't an item, such as Slack's channels and
  // authors, by ID, for what a change set wrote.
  names?(records: readonly IndexRecord[]): Iterable<readonly [string, string]>;
  // Removes anything it made, such as a fixture's temporary folder.
  close?(): void;
};
