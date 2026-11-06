// The one file in the repo that builds writers (decision 0003). Each comes
// from what an open connection's connector gave it to be built from, so a
// writer object never exists outside packages/changeset, and no code that a
// thread or the agent runs can reach one. scripts/check-repo.ts allows an
// `@oriel/<kind>/writer` import here and in an adapter's own writer files,
// nowhere else.
import type { Log, SourceKind, SourceWriter } from "@oriel/core";
import { jiraWriterOf } from "@oriel/jira/writer";
import { sheetsWriterOf } from "@oriel/sheets/writer";
import { slackWriterOf } from "@oriel/slack/writer";
import { trackerWriterOf } from "@oriel/tracker/writer";

// One line per writable connector: its `./writer` export, which builds a
// writer from what its declaration's `open` gave a connection (decision
// 0049). The declaration can't name it, or everything that imports the
// declarations would reach a writer. A test checks this list against the
// declarations with op specs.
const lines = {
  jira: jiraWriterOf,
  slack: slackWriterOf,
  sheets: sheetsWriterOf,
  tracker: trackerWriterOf,
};

// The kinds with a line here.
export const writableKinds: readonly SourceKind[] = Object.keys(lines);

// The open connections that may propose changes: each one's prefix, its
// connector's kind, and what its open gave its writer (`Opened.writes`). A
// connection left out is read-only to change sets.
export type WriterConfig = readonly { prefix: string; kind: SourceKind; writes: unknown }[];

// Each writable connection's writer, by its prefix.
export type Writers = Partial<Record<string, SourceWriter>>;

export function buildWriters(config: WriterConfig, log: Log): Writers {
  return Object.fromEntries(
    config.map(({ prefix, kind, writes }) => {
      const line = Object.hasOwn(lines, kind) ? lines[kind as keyof typeof lines] : undefined;
      if (!line) throw new Error(`${kind} has no line in writers.ts, so it can't write`);
      // What the connector's own `open` gave, which its own line takes.
      return [prefix, line(writes as never, log)];
    }),
  );
}
