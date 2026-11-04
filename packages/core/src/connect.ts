// How a person makes a connection through a connector (decision 0049): the
// steps the window draws, the same way for every connector; what the
// person gives across them, checked by the connector's own validator; and
// each step's server half, such as checking a site or listing its projects,
// which is the connector's own code. Under `pnpm dev`, how a flag's live
// connection is made from `.env`.
import type { ToOpen } from "./open.ts";
import type { Log } from "./run.ts";
import type { Described } from "./validate.ts";

// One step of making a connection. `fields`: what the person types, each by
// its name and whether it is secret. `folder`: a folder, from the system's
// picker through the shell or a typed path, into `field`. `pick`: one from
// a list the connector fetches from what the steps before gave, into
// `field`.
export type ConnectStep =
  | { kind: "fields"; fields: readonly { name: string; secret?: true }[] }
  | { kind: "folder"; field: string }
  | { kind: "pick"; field: string };

// What the composition root lends a step's server half.
export type ConnectVia = {
  // How requests reach the source: the global fetch unless given, as tests
  // give one that answers from memory.
  fetch?: typeof fetch;
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
export type Made = {
  options: Record<string, unknown>;
  secret?: string;
  reading?: { name: string; total: number | null };
};

// `G` is what the person gives across the steps, and `P` what the pick
// step's list is fetched from. Both carry what identifies the connection.
export type ConnectOf<G = unknown, P = unknown> = {
  steps: readonly ConnectStep[];
  given: Described<G>;
  // While a kind opens one connection (OA-225), a new one takes the place of
  // the open one, as another folder picked does. Otherwise it is refused.
  replaces?: true;
  // What it identifies in its source, such as Jira's site or the folder's
  // real path, before anything reaches the source.
  identify(given: G | P, via: ConnectVia): Promise<string | ConnectRefusal>;
  // Why another than the kind's one connection is refused, while it opens
  // one (OA-225), naming the one it has, if it's live.
  taken(live: string | null): ConnectRefusal;
  // Checks what the person gave against the source, and makes the
  // connection to the thing `identity` names.
  make(given: G, identity: string, via: ConnectVia): Promise<Made | ConnectRefusal>;
  // What the person sees when the connection it made can't open, or its
  // first sync fails: nothing is kept then.
  failed: { open: string; sync: string };
  // The pick step's list, `query` narrowing it.
  pick?: {
    given: Described<P>;
    list(
      given: P,
      identity: string,
      query: string,
      via: ConnectVia,
    ): Promise<{ choices: PickChoice[]; more: boolean } | ConnectRefusal>;
  };
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
