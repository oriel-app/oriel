// The desktop app's shell (decisions 0036, 0039 and 0047): Electron's main
// process, a window over the server, which runs on Electron's own Node as
// this process's utility process. The shell holds no product logic. It
// starts the server, shows its page, and does what the page can't: the folder
// picker, notifications and the secret store (secrets.ts).
//
// - Launch. The server gets an environment built here: HOME, TMPDIR, LANG and
//   the login shell's PATH, with the bundle's Deno first. The shell draws a
//   32-byte launch secret and writes it, as hex, as the channel's first
//   line, then sets it as the session cookie before the window's first load.
//   The server's first line names its URL.
// - The channel. A utility process has no stdin, so the channel's text goes
//   both ways as messages on its parent port, which only this process holds;
//   `null` stands for stdin's end. After the secret it carries JSON lines:
//   the server asks and the shell answers only what rules.ts parses;
//   anything else is refused.
// - The page has no preload and no bridge to the shell. Renderers are
//   sandboxed and isolated, every permission is denied, the window stays on
//   the server's origin, and other http(s) links open in the default browser.
// - One instance per data folder: Electron's lock lives in the shell's folder
//   inside it. A second launch brings the first one's window forward.
// - Quitting closes the server's stdin, and the server ends what it started
//   as it exits. After 5 s the shell kills the server and all it started, by
//   the process table, since a utility process leads no process group. While
//   the server says Oriel is working on a thread, Quit in the menu (Cmd+Q)
//   and closing the window ask the person first (decision 0045). The
//   server's stdout and stderr go to the logs folder. If the server dies on
//   its own, the shell kills whatever it left running, and the window says
//   so and offers Restart.
// - `--background`, for development: the window starts hidden and nothing
//   brings it forward on its own (rules.ts, raises), so a launch from a
//   script never covers what the person is doing. Clicking the Dock icon
//   shows it. Secrets are kept in memory, never in the OS's store
//   (rules.ts, secretsInMemory).
// - `--launch-file`, for development: each time the server starts, the
//   shell writes its URL, the launch cookie and the shell's PID to
//   `Shell/launch.json` in the data folder, readable by its owner only, so
//   a script can reach the server's API, as `pnpm desktop:try` does. Its
//   secrets are kept in memory too, so that cookie reaches none of the
//   person's.
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Notification,
  safeStorage,
  session,
  shell,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from "electron";
import {
  descendants,
  fixedKey,
  folders,
  lang,
  Lines,
  mayShow,
  mayUse,
  notificationText,
  opensOutside,
  orphans,
  parseRequest,
  pathEnd,
  pathStart,
  printedPath,
  quitQuestion,
  type Raise,
  raises,
  readyOrigin,
  restartUrl,
  secretsInMemory,
  serverPath,
  storageProblem,
  type Request,
} from "./rules.ts";
import { shellSecrets } from "./secrets.ts";

const quitGrace = 5_000;
const loginShellTimeout = 5_000;
const maxLine = 1 << 20;

const home = homedir();
const where = folders(process.argv, home);
const background = process.argv.includes("--background");
const launchFile = process.argv.includes("--launch-file");
const resources = process.resourcesPath;
const deno = join(resources, "deno");
const main = join(resources, "server/packages/server/src/main.ts");

let window: BrowserWindow | null = null;
let server: UtilityProcess | null = null;
let origin: string | null = null;
let path: Promise<string | null> | null = null;
let quitting = false;
let picking = false;
// How many threads the server says Oriel is working on, while it runs, and
// whether the question before quitting is on screen.
let working = 0;
let asking = false;
let log = -1;

// Only once Electron is ready: on Linux and Windows the OS's key isn't
// there before. In the background, in memory: see secrets.ts.
const secrets = shellSecrets(secretsInMemory(process.argv), join(where.data, "Secrets"), () => ({
  problem: async () =>
    storageProblem(
      process.platform,
      app.isReady() && (await safeStorage.isAsyncEncryptionAvailable()),
      process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : null,
    ),
  encrypt: async (text) => {
    const data = await safeStorage.encryptStringAsync(text);
    if (fixedKey(process.platform, data))
      throw new Error("there's no keyring, so the secret store would use a fixed key");
    return data;
  },
  decrypt: async (data) => {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(data);
    return { text: result, stale: shouldReEncrypt };
  },
}));

for (const dir of [where.data, where.logs, where.shell])
  mkdirSync(dir, { recursive: true, mode: 0o700 });
app.setPath("userData", where.shell);
app.setPath("sessionData", where.shell);
app.setAppLogsPath(where.logs);
app.enableSandbox();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => show("second-launch"));
  app.on("activate", () => show("dock"));
  app.on("web-contents-created", (_, contents) => guard(contents));
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (!server) return;
    event.preventDefault();
    if (!quitting) stop();
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => app.quit());
  // The login shell's PATH, once per launch, while Electron starts.
  path = loginPath();
  void app.whenReady().then(ready);
}

function ready() {
  openLog();
  const own = session.defaultSession;
  own.setPermissionRequestHandler((_contents, permission, decide, details) =>
    decide(mayUse(permission, details.requestingUrl, origin)),
  );
  own.setPermissionCheckHandler((_contents, permission, requesting) =>
    mayUse(permission, requesting, origin),
  );
  own.setDevicePermissionHandler(() => false);
  own.on("will-download", (event) => event.preventDefault());
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { label: `Quit ${app.name}`, accelerator: "CommandOrControl+Q", click: quit },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]),
  );
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: "Oriel",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: false,
    },
    show: raises("launch", background),
  });
  // Closing the window quits, so it asks first too.
  window.on("close", (event) => {
    if (quitting || working === 0) return;
    event.preventDefault();
    ask();
  });
  measure(window.webContents);
  start();
}

// Quit from the menu, the person's own: it asks first while Oriel works. A
// quit from the Dock, the OS or a signal reaches before-quit, which Electron
// gives no way to tell from this one, so it doesn't ask: none of them may
// wait on a question.
function quit() {
  if (quitting || working === 0) app.quit();
  else ask();
}

// Whether to quit while Oriel works. Quit quits, without asking again. In
// the background nothing comes forward to ask, so it doesn't quit.
function ask() {
  if (asking || !window) return;
  if (!raises("quit-question", background))
    return note(`not quitting while working on ${working}: in the background, nothing asks`);
  asking = true;
  show("quit-question");
  note(`asked before quitting, while working on ${working}`);
  void dialog
    .showMessageBox(window, { type: "warning", noLink: true, ...quitQuestion(working) })
    .then(({ response }) => {
      asking = false;
      note(response === 0 ? "quitting anyway" : "not quitting");
      if (response === 0) app.quit();
    });
}

function show(why: Raise) {
  if (!window || !raises(why, background)) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

// Every page the app makes stays on the server's origin, opens no window and
// embeds no webview. A link elsewhere goes to the default browser, if it's
// http(s).
function guard(contents: WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (opensOutside(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-frame-navigate", (event) => {
    if (mayShow(event.url, origin, event.isMainFrame)) return;
    event.preventDefault();
    if (event.isMainFrame && event.url === restartUrl && !server && !quitting) return start();
    if (event.isMainFrame && opensOutside(event.url)) void shell.openExternal(event.url);
  });
  contents.on("will-redirect", (event) => {
    if (!mayShow(event.url, origin, event.isMainFrame)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

// MARK: Logs

function openLog() {
  const path = join(where.logs, "server.log");
  if (existsSync(path)) renameSync(path, join(where.logs, "server.1.log"));
  log = openSync(path, "a", 0o600);
}

// The shell's own notes, beside the server's lines in the same file.
function note(text: string) {
  if (log < 0) return;
  try {
    writeSync(log, `shell: ${text}\n`);
  } catch {
    // A log that can't be written isn't worth stopping for.
  }
}

// MARK: The server's environment

// A short command's stdout, in its own session, which is killed when it
// exits or at the deadline, so nothing its startup files left keeps running.
function output(command: string, args: string[], env: Record<string, string>, ms: number) {
  return new Promise<string>((resolve) => {
    let text = "";
    const child = spawn(command, args, {
      env,
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const done = () => {
      clearTimeout(timer);
      if (child.pid) killGroup(child.pid);
      resolve(text);
    };
    const timer = setTimeout(done, ms);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (text.length < 65_536) text += chunk;
    });
    child.on("error", done);
    child.on("exit", done);
  });
}

async function loginPath(): Promise<string | null> {
  const login = process.env.SHELL || userInfo().shell;
  if (login?.startsWith("/")) {
    const printed = await output(
      login,
      ["-ilc", `printf '%s\\n' ${pathStart}; printenv PATH; printf '%s\\n' ${pathEnd}`],
      {
        HOME: home,
        SHELL: login,
        USER: userInfo().username,
        LOGNAME: userInfo().username,
        TERM: "dumb",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      },
      loginShellTimeout,
    );
    const found = printedPath(printed);
    if (found) return found;
    note("the login shell printed no PATH; trying launchd's");
  }
  const launchd = (await output("/bin/launchctl", ["getenv", "PATH"], {}, 2_000)).trim();
  return launchd === "" || launchd.includes("\n") ? null : launchd;
}

async function serverEnvironment(): Promise<Record<string, string>> {
  return {
    HOME: home,
    TMPDIR: process.env.TMPDIR || tmpdir(),
    LANG: lang(process.env.LANG, app.getSystemLocale()),
    PATH: serverPath(deno, await (path ??= loginPath()), home),
  };
}

// MARK: The server

function start() {
  void serverEnvironment().then((env) => {
    if (quitting || server) return;
    const secret = randomBytes(32).toString("hex");
    const child = utilityProcess.fork(main, ["--desktop", "--data", where.data], {
      cwd: where.data,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      serviceName: "Oriel Server",
    });
    server = child;
    for (const stream of [child.stdout, child.stderr])
      stream?.on("data", (chunk: Buffer) => {
        if (log < 0) return;
        try {
          writeSync(log, chunk);
        } catch {
          // A log that can't be written isn't worth stopping for.
        }
      });
    child.postMessage(`${secret}\n`);
    let first = true;
    const lines = new Lines(maxLine, () => note(`dropped a line over ${maxLine} bytes`));
    child.on("spawn", () => note(`started the server, pid ${child.pid}`));
    child.on("message", (text: unknown) => {
      if (typeof text !== "string") return note("dropped a message that isn't text");
      for (const line of lines.push(text)) {
        if (server !== child) return;
        if (first) {
          first = false;
          void open(child, line, secret);
        } else answer(child, line);
      }
    });
    child.on("error", (type, location) => note(`the server failed: ${type} at ${location}`));
    child.on("exit", (code) => {
      note(`the server exited, status ${code}`);
      exited(child);
    });
  });
}

// The first line: set the cookie, then load the page.
async function open(child: UtilityProcess, line: string, secret: string) {
  const found = readyOrigin(line);
  if (!found) {
    note("the server's first line wasn't its URL");
    child.postMessage(null);
    return;
  }
  origin = found;
  await session.defaultSession.cookies.set({
    url: `${found}/`,
    name: "oriel-launch",
    value: secret,
    httpOnly: true,
    secure: false,
    sameSite: "strict",
  });
  if (launchFile) writeLaunchFile(found, secret);
  // Not if the server stopped meanwhile, which shows the stopped page.
  if (server === child) await window?.loadURL(`${found}/`);
}

// Written whole and renamed into place, as the secret store writes.
function writeLaunchFile(url: string, secret: string) {
  const path = join(where.shell, "launch.json");
  const next = `${path}.${process.pid}.tmp`;
  const text = JSON.stringify({
    url: `${url}/`,
    cookie: `oriel-launch=${secret}`,
    pid: process.pid,
  });
  writeFileSync(next, `${text}\n`, { mode: 0o600 });
  renameSync(next, path);
}

let deadline: NodeJS.Timeout | undefined;

// Closing stdin asks the server to quit, and it ends what it started as it
// exits; after 5 s the shell kills them all.
function stop() {
  quitting = true;
  const child = server;
  if (!child) return void app.quit();
  child.postMessage(null);
  deadline = setTimeout(() => {
    note(`the server didn't stop in ${quitGrace / 1000} s; killing it`);
    if (child.pid) killTree(child.pid);
  }, quitGrace);
}

function exited(child: UtilityProcess) {
  if (server !== child) return;
  server = null;
  origin = null;
  working = 0;
  clearTimeout(deadline);
  sweep();
  if (quitting) return void app.quit();
  stopped();
}

// The server and everything it started, by the process table, parents first.
function killTree(pid: number) {
  execFile("/bin/ps", ["-A", "-o", "pid=,ppid="], { env: {} }, (error, table) => {
    kill([pid, ...(error ? [] : descendants(table, pid))]);
  });
}

// Whatever a server that died without its own sweep left running, such as
// a Deno whose wall time only the server kept (rules.ts, orphans). At once,
// since the app may be about to quit.
function sweep() {
  let table: string;
  try {
    table = execFileSync("/bin/ps", ["-A", "-o", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      env: {},
    });
  } catch {
    return;
  }
  const left = orphans(table, process.pid);
  if (left.length > 0) note(`killed ${left.length} processes the server left running`);
  kill(left);
}

function kill(pids: number[]) {
  for (const pid of pids)
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
}

function killGroup(pid: number) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

// What the window shows when the server has stopped on its own: no script,
// and a Restart link the shell acts on (see guard).
const stoppedPage = (logs: string) => `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Oriel</title>
<style>
body{font:15px/1.4 system-ui;display:grid;place-items:center;height:92vh;margin:0;color:#333}
@media (prefers-color-scheme:dark){body{background:#1e1e1e;color:#ddd}}
main{text-align:center}p{margin:0 0 16px}small{display:block;margin-top:16px;opacity:.6}
a{display:inline-block;padding:6px 16px;border-radius:6px;background:#2f6feb;color:#fff;text-decoration:none}
</style>
<main><p>Oriel stopped.</p><a href="${restartUrl}">Restart</a><small>Its log is in ${logs}.</small></main>`;

function stopped() {
  const escaped = where.logs.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  void window?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(stoppedPage(escaped))}`);
}

// MARK: Answering the channel

function answer(child: UtilityProcess, line: string) {
  const parsed = parseRequest(line);
  const reply = (body: { ok: true; value: string | null } | { ok: false; error: string }) => {
    if (server === child) child.postMessage(`${JSON.stringify({ id: parsed.id, ...body })}\n`);
  };
  if ("refused" in parsed) {
    note(`refused a request: ${parsed.refused}`);
    if (parsed.id !== null) reply({ ok: false, error: parsed.refused });
    return;
  }
  handle(parsed.request).then(
    (value) => reply({ ok: true, value }),
    (error: unknown) =>
      reply({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
}

async function handle(request: Request): Promise<string | null> {
  switch (request.kind) {
    case "folder.pick":
      return pickFolder(request.prompt);
    case "notify":
      return notify(request.title, request.body, request.open);
    case "secret.get":
      return secrets.get(request.name);
    case "secret.set":
      await secrets.set(request.name, request.secret);
      return null;
    case "secret.delete":
      await secrets.delete(request.name);
      return null;
    case "window.focus":
      // Over the browser the person signed in with, which has the focus.
      if (!raises("focus-request", background)) return null;
      show("focus-request");
      if (process.platform === "darwin") app.focus({ steal: true });
      return null;
    case "working":
      working = request.threads;
      return null;
  }
}

async function pickFolder(prompt: string): Promise<string | null> {
  if (!window) throw new Error("no window");
  if (picking) throw new Error("a folder picker is already open");
  picking = true;
  try {
    show("folder-pick");
    const picked = await dialog.showOpenDialog(window, {
      title: "Choose a folder",
      message: prompt,
      buttonLabel: "Choose",
      properties: ["openDirectory"],
    });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  } finally {
    picking = false;
  }
}

// Notifications on screen, kept so a click still reaches them.
const shown = new Set<Notification>();

// Only while the window isn't in front: then the person is already looking.
// A click brings it forward on `open`, a path on the server's origin.
async function notify(title: string, body: string, open: string): Promise<null> {
  if (!window || window.isFocused()) return null;
  if (!Notification.isSupported()) throw new Error("this system shows no notifications");
  const notice = new Notification({
    title: notificationText(process.platform, title),
    body: notificationText(process.platform, body),
  });
  shown.add(notice);
  notice.once("close", () => shown.delete(notice));
  notice.once("click", () => {
    shown.delete(notice);
    show("notification");
    if (!origin) return;
    const url = new URL(open, origin).href;
    if (mayShow(url, origin, true) && window?.webContents.getURL() !== url)
      void window?.loadURL(url);
  });
  await new Promise<void>((resolve, reject) => {
    notice.once("show", () => resolve());
    notice.once("failed", (_, error) => {
      shown.delete(notice);
      reject(new Error(error));
    });
    notice.show();
  });
  return null;
}

// MARK: Measuring

// `pnpm desktop --measure` marks the app's package.json. Such a build, given
// `--measure <file>`, writes the time the overview first rendered there, and
// the window's page beside it as `<file>.png`, or `<file>-stopped.png` for
// the stopped page.
function measure(contents: WebContents) {
  const at = process.argv.indexOf("--measure");
  const file = at >= 0 ? process.argv[at + 1] : undefined;
  const own = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8")) as {
    measure?: boolean;
  };
  if (!file || own.measure !== true) return;
  const capture = (to: string) =>
    void contents.capturePage().then((image) => writeFileSync(to, image.toPNG()));
  contents.on("did-finish-load", function poll() {
    // Gone when the app quits before the overview renders, as on the first run.
    if (contents.isDestroyed()) return;
    if (contents.getURL().startsWith("data:")) return capture(`${file}-stopped.png`);
    void contents
      .executeJavaScript("document.querySelector('.overview-columns') !== null")
      .then((rendered: unknown) => {
        if (rendered !== true) return void setTimeout(poll, 10);
        writeFileSync(file, String(Date.now() / 1000));
        capture(`${file}.png`);
      });
  });
}
