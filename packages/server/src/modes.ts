// The connections `pnpm dev`'s flags make at start, and tests' options as
// they make them, until `--source <kind>=<mode>` replaces `--jira` and
// `--slack` (decision 0049, OA-214). Each is its kind's first connection,
// opened through its declaration's `open`, or its fixture's over the
// fixture's stand-in. It keeps no secret: `.env` holds that, and a fixture
// needs none.
import type { SourceKind } from "@oriel/core";
import type { FixtureWorkspace } from "@oriel/slack";
import { declarationOf } from "@oriel/sources";
import type { LegacyJira } from "./connection.ts";

// Where Jira comes from. The fixture is SYN as `fixtures/jira/` freezes it,
// read-only unless tests give it a stand-in site to write to (`fetch`) that
// holds the same items. Live is a site, read through the API and written to
// through approved change sets, as the account given. From the window is
// live too, once the person connects it there; the connection is kept as
// connections are, so it's there again the next time the server starts.
// `legacy` is where it was kept before connections, from which the first
// start moves it. `anySite`: any Jira Cloud site may be connected, as on the
// desktop app (decision 0038); otherwise only the throwaway one. `fetch` is
// for tests, which answer from memory; the global fetch is used without it.
export type JiraMode =
  | { kind: "fixture"; fetch?: typeof fetch }
  | {
      kind: "live";
      site: string;
      account: { email: string; token: string };
      project: string;
      fetch?: typeof fetch;
    }
  | { kind: "window"; legacy?: LegacyJira; anySite?: boolean; fetch?: typeof fetch };

// Where Slack comes from (decision 0021). The fixture is the synthetic
// workspace in `fixtures/slack/`, with the channel picked there, which change
// sets post to in memory. Live is the workspace a token is for, reading only
// the public channels picked by name or ID; one it can't find stops the app
// from starting. Change sets a person approves post there as the token's
// person, only in those channels (OA-28).
export type SlackMode =
  // Tests may pass the fixture's workspace in, to act in it as others do.
  | { kind: "fixture"; workspace?: FixtureWorkspace }
  | { kind: "live"; token: string; channels: string[]; fetch?: typeof fetch };

// A connection a flag makes: its kind, whether it's the kind's fixture, what
// it identifies, its options and its secret, and how requests reach it.
// Slack's identity is the workspace its token is for, which opening finds.
export type Flagged = {
  kind: SourceKind;
  fixture: boolean;
  identity: string;
  options: Record<string, unknown>;
  secret: string | null;
  fetch?: typeof fetch;
};

const fixtureOf = (kind: SourceKind, send?: typeof fetch): Flagged => ({
  kind,
  fixture: true,
  ...(declarationOf(kind)?.fixture.connection() ?? { identity: "", options: {} }),
  secret: null,
  ...(send ? { fetch: send } : {}),
});

export function flagged(jira: JiraMode, slack: SlackMode | undefined): Flagged[] {
  return [
    ...(jira.kind === "fixture" ? [fixtureOf("jira", jira.fetch)] : []),
    ...(jira.kind === "live"
      ? [
          {
            kind: "jira",
            fixture: false,
            identity: jira.site,
            options: { project: jira.project },
            secret: JSON.stringify(jira.account),
            ...(jira.fetch ? { fetch: jira.fetch } : {}),
          },
        ]
      : []),
    ...(slack?.kind === "fixture" ? [fixtureOf("slack", slack.workspace?.fetch)] : []),
    ...(slack?.kind === "live"
      ? [
          {
            kind: "slack",
            fixture: false,
            identity: "",
            options: { channels: slack.channels },
            secret: slack.token,
            ...(slack.fetch ? { fetch: slack.fetch } : {}),
          },
        ]
      : []),
  ];
}
