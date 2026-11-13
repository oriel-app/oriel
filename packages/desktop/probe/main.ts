// Never ships: the harness adds it to a copy of the built app, since it opens a DevTools port
// the shell refuses and has none of the shell's guard on where a window may go.
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
