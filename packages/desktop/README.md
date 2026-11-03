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

Every scenario but `fresh` gives the server a throwaway home, and points Settings' Claude Code and Codex paths into it. The stand-in (`scripts/stand-in-claude.ts`) answers the first run, its test turn included, but not a thread's turn.

It prints the URL, the PID, and a `curl` line for the API. `-H @<folder>/headers` sends the launch cookie and the Origin a change needs. `pnpm desktop:try stop` stops that PID, and only it, and removes the folder.

- `--show` opens the window instead, for the maintainer to look at. Secrets still stay in memory.
- `--build` builds even when nothing changed.
- Give the page a second after launch before sending a first-run command: as it opens, it looks for the CLI.

The shell's flags behind it: `--background`, `--data <dir>`, `--memory-secrets`, and `--launch-file`, which writes `Shell/launch.json` (the URL, the cookie, the shell's PID) in the data folder.

## Before a pilot: a clean Mac in a VM

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
