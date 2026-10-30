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

- **A source declares what it can do:** list, read, search, and optionally a catalogue of write operations. A read-only source has none, so its items can be read and discussed but never changed.
- **Groupings use facets** when they span sources. A grouping may also use one source's own fields through its adapter, and then it applies only to that source's items: "unestimated" is a Jira rule. A grouping never invents a hierarchy the source doesn't have, so a folder's directories aren't epics.
- **The agent's module** has generic `items.*` and `search()` over the region, plus a namespace per writable source.
- **Phase 1's second source is a local folder of markdown files,** read-only.
  - **What it reads:**
    - The user picks one folder. Oriel reads the `.md` files inside it and nothing else.
    - Dotfiles and dot-directories (`.env`, `.git`) and `node_modules` are skipped.
    - The walk stops at a depth, a file count and a total size.
    - A file over the per-file cap is listed with its title and update time; its content reads as a note that it's too large.
  - **No path leaves the folder:**
    - Paths are resolved and checked against the folder.
    - Symlinks aren't followed, and a file with more than one hard link is skipped.
    - Each file is opened without following links, then checked again after opening, so a race can't swap it.
  - **Identity:**
    - An item's ID is `folder:` plus a fixed-length hash of the folder's own ID and the file's canonical relative path: NFC, forward slashes, the case the directory lists. No file name reaches generated code; the name is the item's title, which is data.
    - Picking a different folder gives different IDs.
    - A renamed file is a removed item plus a new one. Phase 1 doesn't follow renames, and the marker says so.
  - File names and contents are data, like any source content: they never go into a system prompt or a `.d.ts`.

**Why.**

- The maintainer's model is curation across any kind of source, without an opinion about what belongs in a group.
- Jira had leaked into core, groupings, bindings and change sets. A second source in the first slice, a real and unstructured one, keeps the contract honest.
- A folder needs no account, so it fits running on localhost first.
- Hashed IDs keep user-written names out of generated code. The walk caps keep a folder like a home directory from flooding the index.

**Consequences.**

- Core shrinks and adapters grow.
- Groupings, bindings and change sets reach source-specific behaviour only through what each adapter declares.
- The folder source gets its own fixtures and evals (SPEC §8).
- A thread over only folder items has no change to apply. Under the four thread states it ends as dropped unless a writable item joins its group.
- The synthetic chat channel comes after the slice.
- Notes shared between users wait for multiplayer. Until then, a teammate's note can arrive as a file in the folder.
