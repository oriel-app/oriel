// The WebRTC probe build's main process (webrtc-frame-spike), for
// `node scripts/webrtc-frames.ts --desktop`: the app's own Electron, fuses
// and all, with the window's engine set up by the shell's own code
// (shell/window.ts), plus the levers under test. It never ships.
//
// Each run gets a fresh in-memory partition, locked as the shell locks its
// session, so no run's proxy, preload or sockets touch another's. Windows are
// hidden (`show: false`) and the Dock icon is hidden.
//
// The harness writes JSON lines on stdin, and it answers on stdout:
// - `{"run": id, "host": url, "view"?: url, "policy"?: p, "preload"?: bool,
//    "proxy"?: port, "settle": ms}` opens a hidden window on `host`, and with
//   `view`, a WebContentsView in a partition of its own on `view`, both under
//   the same levers. After `settle` ms it answers `{"done": id, "host": […],
//   "view": […], "permissions": […]}`: what the probes reported, and every
//   permission the session was asked about.
// Its stdin's end quits it.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, session, WebContentsView, type Session } from "electron";
import { lockSession, webPreferences } from "../shell/window.ts";

const argument = (name: string) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const data = argument("--probe-data");
if (!data) throw new Error("--probe-data <dir> is required");
const preloadPath = join(fileURLToPath(new URL(".", import.meta.url)), "preload.cjs");

app.dock?.hide();
app.setPath("userData", data);
app.setPath("sessionData", data);
app.enableSandbox();
app.on("window-all-closed", () => {});

const say = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Run = {
  run: number;
  host: string;
  view?: string;
  policy?: "disable_non_proxied_udp" | "default_public_interface_only";
  preload?: boolean;
  proxy?: number;
  settle: number;
};

async function partition(name: string, run: Run, asked: string[]): Promise<Session> {
  const own = session.fromPartition(name);
  lockSession(own, () => new URL(run.host).origin);
  // The shell's handlers refuse all but one permission; these log every ask
  // and still refuse it, so the table can say whether WebRTC asks at all.
  own.setPermissionRequestHandler((_c, permission, decide) => {
    asked.push(`request ${permission}`);
    decide(false);
  });
  own.setPermissionCheckHandler((_c, permission) => {
    asked.push(`check ${permission}`);
    return false;
  });
  if (run.proxy)
    await own.setProxy({
      proxyRules: `http://127.0.0.1:${run.proxy}`,
      // Loopback is bypassed by default; the harness's "remote" listeners
      // are on loopback, so the proxy must see loopback too.
      proxyBypassRules: "<-loopback>",
    });
  return own;
}

async function run(line: Run) {
  const asked: string[] = [];
  const preferences = {
    ...webPreferences,
    backgroundThrottling: false,
    ...(line.preload ? { preload: preloadPath, nodeIntegrationInSubFrames: true } : {}),
  };
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    webPreferences: { ...preferences, session: await partition(`run-${line.run}`, line, asked) },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (line.policy) window.webContents.setWebRTCIPHandlingPolicy(line.policy);
  let view: WebContentsView | null = null;
  if (line.view) {
    view = new WebContentsView({
      webPreferences: {
        ...preferences,
        session: await partition(`view-${line.run}`, line, asked),
      },
    });
    if (line.policy) view.webContents.setWebRTCIPHandlingPolicy(line.policy);
    window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 600, height: 400 });
  }
  await window.loadURL(line.host).catch(() => {});
  if (view && line.view) await view.webContents.loadURL(line.view).catch(() => {});
  await wait(line.settle);
  const read = (contents: Electron.WebContents) =>
    contents
      .executeJavaScript("JSON.stringify(window.reports || window.__reports || [])")
      .then((text: string) => JSON.parse(text) as unknown[])
      .catch((error: Error) => [{ error: `read: ${error.message}` }]);
  const host = await read(window.webContents);
  const viewed = view ? await read(view.webContents) : [];
  view?.webContents.close();
  window.destroy();
  say({ done: line.run, host, view: viewed, permissions: [...new Set(asked)] });
}

void app.whenReady().then(() => {
  let buffered = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffered += chunk;
    for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
      const line = JSON.parse(buffered.slice(0, end)) as Run;
      buffered = buffered.slice(end + 1);
      void run(line).catch((error: Error) =>
        say({ done: line.run, host: [{ error: error.message }], view: [], permissions: [] }),
      );
    }
  });
  process.stdin.on("end", () => app.quit());
  say({ ready: true, electron: process.versions.electron, chrome: process.versions.chrome });
});
