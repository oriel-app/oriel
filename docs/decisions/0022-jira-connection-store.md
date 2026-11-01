# 0022 Where a Jira connection made in the window is kept

Accepted 2026-10-31, as an interim decision. It will be superseded when Oriel becomes a desktop app, where an OS keychain can hold the connection instead.

Adds: none

**Decision.**

- A Jira connection the user makes in the window (site, project, email and API token) is kept in one file, `secrets/jira.json`, beside the code and not in the database.
- The server writes it as a temp file created with mode 0600, then renames it into place, in a directory created with mode 0700. It reads it once, at start.
- `.env` still wins. When it names Jira, the window can't connect another.
- At start, a saved connection is checked against the site again. If Jira refuses it, or it names a site Oriel doesn't connect to, it's dropped, and the window asks for Jira again. If the site can't be reached, the connection is kept.
- The token reaches a `Credential` and this file, and nothing else: no reply, log line, telemetry event or error message. The file's own parse errors aren't passed on, since they would quote it.
- Only the throwaway site can be connected until pilots need their own.
- The window connects once. Changing a connection, or disconnecting, comes later.

**Why.**

- Most PMs won't edit `.env` or restart a server, and the onboarding budget (SPEC §4) starts at connect.
- The database is the wrong home for a token. It gets copied, inspected and attached to bug reports, and agents read it while dogfooding.
- `secrets/` is already gitignored, and `.claude/settings.json` already denies agents `Read(secrets/**)`.
- A file the owner alone can read is as strong as `.env` on localhost, with no new dependency.

**Rejected.**

- An OS keychain. A pilot's hosted instance has none. On a desktop app that reason goes away, which is why this decision is interim.
- Encrypting the file. The key would be kept in the same place, which adds nothing on one machine.

**Consequences.**

- Each pilot instance keeps its own connection on its volume. Anyone with the instance's secret link can connect Jira once, but can't read the token back.
- A hosted instance needs `secrets/` on persistent storage.
- When Oriel connects to a site other than the throwaway one, the server must check that site against an allowlist before it sends credentials, or a typed site becomes a request to an arbitrary host.
- `ConnectionStore` in `packages/server/src/connection.ts` is the seam a keychain store replaces. The rest of the undo is listed in the desktop credential-store story.
