# 0047 The server runs on Electron's own Node, and the repo pins that Node

Accepted 2026-11-03. Amends 0009, 0036 and 0039. Changes SPEC §6.

Adds: none

**Decision.**

- **One Node.** The desktop app's server runs on the Node inside the pinned Electron, as the shell's utility process (`utilityProcess.fork`, named "Oriel Server"). The app carries no Node of its own. The run-as-Node fuse stays off: a utility process doesn't need it.
- **The repo's Node is Electron's.** `mise.toml` pins the exact Node inside the pinned Electron: 24.22.0, in Electron 45.0.0. `packages/desktop/src/electron.ts` names it beside the Electron version, and a unit test checks that `mise.toml` pins it and that `@types/node` is that major version (24.19.2, the newest 24 at least 7 days old). `pnpm desktop` refuses to build on any other Node, since it checks the server's imports on the Node it runs on. A bump of Electron moves the Node pin with it. CI's Node comes from `mise.toml` through mise's action, so CI moves with it, and no workflow changes.
- **The channel** carries the same text as before (desktop/PROTOCOL.md). A utility process has no stdin, so the text travels as messages on its parent port, a pipe only the shell holds: each string the shell sends is text it would have written to stdin, `null` is stdin's end, and each line the server writes comes back as one string. The launch secret is the first message, never in argv, the environment or a URL. The server's stdout and stderr go to the shell, which writes them to its log file. Under `pnpm desktop:server` and in tests, the server still takes stdin and stdout.
- **What the server starts.** A utility process can't lead a process group, so the shell has no group to kill.
  - The first run's install, sign-in and update keep their own process groups, so Cancel and Start again stop each one whole, as before.
  - As the server exits, it kills everything it started that's still running, by the process table (`ps -A -o pid=,ppid=`): a Deno, a tsc, the person's CLI and their own children.
  - If the server hasn't quit 5 s after the shell asked, the shell kills it and everything under it, by the same table.
  - If the server dies without its sweep, of a crash, running out of memory or a kill from outside, what it started is left to launchd but stays in the shell's process group, which a launch from Finder, the Dock or `open` makes the shell lead. Each time the server exits, the shell kills every process in its group that launchd has taken, and their children. A CLI's own group isn't in it, as it wasn't in the server's group before. Launched from a terminal, the group is the terminal's, and the shell sweeps nothing.
- **The environment** is the one the shell builds (0036), plus two variables that Chromium and macOS add to every process they start: `MACH_PORT_RENDEZVOUS_PEER_VALDATION` and `__CF_USER_TEXT_ENCODING`. Neither carries a credential, and the person's CLI gets only 0037's allowlist anyway.
- **Signing for development.** `pnpm desktop` still signs ad hoc. `ORIEL_SIGN_IDENTITY` names a code-signing identity in the keychain to sign with instead. Only an identity Apple issues keeps "Oriel Safe Storage" readable from one build to the next without asking for the person's password, such as the free Apple Development certificate an Apple ID gets in Xcode's settings. See Why.
- **`--background`,** a flag for development: the shell starts its window hidden and never brings it forward on its own. That covers launch, a second launch, the server's `window.focus`, a folder pick and the question before quitting, which then doesn't quit and says so in the log. Clicking the Dock icon, or one of Oriel's notifications, still shows the window. ~~Builders launch the app with `open -g -j Oriel.app --args --background --data <dir>`, or run the binary with `--background`, so it never covers the maintainer's window.~~ Amended 2026-11-03 (OA-1): under `--background` the shell also keeps secrets in memory, so it never reaches the keychain, and builders launch the app only with `pnpm desktop:try <scenario>`, which opens a copy that way on a fresh data folder (packages/desktop/README.md).

**Why.**

- **What it saves,** measured on the maintainer's Mac, against main built the same way (`pnpm desktop --measure`), each build launched alternately twice:

  |                                                 | main, with its own Node | this build     |
  | ----------------------------------------------- | ----------------------- | -------------- |
  | installed (`du`)                                | 535 MB                  | 388 MB         |
  | zipped (`ditto -c -k`)                          | 214.5 MB                | 169.6 MB       |
  | first launch on a new data folder, to overview  | 1.49 s, 1.55 s          | 1.44 s, 1.46 s |
  | later launches, median of 5                     | 1.45 s, 1.46 s          | 1.45 s, 1.47 s |
  | idle memory, all processes, 30 s after it shows | 247 MB, 250 MB          | 207 MB, 206 MB |
  | … of which the server's                         | 81 MB, 84 MB            | 41 MB, 40 MB   |
  - Memory is each process's footprint, as Activity Monitor shows it. Summed resident memory counts Electron's shared framework once per process, about 575 MB either way.
  - Launches took twice 0039's 745 ms on both builds, with other builds running on the machine. Starting is even. The data folder had the first run's setup marked done, so the overview showed.
  - The server's memory halves on Electron's Node, as 0036's spike found (45 MB against 80 MB).

- **The maintainer chose it** over waiting for Electron 46, whose Node is 26: "node 24 is ok if it helps that much".
- **0039 kept the second Node** for two reasons. CI tested Node 26, so the app ran a Node CI didn't test. Now CI tests Electron's Node. And running on Electron's Node seemed to need the run-as-Node fuse on, which it doesn't.
- **Nothing in the code needs Node 26.** `pnpm check` passes on 24.22.0, with Node 24's types, which would catch an API that only 26 has. Type stripping, `node:sqlite`, `import.meta.main` and worker threads all run on Node 24. In the built app, a sandbox run typechecked in its worker and ran in Deno, inside the utility process.
- **Killing by the process table** stands in for the group the server led before. It finds the CLI's group too, under the server, so one sweep ends everything.
- **A self-signed identity doesn't stop the Keychain asking.** Tried with two builds signed as one self-signed certificate. The item's list of apps names the first build by its requirement, which the second build meets. Its partition list names the first build by its code hash, which the second build doesn't match, so the Keychain asked again. A partition names a build by its team ID instead only when the certificate carries one, and codesign records a team ID only from a certificate Apple issued.

**Rejected.**

- **Keeping a second Node** (0039). 147 MB installed, 45 MB zipped and 40 MB of memory, for a Node CI no longer tests.
- **Waiting for Electron 46**, with Node 26: the maintainer's call, above.
- **Electron's binary as Node,** with the run-as-Node fuse on. Then anything that can run the app's binary gets a Node carrying the app's signature, and with it the Keychain's trust. A utility process needs no fuse.
- **A pipe or socket of our own for the channel.** The parent port is a pipe already, and only the shell holds it.
- **`pnpm desktop:cert`,** a script that makes a self-signed "Oriel Development" identity. It doesn't stop the Keychain asking; see Why.

**Consequences.**

- 0009: the repo's Node is the one inside the pinned Electron, 24.22.0 today, not Node 26. It goes back to 26 with Electron 46.
- 0036: the server runs as the shell's utility process, not a plain child. The channel is the same text, on the parent port. The shell kills the server and what it started by the process table, not by its group.
- 0039: the server runs on Electron's Node, and the app carries one Node.
- SPEC §6 says so.
- **What didn't carry over: the shell dying outright.** If the shell crashes or is force-quit, Electron ends the utility process at once, without its exit hooks. A CLI, Deno or tsc the server started keeps running until it ends on its own. Before, the server read the end of stdin and quit cleanly. A quit, a quit from the OS, a signal and the 5 s deadline all still end everything. Closing this gap needs a watcher outside both processes, a story of its own.
- ~~Builders test the built app with `--background`, and with an app name of their own in a copy, so they read neither the maintainer's window nor the maintainer's "Oriel Safe Storage".~~ Amended 2026-11-03 (OA-1): builders test the built app only with `pnpm desktop:try`. Its secrets stay in memory, so it reads neither the maintainer's window nor any keychain item, and no copy needs a name of its own.
