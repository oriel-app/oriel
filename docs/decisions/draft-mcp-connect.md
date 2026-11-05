# Draft: connecting a program to Oriel, wherever Oriel runs

Draft 2026-11-06, one of four MCP spikes, for the hub to merge into one decision (OA-71, OA-72, OA-75). Builds on `draft-mcp.md` (branch `mcp-door`) and amends it where it says so. The spike is branch `mcp-connect`.

Adds: none

## Decision

- **Every Oriel opens the door, beside the window.** `serve()` starts it, so `pnpm dev` and the desktop app run the same code. It is a third loopback listener, after the window's and the sketch origin's, behind tool tokens rather than the launch secret. The window's rule stays as it is: no cookie of the window's opens the door (a test sends the launch cookie to the door and gets a 401), and the door has none of the window's routes.
  - **Its port is kept in the data folder**, as the window's is (0036): `mcp-port` beside `port`. On the desktop app the first launch tries 4430 and scans up. That range is clear of every port the window's own scan, from 4320, can take. Under `pnpm dev` it is the window's port plus one, kept in `.oriel/…/mcp-port`.
  - **Once kept, it never moves,** unlike the window's. A client's config names it, and the client sends its token there. If something else holds it at launch, the door stays closed, the window opens as usual, and Settings says why.
  - **It is always open.** `draft-mcp.md` opened it only once a tool was connected. A program signing in with OAuth needs the door before it has a token, and an open door with no tool lets nothing in. So it simply listens.

- **Outside tools are kept in the database, as hashes only** (migration `0028_outside_tools`). A tool's row holds the name the person gave it, its mode, what it said it is (never trusted), and the OAuth client it signed in as. Its tokens are SHA-256 hashes in a table of their own: a pasted token, which never expires, or an OAuth access token (an hour) and the refresh token that renews it (30 days, once, rotated). Revoke deletes the tokens and keeps the row, as the record of who acted.
  - **No Keychain, on any OS.** A hash proves nothing to whoever reads it, so nothing here is a secret for the OS store, and `pnpm desktop:try`, with its secrets in memory, runs the door unchanged.

- **The default way in is OAuth, with the consent in Oriel's own window.** `draft-mcp.md` turned OAuth down, because a loopback server can't serve a consent page that only the person reaches. The page doesn't have to decide anything. The window already is the person's page.
  1. A client meets the door's 401, whose `WWW-Authenticate` names the protected resource metadata. It reads the door's authorization server metadata, registers itself (Dynamic Client Registration, loopback redirects only), and opens the person's browser at `/authorize` with S256 PKCE.
  2. That browser page decides nothing. It shows a four-letter code and says to answer in Oriel's window, then looks again every two seconds, with no script.
  3. The window, behind the launch secret, shows the same code, the name the client gave itself, a name field (filled with it), and read only or read and act. Read only is the default. On the desktop app the server asks the shell to bring the window forward.
  4. The person lets it in or turns it away. Only then does the browser go back to the client's loopback redirect, with a code that only its PKCE verifier can spend, once, within a minute.

  What a client is given is a short-lived access token in the client's own credential store, and a refresh token. Nothing is pasted, no secret is ever on the clipboard or in a config file Oriel told the person to edit, and the command to paste is the same for everyone.

- **A pasted token stays, as the fallback,** for a client that can't sign in. In Settings: Add, a name, a mode, the token shown once, inside the exact text to paste for each client.

- **The stdio shim is for clients that only start commands.** `packages/server/src/mcp/shim.ts` reads JSON-RPC lines on stdin and posts each to the door, whose port it reads from the data folder at each message, so it follows Oriel to a new port. Its token comes from `ORIEL_TOKEN` in the client's config, as MCP says a stdio server's credentials should. It adds no trust.
  - Where its token comes from, weighed. Pairing on first use (the shim asks, the window lets it in) would need the shim to keep the token somewhere between launches. That is a plaintext token in Oriel's data folder, which is worse than one in the client's config, since one folder would then hold every program's. So a stdio client gets a pasted token, in a config block Settings writes whole. For a client that speaks HTTP, the URL and OAuth beat the shim on every count.
  - In the desktop app, the shim is the app's own binary with a shell switch, `Oriel --mcp`, added to `shellSwitches` and handled before the single-instance lock, with the Dock icon hidden. The spike didn't build that switch: running the built app any way but `pnpm desktop:try` is off limits. It proved the same code with Node, against the desktop app's door.
  - Its real worth on a shared machine is a later one: over a Unix socket in the data folder (0700), another account on the machine can neither reach the door nor impersonate it (see the threat below).

- **What each client is told** (Settings, Outside tools, from each client's own `--help`):

  | Client                                | Sign in (no token)                                                                           | With a token                                                                                                      |
  | ------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
  | Claude Code                           | `claude mcp add --transport http --scope user oriel <url>`, then `/mcp`, oriel, Authenticate | the same with `--header 'Authorization: Bearer …'`                                                                |
  | Codex                                 | `codex mcp add oriel --url <url>` and `codex mcp login oriel`                                | `[mcp_servers.oriel]` in `~/.codex/config.toml` with `http_headers` (its CLI takes a bearer only from an env var) |
  | An app that runs Claude Code or Codex | what it runs gets the server at user scope, so add it there                                  | the same                                                                                                          |
  | A program that starts a command       | none                                                                                         | a JSON block that starts the shim, with `ORIEL_TOKEN`                                                             |

  `--scope user` matters: an app that runs Claude Code for the person loads user-scoped servers, and not one in another project's local scope. No client has a deep link for adding an MCP server that the spike could find.

## Measured

On a throwaway fixture server (`pnpm dev`'s code, port 4390, door 4391) and on the desktop app under `pnpm desktop:try signed-out` (door 4430, kept in `data/mcp-port`).

| What                                                                      | Time                                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Settings, Outside tools, open (headless Chrome)                           | 149 ms                                                                |
| `codex mcp login` printed its URL; the browser page shows the code        | 272 ms; 483 ms                                                        |
| The window shows Codex asking                                             | 2,303 ms (the page's 2 s poll; the workspace stream would be at once) |
| The person clicks Let it in; Codex says "Successfully logged in"          | 2,439 ms; 2,510 ms                                                    |
| The same sign-in against the desktop app, the person's click scripted     | 86 ms from URL to logged in                                           |
| A token shown once, for the token way                                     | 2,628 ms                                                              |
| First call, Claude Code, `claude -p` with HTTP and a token (dev; desktop) | 3.1 s; 4.0 s, Haiku, about $0.003                                     |
| First call through the shim (dev; desktop)                                | 4.0 s; 4.2 s                                                          |
| First call, Codex, HTTP with `http_headers`                               | 8.8 s                                                                 |
| A revoked token, by HTTP and by the shim                                  | 401 at the next request                                               |

For a person: the sign-in way is open Settings, Copy, paste in a terminal, then in the window check the code and click Let it in, with Codex's browser opening by itself between. That is four clicks and one paste, and no secret anywhere they can see. The token way adds typing a name, and puts a live secret on the clipboard and in plain text in the client's config.

Not exercised live: Claude Code's own OAuth. It keeps an MCP server's tokens in the macOS login keychain, which this spike may not touch. Its `claude mcp add --help` shows OAuth flags (`--client-id`, `--callback-port`), and the door serves the discovery and registration it uses. The maintainer can check it in one go: add the server without a header, then `/mcp`, Authenticate.

## Threats this adds to `draft-mcp.md`'s

| Threat                                                                                                                                                                           | What stops it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A page registers a client, or swaps a code for a token                                                                                                                           | `/register` and `/token` are POSTs, and the door refuses any request with an `Origin`. A page can only navigate to `/authorize`, which makes an ask and decides nothing.                                                                                                                                                                                                                                                                                                                                                                                              |
| A sign-in returns to somewhere that isn't the client                                                                                                                             | Redirects are loopback over http only, checked when the client registers and again at `/authorize`. A code goes nowhere else.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A code is taken on its way back                                                                                                                                                  | It needs the client's PKCE verifier, is spent at its first try, right or wrong, and lasts a minute.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Two asks at once, and the person lets in the wrong one                                                                                                                           | Each has its own code, in the browser and in the window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A program running as the person asks unprompted, names itself "Claude Code" and opens the browser itself, so the codes match                                                     | Nothing at the door can tell it from the real one. It could read a pasted token from the client's config just as well, so OAuth is no weaker. Settings says "if you didn't start this, turn it away".                                                                                                                                                                                                                                                                                                                                                                 |
| **Another account registers a client and gets the person to click a link to `/authorize`** (on a page, or in a synced item), so the person's own browser shows the matching code | Found by the spike's security review, and closed: `/authorize` is refused unless the browser says no page started the navigation (`Sec-Fetch-Site: none`, which a program opening the browser gives, and a link never does).                                                                                                                                                                                                                                                                                                                                          |
| A page or another account floods the window with asks                                                                                                                            | A page can't register a client. Each client has one ask at a time, and only its first brings the window forward. At most five asks, each dropped after ten minutes.                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Another account holds the door's port,** and a client sends it its token                                                                                                       | Once kept, the door's port never moves (found by the spike's review): if it's taken at launch, the door stays closed, the window stays up, and Settings says why. Still open while Oriel is closed, when a client's next start sends its token to whoever holds the port. 0036 met this for review links by revoking them at quit; tokens can't die at quit. OAuth's hour-long access token shrinks it; a pasted token doesn't. The shim over a Unix socket in the 0700 data folder closes it for stdio clients. On a Mac with one person, there is no other account. |
| A spent refresh token used again                                                                                                                                                 | Refused. OAuth 2.1 also asks that its family be revoked; the story does that.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Controlling Oriel from another machine (design only, OA-202)

What it would need:

- **A relay, never an open port.** The laptop sleeps behind a NAT, and the door stays on loopback. The desktop app keeps one outgoing connection to a relay, as 0036's review relay does. A program on another machine reaches the relay, and the relay passes messages along, end-to-end encrypted, so it sees no content and holds no credential that acts.
- **An approved place is a device the person paired in the window,** never a URL anyone can reach. Pairing shows a code on both ends, as the sign-in does, and the device then holds a key of its own. The window lists each place, with when it was last used and Revoke.
- **The same tool rules, and fewer of them.** A place gets an outside tool's mode, read only by default, its caps, its name in every record, and Undo. Read and act from a place is the person's explicit choice, per place.

What it must never allow:

- approving, applying, rejecting or reverting a change set, or sending held words on: those stay in the window, on the person's machine (0003);
- making or revoking a review link, connecting or disconnecting a source, or changing Settings, outside tools included;
- anything at all while the app is closed: the relay holds no queue that acts later;
- the relay reading content, or acting on its own.

The closest thing to "approve from my phone" stays the review link, which already reaches a phone with nothing installed.

## What to keep, change and add

- **Keep from `mcp-door`:** the door's own listener, Host and Origin rules, tools from the registry, resources and subscriptions, held words, the caps, and the threat model.
- **Change:**
  - OAuth with the consent in the window is the default way in; a pasted token is the fallback.
  - The door always listens, in every Oriel, started by `serve()`.
  - Tools and token hashes go in the database, not memory.
  - The stdio shim is the fallback for command-only clients, not a later convenience.
- **Add:**
  - Settings, Outside tools: what each client is told, the ask with its code, the list with Revoke.
  - The ask on the workspace stream, so it shows at once and anywhere in the window, and in Needs you.
  - The shell's `--mcp` switch.
  - Refresh-token reuse revokes the family.

## Rejected

- **Oriel running `claude mcp add` or `codex mcp add` itself,** a true one-click. Oriel already finds both CLIs. But 0036 says Oriel never changes the person's own CLI settings, and writing a server into them is changing them. The sign-in way's command carries no secret, so a Copy and one paste costs little. The maintainer may decide otherwise; see the report.
- **Pairing the shim from the window:** it would keep plaintext tokens in Oriel's data folder.
- **Client ID Metadata Documents now:** they need Oriel to fetch a client's HTTPS document. Codex and Claude Code both register dynamically today. Add them when a client needs them.
