// The one file in the repo that builds writers (decision 0003). Each comes from
// the config the composition root passes in, how to reach that source, so a
// writer object never exists outside packages/changeset, and no code that a
// thread or the agent runs can reach one. scripts/check-repo.ts allows an
// `@oriel/<kind>/writer` import here and in an adapter's own writer files,
// nowhere else.
import type { Credential, Log, SourceKind, SourceWriter } from "@oriel/core";
import { type JiraBoards, jiraWriter, restTransport } from "@oriel/jira/writer";

// How to reach each writable source to write to it. A source with no config
// here is read-only to change sets.
export type WriterConfig = {
  jira?: {
    // An https origin, such as "https://oriel.atlassian.net".
    site: string;
    credential: Credential;
    // Where a story with no epic is created.
    project: string;
    // How requests reach the site: the global fetch unless given, as tests
    // give one that answers from memory. The transport and the writer are
    // still built here, never by the caller.
    fetch?: typeof fetch;
    // What each board estimates in, shared with the source that syncs it.
    // Without it, the writer finds each board's once.
    boards?: JiraBoards;
  };
} & { [K in Exclude<SourceKind, "jira">]?: never };

// Each writable source's writer, by kind.
export type Writers = { [K in SourceKind]?: SourceWriter<K> };

export function buildWriters(config: WriterConfig, log: Log): Writers {
  const { jira } = config;
  return jira
    ? {
        jira: jiraWriter({
          transport: restTransport({
            site: jira.site,
            credential: jira.credential,
            ...(jira.fetch ? { fetch: jira.fetch } : {}),
          }),
          project: jira.project,
          ...(jira.boards ? { boards: jira.boards } : {}),
          log,
        }),
      }
    : {};
}
