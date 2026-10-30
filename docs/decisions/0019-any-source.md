# 0019 Any source: a small item contract, and a local folder source

Accepted 2026-10-29.

Adds: none

**Decision.**

- **Core knows items, not Jira.** An item has:
  - a source-qualified ID;
  - a title;
  - a location (a URL or a path);
  - an update time;
  - its content as text;
  - optional facets: people by role, a state category, a parent or container, and links.

  Source-specific fields, such as Jira's issue type, story points and field IDs, live in that source's adapter. `JiraAttrs` and `jiraOps` move from core into `packages/jira`.

- **A source declares what it can do:** list, read, search, and optionally a catalogue of write operations. A read-only source has none, so its items can be read and discussed but never changed. A thread over only read-only items settles as handed off or dropped.
- **Groupings work on facets,** so one grouping can span sources.
- **The agent's module** has generic `items.*` and `search()` for every item, plus a namespace per writable source.
- **Phase 1's second source is a local folder of markdown files,** read-only.
  - The user picks one folder. Oriel reads the `.md` files inside it and nothing else.
  - No path leaves the folder: paths are resolved and checked, symlinks aren't followed, dotfiles and dot-directories (`.env`, `.git`) are skipped, and files over a size cap are listed but not read.
  - An item's ID is `folder:<relative path>`, checked like any key. Its location is the file's path, and its update time is the file's modification time.
  - File content is data, like any source content: it never goes into a system prompt.

**Why.**

- The maintainer's model is curation across any kind of source, without an opinion about what belongs in a group.
- Jira had leaked into core, groupings, bindings and change sets. A second source in the first slice, a real and unstructured one, keeps the contract honest.
- A folder needs no account, so it fits running on localhost first.

**Consequences.**

- Core shrinks and adapters grow. Groupings, bindings and change sets reach source-specific behaviour only through registries the adapters fill.
- The synthetic chat channel comes after the slice.
- Sharing notes between users waits for multiplayer. Until then, a teammate's note can arrive as a file.
