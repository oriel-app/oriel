// Spike: a Chromium-plus-Node shell for Oriel, from Electron's release zip
// (no npm). It runs the same server as a child, on Electron's own Node
// (ELECTRON_RUN_AS_NODE), learns its port from the first line, and opens a
// window on it. ORIEL_MAIN: packages/server/src/main.ts. ORIEL_USABLE: a file
// to write the time the overview first rendered to.
const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");

let server;
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Oriel",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  server = spawn(process.execPath, [process.env.ORIEL_MAIN, "--port", "0", "--fresh", "desktop-spike"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let buffered = "";
  const onData = (chunk) => {
    buffered += chunk;
    const found = /running at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(buffered);
    if (!found) return;
    server.stdout.off("data", onData);
    server.stdout.resume();
    window.loadURL(found[1]);
  };
  server.stdout.setEncoding("utf8").on("data", onData);
  window.webContents.on("did-finish-load", function poll() {
    window.webContents
      .executeJavaScript("document.querySelector('.overview-columns') !== null")
      .then((ready) => {
        if (!ready) return void setTimeout(poll, 10);
        if (process.env.ORIEL_USABLE) writeFileSync(process.env.ORIEL_USABLE, String(Date.now() / 1000));
      });
  });
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => server?.kill("SIGTERM"));
