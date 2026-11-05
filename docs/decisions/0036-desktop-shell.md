# 0036 The desktop app: a thin native shell per OS over the same server

Accepted 2026-11-02. Settles what 0029 left open. Amends 0001, 0020, 0022 and 0029. Changes SPEC §1, §3, §4, §5, §6, §7 and §14, and the security reviewer's threat model. Amended by 0037: the harness reaches `run` over the command-line agent's own stdin and stdout, a narrower per-turn capability than a socket or a token file, and passes it an allowlisted environment, stricter than one minus vendor keys. Amended by 0038: with no CLI found or signed in, the first run installs it with its vendor's installer and starts its own sign-in, with no terminal. Amended by 0039: the shell is Electron, one for every OS, taken from its release zip by hash with no package; the server still runs as its child on the Node mise.toml pins, and the rest of this decision stands. Amended by 0043: `notify` names the path a click opens, and the shell shows it only while its window isn't in front. Amended by 0045: the shell asks before quitting from its menu or window while the server says Oriel works, told over the channel's `working`. Amended by 0047: the server is the shell's utility process on Electron's own Node, the channel's text travels on its parent port, and what it started is killed by the process table, not by its group. Amended by 0049: the channel's secret names are `anthropic-key`, the shape `connection.<ULID>`, and `jira` for one release. Amended by 0050: the release environment also holds Google's desktop OAuth client. Amended by 0058: the MCP door is a loopback listener of its own in the desktop app as in the dev server, with its port kept in the data folder, and the window's only-its-own-page rule unchanged.

Adds: none

**Decision.**

- **The shell.** The desktop app is a native shell per OS: a window over the system webview, with the server as its child process. It adds no packages.
  - macOS comes first. The shell is one Swift file built with `swiftc`, an AppKit window and a WKWebView. It has no Xcode project, no package manager and no third-party code. Windows and Linux each get their own thin shell later, over the webview their OS ships, with their own decisions.
  - The shell holds no product logic. It starts the server, shows its page, and does what the page can't: the OS keychain, the folder picker, notifications and updates. Everything else stays in the server and the web app, shared by every OS.
  - The page gets no bridge to the shell. The page asks the server, and the server asks the shell. The window stays on the server's origin, and any other link opens in the default browser.
  - The bundle holds the shell, the Node and Deno that `mise.toml` pins, the native TypeScript compiler, the built web app and the server's source. A build script copies the runtimes from mise's installs, so the app runs on the Node that CI tests.
- **How the server runs.** As a child process, never in the shell's process.
  - **Port.** It listens on 127.0.0.1 only, on a port picked at first launch and kept in the data folder. If that port is taken, the server scans upward for a free one and keeps that instead. When the port moves, the server revokes every live review link that names the old one, since whoever holds the old port could otherwise take their tokens. The port has to stay the same because web storage belongs to an origin, and an origin includes its port: a new port at each launch would lose the sidebar's folds and every other value the page keeps. The server's first line on stdout names its URL, and the shell loads that.
  - **The launch secret.** Each launch, the shell draws 32 bytes from the OS CSPRNG. It writes them to the server's stdin, never to argv, the environment or a URL. It also puts them in the webview's cookie store, before the first load, as an `HttpOnly`, `SameSite=Strict` session cookie. The server compares the cookie in constant time and refuses any request without it, GET included. The only exceptions are what a review link's page needs, where the review token is the credential: `GET /review/<token>`, `POST /api/review/open`, `/decide` and `/dismiss` with that token, and the static `/app/`, `/assets/` and `/vendor/` files. Making or revoking a link stays behind the secret. guard.ts's Host and Origin checks stay as they are. `pnpm dev` keeps today's guard without a secret.
  - **The channel to the shell.** After the secret, stdin and stdout carry JSON lines between the shell and the server: pick a folder, get, set or delete a keychain entry, notify. Nothing but channel lines goes to stdout: logs go to stderr, which the shell writes to a file, so desktop mode never logs with `console.log`. The shell answers only that fixed list of requests, and only for keychain entries under Oriel's own service name. When stdin reaches its end, the shell is gone, and the server quits.
  - **Environment.** The shell gives the server an environment it builds itself, not its own. It holds HOME, TMPDIR, LANG, the login shell's PATH (see Model use) and nothing else, so an API key in the person's environment never reaches the server or a command-line agent without the person choosing it.
  - **The data folder** is `~/Library/Application Support/Oriel/` on macOS. It holds the database, `oriel.db`, and the port. Logs go to `~/Library/Logs/Oriel/`. Of what `pnpm dev` keeps under `.oriel/`, only the database has a desktop counterpart. Connections go to the OS keychain, not into `secrets/` (0022's store, behind `ConnectionStore`). No development database is imported. `pnpm dev` keeps `.oriel/` and `secrets/` as they are.
  - **One instance.** The shell holds an advisory lock on a file in the data folder, which the OS releases if the shell dies. A second launch brings the first one's window forward and exits. The server also opens the database with SQLite's exclusive locking mode, so two servers can never share it.
  - **Quitting.** The shell sends SIGTERM, and the server closes as it does today: its streams, then the database. After 5 s the shell sends SIGKILL. The sandbox host's exit hooks already stop any Deno or tsc still running.
- **Packaging and updates.**
  - **Now:** an unsigned development build. `swiftc` gives the shell an ad-hoc signature, which Apple silicon requires and Gatekeeper accepts for an app built on the same machine. Nobody else gets a build before signing exists, so there are no updates yet: a new build replaces the old one.
  - **Signing, when the maintainer has the certificate:**
    - an Apple Developer ID Application certificate and a notarization credential;
    - the hardened runtime on the shell and on every nested binary (Node, Deno, tsc), with the JIT entitlement that V8 needs for Node and Deno;
    - notarizing with `xcrun notarytool`, then stapling the ticket;
    - no App Sandbox and no Mac App Store, because the server runs Deno, tsc and the person's own command-line agent.

    A stable signature also means the keychain keeps trusting the app across updates. Release builds are made by a workflow the maintainer starts. It runs in an Actions environment only the maintainer can approve, which holds the certificate and the notarization credential and nothing else. The maintainer signs each update's manifest on their own machine, offline, after the workflow builds it. Agents hold none of these.

  - **Updates, once signed.**
    - The shell checks a small manifest over HTTPS, at launch and daily. The manifest gives the version, the archive's URL, its SHA-256 and the lowest version it can update from.
    - It's signed with an Ed25519 key that only the maintainer holds, offline, never in CI. The shell has the public key built in and verifies it with CryptoKit.
    - The shell then downloads the archive and checks its hash. It also checks the archive's code signature against the same Team ID. It refuses any version that isn't newer than its own, so an old signed release can't be replayed.
    - It asks the person, and swaps the app when they quit, never mid-session. It keeps the previous bundle until the new one has started once, and copies the database before a migration runs.
    - HTTPS alone is never trusted for an update. The manifest and archives live on the public repo's releases.
- **Model use.** The default is 0020's local harness: Oriel drives the person's own installed command-line agent, signed in however they signed it in, so it runs on their subscription.
  - **Finding the CLI.** A GUI app on macOS doesn't inherit the person's PATH. So, once per launch, the shell runs the person's login shell, `$SHELL -ilc`, to print PATH, and gives up after 5 s. If that fails, it falls back to `launchctl getenv PATH` and then to the usual install folders, including Homebrew's. The server looks up each supported agent's binary on that PATH, or uses the path the person set for it in Settings, which wins. Then it asks the binary for its version and its sign-in status.
  - **The default.** If an agent is found and signed in, Oriel uses it. If more than one is found and signed in, the person picks which in Settings.
  - **If none is found,** or it isn't signed in: how Oriel helps the person install one and sign in, for someone who has never opened a terminal, is OA-190's decision, which the first-run setup builds on. An API key stays the other way in, and is kept in the OS keychain. Whatever OA-190 decides, Oriel never reads, stores or relays the CLI's credentials, and never changes the person's own CLI settings.
  - **Environment.** The agent gets the server's environment minus any vendor API-key variable, so a stray key can't quietly switch it from the subscription to billed API use. It runs in an empty working folder.
  - **Its own tools.** The harness offers the agent Oriel's `run` tool and nothing else. The CLI's own shell, file, web and edit tools are off. So is every configuration at the user, managed and project levels: tool servers, plugins, skills, subagents, hooks and settings. A person's own tool server for a source would otherwise let the agent write to it with no approved change set. Each time the harness starts the agent, on the person's machine, it checks that the CLI reports exactly one tool, `run`, and refuses to run otherwise, because a company's managed configuration exists only there. A test covers the check. A CLI that can't run that way isn't supported. This is what keeps synced content, which may hold injected instructions, from reaching the person's machine through the agent.
  - **How it reaches `run`.** Through a per-turn capability: a Unix socket, or a token in a file only the person can read, in a folder only the person can open. Never through the launch secret or a loopback route exempt from it, which another account on the machine could call.
  - Thread titles use the same choice: the harness's smallest model in one call, or the clipped first message.
  - The parallel harness story builds all this. It is a second `Provider` (0020).
- **The review link.** A link made on the person's machine reaches someone who has installed nothing through a review relay: a small hosted service whose store sees only ciphertext.
  - The desktop app encrypts the review page's data with a fresh key and uploads the ciphertext. The key goes only in the link's fragment, which browsers never send to a server.
  - A static page built from the repo decrypts the review in the browser. It is served from its own origin, never by the store that holds the ciphertext. Whoever controls that page's host while a link is opened can read its key, and with the key and the approval hash it can seal any decision. A compromise there exposes and can approve every link opened during it. So the page is deployed only from the repo, through an environment only the maintainer can approve, and its host is chosen with that in mind.
  - The reviewer's decision is sealed under the same key, with the typed name and the change set's approval hash. The relay holds it until the app fetches it. Before it replays anything, the app checks the seal and the hash, and that the link is still live: not revoked, expired or already decided. Revoking a link deletes the relay's copy.
  - Replay runs on the person's machine, where the credentials are, when the app next runs.
  - The relay stores nothing else and keeps nothing past the link's 7 days, or past its decision. It has no accounts, and the store alone can't approve.
  - Building it waits for its own story, with its own threat model and host. Until then, a desktop review link opens only on the person's own machine and lives only while the app runs: the app revokes its live local links when it quits, so a port taken while it's closed catches no live token. The app says so where it shows the link.

**Why.**

- **Dependencies decide it (0008), and the measurements don't disagree.** The spike (branch `desktop-spike`) opened the overview on the fixture server from each shell on the maintainer's Mac:

  |                                          | Swift + WKWebView | Chromium + Node (45.0.0) |
  | ---------------------------------------- | ----------------- | ------------------------ |
  | exec to a rendered overview, warm median | 677 ms            | 654 ms                   |
  | memory at idle, all processes            | 171 MB            | 173 MB                   |
  | … of which the shell's own               | 86 MB             | 131 MB                   |
  | download, zipped                         | 84 MB             | 162 MB                   |
  | installed                                | 251 MB            | 362 MB                   |
  - Start and idle memory are a tie. The server is most of both: it starts in about 230 ms, and it idles at 80 MB on Node 26. The Chromium shell's lower total comes from its own Node, which held the server at 45 MB.
  - The native shell is half the download, with nothing to install and nothing to audit.
  - A Chromium-plus-Node framework ships a whole browser. Its npm package is a downloader, with 12 dependencies of its own, that fetches the browser on first run, outside the lockfile the allowlist checks. Its browser fixes arrive weekly, and the 7-day rule would hold every one back. Its Node lags ours: the spike's was Node 24, against the pinned Node 26 that CI tests.
  - The system webview takes the OS's security updates without a release of ours.

- **A Rust shell with the system webview** draws with the same WKWebView on macOS, so it costs the same window. A minimal one locks 407 crates, 85 of them with build scripts that run at compile time. That is a second supply chain that `check-repo` can't see, and SPEC §14 keeps Rust out.
- **The server as a child** keeps the shell tiny and in any language. It keeps the server exactly as `pnpm dev` and CI run it, and lets the shell show a restart if the server dies. Node's official builds don't ship as a library that a Swift shell could embed anyway.
- **The launch secret** closes what Host and Origin don't. Loopback is shared by every user of the machine, and a page in the person's browser can still send GETs that the server answers. Passing the secret over stdin and a cookie keeps it out of `ps`, environments, logs and URLs, and every webview has a cookie store.
- **A shipped desktop app that wraps a Node server** made the same choices for the server's process, its port, a launch secret over a pipe, the login shell's PATH and one instance. That is evidence that they work in practice. It ships a Chromium-plus-Node shell and a third-party updater, which our dependency policy rules out here.
- **Subscriptions, not API credits,** is the maintainer's direction. 0020 already keeps credentials with the tool that owns them.
- **A relay of ciphertext** is the only way a laptop that sleeps behind a NAT can be reviewed by someone with nothing installed, without exposing the laptop or holding anyone's content.

**Rejected.**

- **A Chromium-plus-Node framework** (the spike ran Electron 45). See Why. It is the fallback if per-OS shells cost more than one shared engine when Windows and Linux come.
- **A Rust shell over the system webview** (Tauri 2). See Why.
- **The server in the shell's process.** Node's official builds can't be embedded in Swift. In a Chromium-plus-Node shell it would tie the server to that shell's Node.
- **A random port each launch.** It would lose the page's web storage at every start.
- **No launch secret, Host and Origin only.** Other users of the machine and cross-site GETs stay open.
- **The secret in argv, the environment or the first URL.** These show in `ps`, reach children, and get logged.
- **A tunnel from the person's machine for review links.** It is down whenever the laptop sleeps, and puts the local server on the internet.
- **A hosted relay that sees the change set.** It would hold company content and could approve on its own.
- **Updates trusted on HTTPS alone, or a third-party updater.**
- **The App Sandbox.** It would forbid running Deno, tsc and the person's own CLI.

**Consequences.**

- 0001: Oriel is a web app served by one Node process and, from phase 2, a native desktop shell around that same process.
- 0020: on the desktop app, the local harness is the default provider, and the API key is an option kept in the keychain. `ANTHROPIC_API_KEY` in `.env` still drives `pnpm dev` and the evals.
- 0022: on the desktop app, connections live in the OS keychain, reached through the shell. `secrets/jira.json` stays for `pnpm dev` only.
- 0029: its three open questions are settled here.
- The server gains a desktop mode: the launch secret and its cookie check, the stdin and stdout channel, quitting at the end of stdin, the data folder, the kept port and SQLite's exclusive lock. Each is unit-tested in TypeScript. The shell has no logic to test.
- Building the shell needs a macOS runner in CI, which is a workflow change for the maintainer.
- The idle server, at 80 MB, is the larger cost to cut. The shell isn't.
- Build stories, in order: the server's desktop mode; the macOS shell and `pnpm desktop`, which makes the unsigned app; the keychain store behind `ConnectionStore`; the harness (in parallel). Then, once the certificate exists: signing, notarizing and updates. The review relay comes after them.
