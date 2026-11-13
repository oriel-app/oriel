// The one file that builds writers, so a writer never exists outside packages/changeset and no code a thread or the agent
// runs can reach one. scripts/check-repo.ts allows an `@oriel/<kind>/writer` import here and in an adapter's own writer files only.
import type { Log, SourceKind, SourceWriter } from "@oriel/core";
import { jiraWriterOf } from "@oriel/jira/writer";
import { linearWriterOf } from "@oriel/linear/writer";
import { sheetsWriterOf } from "@oriel/sheets/writer";
import { slackWriterOf } from "@oriel/slack/writer";
import { trackerWriterOf } from "@oriel/tracker/writer";

// The declaration can't name its writer, or everything that imports the declarations would reach one.
// A test checks this list against the declarations with op specs.
const lines = {
  jira: jiraWriterOf,
  linear: linearWriterOf,
  slack: slackWriterOf,
  sheets: sheetsWriterOf,
  tracker: trackerWriterOf,
};

export const writableKinds: readonly SourceKind[] = Object.keys(lines);

// A connection left out is read-only to change sets.
export type WriterConfig = readonly { prefix: string; kind: SourceKind; writes: unknown }[];

export type Writers = Partial<Record<string, SourceWriter>>;

export function buildWriters(config: WriterConfig, log: Log): Writers {
  return Object.fromEntries(
    config.map(({ prefix, kind, writes }) => {
      const line = Object.hasOwn(lines, kind) ? lines[kind as keyof typeof lines] : undefined;
      if (!line) throw new Error(`${kind} has no line in writers.ts, so it can't write`);
      return [prefix, line(writes as never, log)];
    }),
  );
}
