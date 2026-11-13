// What these return is the model's, the user's or the sources' words, so it reaches the agent only as a run's result.
// What other threads said or wrote is content from outside the region, so reading it is on the record as search() is.
import {
  changeSetStates,
  isUlid,
  number,
  optionalParam,
  param,
  read,
  refine,
  string,
  threadStates,
} from "@oriel/core";
import type { Fn, Host } from "./fn.ts";

const threadId = refine(string, isUlid, "expected a thread's id");

const listWorkstreams: Fn = {
  space: "workstream",
  outsideRegion: false,
  fields: {
    source: "your workstreams",
    lists: { "": { name: "Workstream", threads: "Threads", done: "Done" } },
  },
  ...read({
    name: "list",
    doc: "Every workstream, newest first, with its items' IDs.",
    params: [],
    returns: "readonly OrielWorkstream[]",
    run: (_, host: Host) => host.oriel.workstreams(),
  }),
};

const listThreads: Fn = {
  space: "thread",
  outsideRegion: false,
  fields: {
    source: "your threads",
    lists: { "": { name: "Thread", state: "State", activityAt: "Last active" } },
  },
  ...read({
    name: "list",
    doc: "Every thread, most recently active first.",
    params: [],
    returns: "readonly OrielThread[]",
    run: (_, host: Host) => host.oriel.threads(),
  }),
};

const changeSets: Fn = {
  space: "thread",
  outsideRegion: true,
  ...read({
    name: "changeSets",
    doc: "A thread's change sets, or every thread's, newest first: what each wrote where.",
    params: [optionalParam("thread", "string", threadId)],
    returns: "readonly OrielChangeSet[]",
    run: ([thread], host: Host) => host.oriel.changeSets(thread ?? null),
  }),
};

const changeSetId = refine(string, isUlid, "expected a change set's id");
// The host checks the set now and the engine again when the turn ends.
const reviseChangeSet: Fn = {
  space: "thread",
  outsideRegion: false,
  ...read({
    name: "revise",
    doc: "To change a change set you proposed in this thread that nobody has decided on: this run's writes replace its changes, and it keeps its ID and review link.",
    params: [param("changeSet", "string", changeSetId)],
    returns: "string",
    run: async ([id], host: Host) =>
      host.revise ? host.revise(id) : "Oriel revises a change set only in a thread's turn.",
  }),
};

const findThreads: Fn = {
  space: "thread",
  outsideRegion: true,
  ...read({
    name: "find",
    doc: "Threads and change sets by name, what was said and what was written, best first.",
    params: [param("query", "string", string), optionalParam("limit", "number", number)],
    returns: "readonly ThreadFound[]",
    run: ([query, limit], host: Host) =>
      host.oriel.find(query, Math.min(Math.max(Math.trunc(limit ?? 10), 1), 50)),
  }),
};

export const orielFns: readonly Fn[] = [
  listWorkstreams,
  listThreads,
  changeSets,
  reviseChangeSet,
  findThreads,
];

const union = (values: readonly string[]) => values.map((v) => JSON.stringify(v)).join(" | ");

// Fixed, whatever the workspace holds.
export const orielTypes = [
  "type OrielWorkstream = { id: string; name: string; items: string[]; threads: number; done: boolean };",
  `type OrielThread = { id: string; name: string | null; state: ${union(threadStates)}; workstream: { id: string; name: string }; activityAt: string };`,
  "/** Revert, in its thread, undoes an applied one. */",
  `type OrielChangeSet = { id: string; thread: string; state: ${union(changeSetStates)}; createdAt: string; decided: { kind: "approved" | "rejected"; by: string; at: string } | null; changes: { source: string; sentence: string; text: string[] }[] };`,
  'type ThreadFound = { thread: OrielThread; changeSet: OrielChangeSet | null; matched: "name" | "chat" | "change-set"; excerpt: string };',
];
