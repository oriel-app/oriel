// The one file in the repo that builds writers (decision 0003). Each comes from
// the config the composition root passes in, how to reach that source, so a
// writer object never exists outside packages/changeset, and no code that a
// thread or the agent runs can reach one. scripts/check-repo.ts allows an
// `@oriel/<kind>/writer` import here and in an adapter's own writer files,
// nowhere else.
import type { Credential, Log, SourceKind, SourceWriter } from "@oriel/core";
import { jiraWriter, restTransport } from "@oriel/jira/writer";

// How to reach each writable source to write to it. A source with no config
// here is read-only to change sets.
export type WriterConfig = {
  jira?: {
    // An https origin, such as "https://oriel.atlassian.net".
    site: string;
    credential: Credential;
    // Where a story with no epic is created.
    project: string;
  };
} & { [K in Exclude<SourceKind, "jira">]?: never };

// Each writable source's writer, by kind.
export type Writers = { [K in SourceKind]?: SourceWriter<K> };

export function buildWriters(config: WriterConfig, log: Log): Writers {
  const { jira } = config;
  return jira
    ? {
        jira: jiraWriter({
          transport: restTransport({ site: jira.site, credential: jira.credential }),
          project: jira.project,
          log,
        }),
      }
    : {};
}
