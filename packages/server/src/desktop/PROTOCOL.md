# The desktop shell and its server

How the desktop app's shell and its server talk (decision 0036). It's the same on every OS. The shell starts the server as its child, with its stdout and stderr going to the shell's log file:

```
node packages/server/src/main.ts --desktop --data <folder>
```

In the app the server runs on Electron's own Node, as the shell's utility process, which has no stdin (decision 0047). There the channel's text travels as messages on the process's parent port, which only the shell holds: each string the shell sends is text it would have written to stdin, `null` is stdin's end, and each line the server writes comes back as one string. Anywhere else, as under `pnpm desktop:server` and in tests, it's stdin and stdout. Everything below is the same either way; "stdin" and "stdout" name the channel's two directions.

`--data` is the folder the server keeps its files in, as an absolute path. The shell picks it: its OS's usual per-person folder for app data. The server builds no path of its own and takes no other flag in desktop mode. `protocol.ts` beside this file holds the same shapes as validators; when the two disagree, it wins.

## Start

1. The shell draws 32 bytes from the OS's secure random source and writes them to the server's stdin as one line of 64 lowercase hex characters.
2. Before the window's first load, the shell puts the same 64 characters in the window's cookie store:
   - name `oriel-launch`, for `http://127.0.0.1`, path `/`;
   - `HttpOnly`, `SameSite=Strict`, not `Secure`, no expiry (a session cookie).
3. The server's first line on stdout is `{"kind":"ready","url":"http://127.0.0.1:4320/"}`. The shell loads that URL. The port is kept in the data folder, so it's usually the same each launch, but it can move, so always take it from this line.

A first line that isn't 64 hex characters makes the server exit with status 2. The server refuses every request without the cookie, apart from what a review link's page needs.

## The channel

After the secret line, every line on stdin and on stdout is one JSON object in UTF-8. Lines end with `\n`; the server also takes `\r\n`. Nothing else is written to stdout: the server's logs go to stderr.

The server sends requests. Each has an `id`, a positive integer that the server never reuses in one launch. The shell answers each request once, with the same `id`, in any order and whenever it's done: a folder pick waits for the person.

```
{"id":1,"ok":true,"value":<the value below>}
{"id":1,"ok":false,"error":"a reason, for the server's log"}
```

| Request                                                               | `value` in the answer                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| `{"id":1,"kind":"folder.pick","prompt":"Connect a folder"}`           | the picked folder's absolute path, or `null` if cancelled |
| `{"id":2,"kind":"secret.get","name":"anthropic-key"}`                 | the stored secret as a string, or `null` if there's none  |
| `{"id":3,"kind":"secret.set","name":"anthropic-key","secret":"…"}`    | `null`                                                    |
| `{"id":4,"kind":"secret.delete","name":"anthropic-key"}`              | `null`, whether or not there was one                      |
| `{"id":5,"kind":"notify","title":"…","body":"…","open":"/threads/…"}` | `null`                                                    |
| `{"id":6,"kind":"window.focus"}`                                      | `null`, once the window is in front                       |
| `{"id":7,"kind":"working","threads":2}`                               | `null`                                                    |

- The server names only the secret, by its one name: `anthropic-key`, the API key the agent can run on (decision 0042). Connections keep no secret (decision 0059). The shell refuses any other request, and any other name, with `"ok":false`.
- The shell keeps each secret encrypted with a key its OS keeps for Oriel, under Oriel's own name (Electron's safe storage: the Keychain on macOS), in a file of its own in the data folder's `Secrets/`, readable by its owner only. Only ciphertext is ever on disk. When the OS has no such key, or on Linux has no keyring, so that safe storage would fall back to a fixed key, the shell refuses every `secret.get` and `secret.set`; it never keeps a secret as plaintext. `secret.delete` needs no key.
- A `secret` is at most 16 KiB of text. The shell never logs it.
- A notification's `title` and `body` are plain text, never markup: the body may hold a thread's title, which is synced data. The shell shows it only while its window isn't focused, and answers `null` either way. A click brings the window forward on `open`, a path on the server's origin (`/` and printable ASCII, never `//`).
- `window.focus` brings the window to the front, over whatever app the person is in, as the first run asks once the CLI's sign-in in the browser has ended (decision 0038).
- `working` says how many threads Oriel is working on now, a turn running or a change set applying, each time that number changes; 0 while Settings has asking before quitting off. Before it hears one, the shell takes it as 0. While it isn't 0, Quit in the menu (Cmd+Q) and closing the window ask the person first: "Oriel is still working on 2 threads. Quit anyway?", with Quit and Cancel (decision 0045). A quit from the Dock, the OS or a signal doesn't ask.
- A path is as the OS writes it.
- The shell may ignore fields it doesn't know. The server ignores answers whose `id` it isn't waiting for, and lines it can't read, and logs them to stderr.

## Quitting

- To quit, the shell closes the server's stdin. The server revokes the live review links, stops its streams, closes its database and exits 0. As it exits, in the app, it kills whatever it started that's still running: a utility process leads no process group the shell could kill. If it hasn't exited after 5 s, the shell kills it and everything it started, found by the process table.
- Where the OS has signals, SIGTERM and SIGINT quit the same way.
- Asked to quit while it's still starting, before or just after the ready line, the server exits 0 at once. Links it left live are revoked at the next start.
- When the shell dies, its end of stdin closes, so the server quits too. In the app, Electron ends its utility process at once instead, without the quitting above: what the server started is left running (decision 0047).
- If the server exits on its own, the shell can show that and offer to start it again. In the app, it first kills whatever the server left running (decision 0047).

## The data folder

The server creates the folder if it's missing, and keeps `oriel.db` (opened with SQLite's exclusive lock, so a second server can't open it), `port` and `settings.json` there. The shell's own files live there too, under other names: `Shell/`, with its one-instance lock, and `Secrets/`.
