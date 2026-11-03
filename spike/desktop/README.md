# Desktop shell spike (OA-155)

Throwaway code behind decision 0036. Not built by CI, not part of the app.

- `macos/main.swift`: a native shell. AppKit window, WKWebView, the server as a
  child process on the Node pinned in `mise.toml`. Nothing to install.
- `electron/main.cjs`: a Chromium-plus-Node shell, run from Electron 45.0.0's
  release zip (12 days old; SHA-256 checked against the release's
  `SHASUMS256.txt`), no npm. It runs the server on Electron's own Node
  (`ELECTRON_RUN_AS_NODE`), so it bundles one runtime, not two.
- `measure.sh`: times a shell from exec to the overview's columns rendering,
  waits 10 s, then sums memory over the shell's process tree and the WebKit
  helpers it started.

Both open the fixture server with `--port 0 --fresh desktop-spike` and find the
port from its "running at" line.

## Run

```sh
pnpm --filter @oriel/web build
mkdir -p macos/build/Oriel.app/Contents/MacOS
swiftc -O macos/main.swift -o macos/build/Oriel.app/Contents/MacOS/Oriel
./measure.sh swift env ORIEL_NODE=$(mise which node) \
  ORIEL_MAIN=$PWD/../../packages/server/src/main.ts macos/build/Oriel.app/Contents/MacOS/Oriel
./measure.sh electron env -u ELECTRON_RUN_AS_NODE \
  ORIEL_MAIN=$PWD/../../packages/server/src/main.ts <Electron.app>/Contents/MacOS/Electron $PWD/electron
```

## Results (M-series MacBook, macOS 26, 2026-11-02)

Usable is exec to the overview rendered, warm disk cache, median of 5 or 6.
Memory is phys_footprint (Activity Monitor's figure) 10 s after usable.

|                       | Swift + WKWebView        | Electron 45              |
| --------------------- | ------------------------ | ------------------------ |
| usable                | 677 ms (613–831)         | 654 ms (548–972)         |
| memory, all processes | 171 MB (168–173)         | 173 MB (172–199)         |
| … the shell's own     | 86 MB                    | 131 MB                   |
| … the server          | 80–87 MB on Node 26      | 44–46 MB on its Node 24  |
| RSS, all processes    | 353 MB                   | 545 MB                   |
| download (zip)        | 84 MB                    | 162 MB                   |
| installed             | 251 MB                   | 362 MB                   |
| shell binary          | 90 KB, swiftc in 5 s     | 252 MB app               |

The first, cold-cache Swift launch took 1.4 s. The server alone reaches
listening in about 230 ms (Node 26, 140 MB RSS).

Size parts, zipped: Node 26 37.6 MB, Deno 2.9.8 37.0 MB, native tsc 8.8 MB,
the app's files 0.7 MB, the Swift shell under 0.1 MB, Electron 115.1 MB.

Not spiked: a Rust shell. On macOS it draws with the same WKWebView, so its
window costs what the Swift one does. A minimal Tauri 2 app locks 407 crates
(266 on macOS), 85 of them with build scripts that run at compile time.
