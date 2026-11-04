// The probe build's main process, for `pnpm sketch-frames --desktop`
// (scripts/sketch-frames.ts), in place of the shell's: the app's own
// Electron, with its fuses, and the window's engine set up by the shell's
// own code (shell/window.ts), but driven by the harness through a DevTools
// port, which the shell refuses (rules.ts, refusedArguments). It never ships:
// the harness puts it in a copy of the built app.
//
// It has none of the shell's guard on where a window may go, so what the
// probes meet is the engine's sandbox and the page's policy alone. A
// window may open nothing: a popup is refused, as the shell refuses it, and
// told to the harness, since the shell would hand an http(s) one to the
// default browser.
//
// The harness writes JSON lines on stdin, and it answers on stdout:
// - `{"open": url, "theme": "light" | "dark"}` opens a hidden window on
//   `url`, in that scheme, and answers `{"opened": id}` once it loads.
// - `{"close": id}` closes that window.
// - A popup a page asks for is `{"popup": url, "from": id}`.
// Its stdin's end quits it.
import { app, BrowserWindow, nativeTheme, session } from "electron";
import { lockSession, webPreferences } from "../shell/window.ts";

const argument = (name: string) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const data = argument("--probe-data");
const origin = argument("--origin") ?? null;
if (!data) throw new Error("--probe-data <dir> is required");

app.dock?.hide();
app.setPath("userData", data);
app.setPath("sessionData", data);
app.enableSandbox();
app.on("window-all-closed", () => {});

const say = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

async function open(url: string, theme: "light" | "dark") {
  nativeTheme.themeSource = theme;
  // Hidden, and drawn while hidden, so the harness can click.
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { ...webPreferences, backgroundThrottling: false },
  });
  const id = window.webContents.id;
  window.webContents.setWindowOpenHandler(({ url: asked }) => {
    say({ popup: asked, from: id });
    return { action: "deny" };
  });
  await window.loadURL(url).catch(() => {});
  say({ opened: id });
}

void app.whenReady().then(() => {
  lockSession(session.defaultSession, () => origin);
  let buffered = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffered += chunk;
    for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
      const line = JSON.parse(buffered.slice(0, end)) as {
        open?: string;
        theme?: "light" | "dark";
        close?: number;
      };
      buffered = buffered.slice(end + 1);
      if (line.open) void open(line.open, line.theme ?? "light");
      if (line.close !== undefined)
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.id === line.close)
          ?.destroy();
    }
  });
  process.stdin.on("end", () => app.quit());
  say({ ready: true, electron: process.versions.electron, chrome: process.versions.chrome });
});
