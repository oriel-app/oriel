# The desktop app

`pnpm desktop` builds `build/<target>/Oriel.app` (decisions 0036, 0039, 0047). The pinned Electron zip is cached once for every worktree in `~/Library/Caches/oriel/electron/`, named by its SHA-256, which each build checks again.

## Trying it: `pnpm desktop:try <scenario>`

The only way to launch the app on a machine someone is working at. It builds the app if a source changed, copies it to a temp folder, and opens the copy with a fresh data folder and `--background`: its window stays hidden, nothing brings it forward, and its secrets stay in memory, so no Keychain prompt can appear and nothing is left in the keychain.

| Scenario        | Claude Code                                                                   |
| --------------- | ----------------------------------------------------------------------------- |
| `fresh`         | the person's own, on their PATH                                               |
| `no-cli`        | none; the first run's Install puts Anthropic's real one in the throwaway home |
| `signed-out`    | a stand-in, signed out; its sign-in works                                     |
| `sign-in-fails` | a stand-in, signed out; its sign-in fails                                     |
| `too-old`       | a stand-in at 2.1.0, signed in; its update works                              |

In every scenario, `fresh` included, the window shows each signed-in account as `you@example.com` on a "Placeholder plan", never the person's own email or plan, so a screenshot from a try names nobody. The server makes the swap before anything reaches the window (`--placeholder-account`, which the shell passes when a script launched it: see `packages/server/src/desktop/PROTOCOL.md`).

Every scenario but `fresh` gives the server a throwaway home, and points Settings' Claude Code and Codex paths into it. The stand-in (`scripts/stand-in-claude.ts`) answers the first run, its test turn included. A thread's turn runs one script that never ends, until the sandbox's wall time stops it, so a try can see a run and what quitting or a crash does to it.

It prints the URL, the PID, and a `curl` line for the API. `-H @<folder>/headers` sends the launch cookie and the Origin a change needs. `pnpm desktop:try stop` stops that PID, and only it, and removes the folder.

- `--show` opens the window instead, for the maintainer to look at. Secrets still stay in memory.
- `--build` builds even when nothing changed.
- Give the page a second after launch before sending a first-run command: as it opens, it looks for the CLI.

The shell's flags behind it: `--background`, `--data <dir>`, and `--launch-file`, which writes `Shell/launch.json` (the URL, the cookie, the shell's PID) in the data folder. With `--background` or `--launch-file`, secrets stay in memory.

## Releasing

Release builds come from a workflow the maintainer starts, in an environment only they can approve (decision 0036).

## Before a pilot

Each build that goes to a pilot passes all three, on the build itself, after any bump of Electron.

1. `pnpm desktop:debug-flags`: no debugger. Any program running as the person can launch Oriel with any arguments and environment, and a debugger in it reads the secrets it has opened. The check launches the built app with each way in and tries to reach a debugger.
2. `pnpm sketch-frames --desktop`: every sketch probe reaches nothing, in the app's own engine (decision 0033).
3. A first run on a clean Mac in a VM, below.

### No debugger

Measured on Electron 45.0.0 (OA-209). Before: the fuses alone, without the shell's refusal. After: both. Any argument but the shell's own stops the app starting.

| Way in                                         | Before                      | After                        |
| ---------------------------------------------- | --------------------------- | ---------------------------- |
| `--remote-debugging-port`, `-` or `--`         | DevTools on the port        | refused to start             |
| `--remote-debugging-pipe`                      | DevTools answers on fd 3, 4 | refused to start             |
| `--inspect`, `--inspect-brk`, `--inspect-wait` | ignored (fuse)              | refused to start             |
| `--inspect-port` with SIGUSR1                  | the app ends (fuse)         | refused to start             |
| SIGUSR1                                        | the app ends, no inspector  | the same                     |
| `--log-net-log`, cookies included              | writes the net log          | refused to start             |
| `ELECTRON_RUN_AS_NODE`, with `-e <code>`       | ignored (fuse): the app ran | refused to start             |
| `NODE_OPTIONS`                                 | ignored (fuse)              | ignored (fuse): the app runs |

Chromium's switches aren't behind a fuse, and some open a debugger after the shell's script runs, write the launch cookie to a file (`--log-net-log`) or send it through a proxy (`--proxy-server`). So the shell takes only its own switches (`--background`, `--data`, `--launch-file`, `--measure`): it strips any other from Chromium's own command line and quits before any setup (`refusedArguments` in `shell/rules.ts`). The app ending on SIGUSR1 opens nothing, and a program that can signal it can end it anyway. What this doesn't cover: until signing adds the hardened runtime (decisions 0036, 0039), stopping a native debugger attaching is the OS's call, not the app's.

`pnpm sketch-frames --desktop` drives the engine through the very port the app refuses, so it runs a copy of the build with the probe build's main process (`probe/`) in place of the shell's. The copy's Electron framework is checked byte for byte against the build's, and its fuses printed; its windows take the shell's own preferences and session (`shell/window.ts`). It has none of the shell's guard on where a window goes, so the probes meet the sandbox and the page's policy alone.

### A clean Mac in a VM

[Tart](https://tart.run) runs macOS VMs on Apple silicon. Check its licence before using it at a company.

```sh
brew install cirruslabs/cli/tart
tart clone ghcr.io/cirruslabs/macos-tahoe-vanilla:latest oriel-clean   # once, about 25 GB; user admin, password admin

pnpm desktop
mkdir -p /tmp/oriel-vm && ditto -c -k --keepParent packages/desktop/build/darwin-arm64/Oriel.app /tmp/oriel-vm/Oriel.zip
tart clone oriel-clean oriel-run                                       # a fresh copy for each run
tart run oriel-run --dir=oriel:/tmp/oriel-vm
```

In the VM, unzip `/Volumes/My Shared Files/oriel/Oriel.zip` into Applications and open it. If macOS refuses an app that isn't notarized, allow it in System Settings → Privacy & Security. Then go through the first run as a new user would. Afterwards: `tart stop oriel-run && tart delete oriel-run`.
