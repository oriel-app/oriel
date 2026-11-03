# 0039 The desktop shell is Electron, taken from its release zip

Accepted 2026-11-02. Amends 0036's shell. Changes SPEC §1, §3 and §6, and the security reviewer's threat model. Amended by 0042: the secret store is built, a file of ciphertext per secret in the data folder's `Secrets/`, under fixed names, refused when the OS has no key.

Adds: none

**Decision.**

- **One shell.** The desktop app's shell is Electron, one shell for macOS, Windows and Linux, in place of 0036's native shell per OS. The rest of 0036 stands: the server as the shell's child on loopback, the launch secret over stdin and its cookie, the channel of JSON lines, the kept port, the data folder, the environment the shell builds, one instance, quitting, no bridge from the page, and updates only once signed with the maintainer's offline key.
- **No package.** `pnpm desktop` downloads the official zip for its platform from Electron's GitHub release and checks it against a SHA-256 pinned in `packages/desktop/src/electron.ts`, copied from that release's `SHASUMS256.txt`. The version is 45.0.0, 12 days old when pinned; a bump changes the version and every hash, and takes a release at least 7 days old. The types are the release's own `electron.d.ts`, vendored in `packages/desktop/vendor/`, and a unit test checks its hash against the pin. Nothing enters the lockfile and no install script runs.
- **The server runs on the bundled Node** that `mise.toml` pins, not on Electron's. The app carries both.
- **The shell's code** is TypeScript in `packages/desktop/shell/`, which tsc compiles into the app. What it decides without Electron (the channel's requests, the server's first line, the origin, PATH and LANG) is in `rules.ts` and unit-tested; `main.ts` is the glue.
- **The window.**
  - Every renderer is sandboxed, with context isolation, no Node integration, no preload, no webview tag, no devtools and no navigation on a dropped file.
  - The page and its frames stay on the server's origin; a frame may also be `about:blank` or `about:srcdoc`. A new window, and any other navigation of the page, is refused, and an http(s) link goes to the default browser instead. A redirect off the origin is stopped, and so is any download.
  - Every permission is refused but one: writing text to the clipboard, from the server's origin, which Copy needs for a review link. Reading the clipboard stays refused.
- **Fuses.** `pnpm desktop` turns off Electron's run-as-Node, `NODE_OPTIONS`, inspector arguments and `file://` privileges by flipping their bytes in the binary (`packages/desktop/src/fuses.ts`), without Electron's fuse package. Cookie encryption stays off, since the one cookie is the launch secret, a session cookie that is never written to disk. The asar archive and its integrity fuse come with signing, where they mean something.
- **The OS.** `dialog.showOpenDialog` picks a folder and `Notification` notifies. Secrets go through Electron's `safeStorage`: its key lives in the macOS Keychain, Windows' DPAPI or Linux's secret service, and only ciphertext lives in the data folder. On Linux, when `safeStorage` has no keyring and falls back to a fixed key, the shell refuses to keep a secret. The store is OA-188's; until then the shell refuses `secret.*` requests.
- **One instance** is Electron's lock, in the shell's own folder inside the data folder (`Shell/`), which also holds Chromium's profile. A second launch brings the first one's window forward.
- **Quitting** follows the server's protocol: the shell closes the server's stdin, which asks it to quit on every OS, signals or not, and kills its process group after 5 s.
- **If the server dies,** the window shows a page with no script: "Oriel stopped." and Restart, a link to a sentinel URL the shell acts on only while the server is stopped.
- **Packaging.** `pnpm desktop` builds the macOS app: Electron's renamed Oriel, with its helpers, its fuses set, the shell's code, Node, Deno, the native TypeScript compiler and the server's source, with an ad-hoc signature, which Apple silicon requires. The platform is a parameter; Windows and Linux are named and refused until their stories.
- **Signing and updates** are as 0036 says, plus the hardened runtime's entitlements Electron needs and the asar integrity fuse. The shell verifies the update manifest's Ed25519 signature with Node's crypto. Electron's own updater isn't used.

**Why.**

- **One shell across three OSes** is the maintainer's choice over a shell per OS: "i dont want to mess around with getting a native windows app to work". Per-OS shells are three codebases in three languages, each with its own toolchain and CI runner. Electron's is one TypeScript shell, checked by the same typecheck and test runner as the server.
- **What it costs, measured** on the maintainer's Mac:

  |                               | Swift + WKWebView (spike) | Electron (spike) | This build |
  | ----------------------------- | ------------------------- | ---------------- | ---------- |
  | launch to a rendered overview | 677 ms                    | 654 ms           | 745 ms     |
  | download, zipped              | 84 MB                     | 162 MB           | 215 MB     |
  | installed                     | 251 MB                    | 362 MB           | 518 MB     |
  - Start and idle memory were even in the spike. This build's launch is the median of 5 warm runs (627–1006 ms), on desktop mode's empty first-run overview rather than the fixture. A first launch on a new data folder took 2.4 s.
  - Installed, the build is Electron 262 MB, Node 148 MB, Deno 82 MB and the server with its compiler 34 MB. The second Node is the 53 MB, zipped, over the spike's Electron.

- **0008 holds.** No npm package, no lockfile entry, no install script. The zip is pinned by hash as a lockfile entry would be, the 7-day rule is applied by hand, and the pin is code, reviewed like code.
- **The pinned Node,** because CI tests Node 26 and Electron 45 carries Node 24. Running the server on Electron's Node would also need the run-as-Node fuse on.
- **The 7-day rule holds Chromium's fixes back a week,** which 0036 counted against Electron. The window shows only the server's own pages, with no remote content, so a browser bug reachable from the page needs our own server to serve it.
- **`safeStorage` over the keychain directly:** on macOS it is the keychain, and it covers Windows and Linux too. Reaching the macOS keychain from Electron otherwise needs a native module, a dependency, or the `security` tool, which takes the secret in argv.

**Rejected.**

- **A native shell per OS** (0036). See Why.
- **Electron from npm.** Its package is a downloader, with dependencies of its own, that fetches the browser outside the lockfile (0036).
- **Electron's fuse package.** A dependency, for nine bytes after a sentinel.
- **The server on Electron's Node,** as the spike ran it.
- **A native dialog when the server stops.** A modal over a dead page; a page in the window is plainer.
- **Refusing the clipboard write too.** Copy stops working.

**Consequences.**

- 0036: its shell, the Swift one, is replaced by this; everything else in it stands.
- SPEC §1, §3 and §6 name Electron.
- The threat model adds the preload, the permissions and the fuses to what the security reviewer looks for.
- `pnpm check` typechecks and tests the shell on Linux. Building the app needs the network, for the zip, and macOS; a CI job for it is the maintainer's.
- Next: OA-188 builds the `safeStorage` store; signing adds the asar archive, its integrity fuse and the hardened runtime; Windows and Linux each become a target of `pnpm desktop`.
