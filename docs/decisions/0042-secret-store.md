# 0042 The desktop app's secret store, and an API key from Settings

Accepted 2026-11-03 (OA-188). Amends 0022, 0039 and 0041. Changes SPEC §3, §5 and §7. Amended by 0049: the fixed names are `anthropic-key` and the shape `connection.<ULID>`, and `jira` moves to its connection's name, staying one release so the move can read it. Amended by 0059: the API key and the connection secrets go; the store keeps whatever is left. Superseded in part by 0059 (OA-280): the names `jira` and `connection.<ULID>` go, and the store takes `anthropic-key` alone. Amended 2026-11-08: the server keeps no secret; the shell deletes `anthropic-key` as its store opens, needing no key, and the name stays the store's only one so the channel stays whole for whatever keeps a secret next. `POST /settings/key` is gone.

Adds: none

**Decision.**

- **The store.** The shell answers `secret.get`, `secret.set` and `secret.delete` (0036's channel) with Electron's `safeStorage`, as 0039 has it. Each secret is encrypted with the key the OS keeps for Oriel, under Oriel's own name (the Keychain's "Oriel Safe Storage" on macOS, DPAPI on Windows, the secret service on Linux), and written whole, then renamed into place, to its own file in the data folder's `Secrets/`, readable by its owner only. Only ciphertext is ever on disk. A secret the OS has re-keyed is written again.
- **Never plaintext.** With no key from the OS, or on Linux with the `basic_text` backend (no keyring, so a fixed key) or none yet, the shell refuses every get and set. Delete needs no key, so a secret that can't be read can still be forgotten.
- **Fixed names.** The shell, and the server's protocol, take only the names the server uses: `jira`, the connection (0022's `ConnectionStore`), and `anthropic-key`, the API key. A source that later keeps a connection, such as Slack once Oriel's app is installable (0038), adds its name to both lists.
- **The API key from Settings,** on the desktop app only. The API key's row on the Providers page has a field. The server checks the key with one request that lists one model and runs none (0038), then keeps it in the store, and looks for every provider again, so the next turn can run on it. Remove deletes it. The page is told only whether a key is set; no reply, log or error carries it. Under `pnpm dev` the key stays `.env`'s, and the page can't set one, since its guard checks only Host and Origin (0041).
- **Reading it.** The model chooser reads the key at each look, through the store, which asks the shell once and keeps the answer in memory. The shell answers only once the server listens, so desktop mode's first look runs while the server starts rather than before it, and Settings says "Checking" until it ends.

**Why.**

- One file per secret keeps a write to one from ever touching another, and the fixed names keep a server bug from reading or writing a file the shell didn't expect.
- Keeping plaintext when the OS has no key would put a Jira token on disk for anyone who can read the data folder, which is what 0036 moved it off `secrets/` for.
- 0041 left the key out of the page until a store existed. The first run (0038) asks for one too; the same route serves both.

**Rejected.**

- **One file for every secret.** A write to one would rewrite all of them.
- **The key in `settings.json`,** even encrypted: 0041 keeps it free of credentials, and the page reads it.

**Consequences.**

- 0022: on the desktop app the connection is in this store; `secrets/jira.json` stays for `pnpm dev`.
- 0039: the store it named is built.
- 0041: an API key can be added from the page on the desktop app; Rejected's "Adding an API key from the page" holds for `pnpm dev` only. `POST /settings/key` joins its exempt routes.
- The first run's key field (OA-190, OA-191) posts to the same route.
