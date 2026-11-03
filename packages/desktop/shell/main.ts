// The desktop app's shell (decisions 0036 and 0039): Electron's main process,
// a window over the server, which runs as this process's child on the Node
// the bundle carries, not Electron's. The shell holds no product logic. It
// starts the server, shows its page, and does what the page can't: the folder
// picker, notifications and the secret store (secrets.ts).
//
// - Launch. The server gets an environment built here: HOME, TMPDIR, LANG and
//   the login shell's PATH, with the bundle's Deno first. The shell draws a
//   32-byte launch secret and writes it, as hex, as stdin's first line, then
//   sets it as the session cookie before the window's first load. The
//   server's first stdout line names its URL.
// - The channel. Then stdin and stdout carry JSON lines: the server asks and
//   the shell answers only what rules.ts parses; anything else is refused.
// - The page has no preload and no bridge to the shell. Renderers are
//   sandboxed and isolated, every permission is denied, the window stays on
//   the server's origin, and other http(s) links open in the default browser.
// - One instance per data folder: Electron's lock lives in the shell's folder
//   inside it. A second launch brings the first one's window forward.
// - Quitting closes the server's stdin, and kills its process group after
//   5 s. While the server says Oriel is working on a thread, Quit in the
//   menu (Cmd+Q) and closing the window ask the person first (decision
//   0045). The server's stderr goes to the logs folder. If the server dies on
//   its own, the window says so and offers Restart.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
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
  type WebContents,
} from "electron";
import {
  fixedKey,
  folders,
  lang,
  Lines,
  mayShow,
  mayUse,
  notificationText,
  opensOutside,
  parseRequest,
  pathEnd,
  pathStart,
  printedPath,
  quitQuestion,
  readyOrigin,
  restartUrl,
  serverPath,
  storageProblem,
  type Request,
} from "./rules.ts";
import { secretStore } from "./secrets.ts";

const quitGrace = 5_000;
const loginShellTimeout = 5_000;
const maxLine = 1 << 20;

const home = homedir();
const where = folders(process.argv, home);
const resources = process.resourcesPath;
const node = join(resources, "node/bin/node");
const deno = join(resources, "deno");
const main = join(resources, "server/packages/server/src/main.ts");

let window: BrowserWindow | null = null;
let server: ChildProcessWithoutNullStreams | null = null;
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
// there before.
const secrets = secretStore(join(where.data, "Secrets"), {
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
});

for (const dir of [where.data, where.logs, where.shell])
  mkdirSync(dir, { recursive: true, mode: 0o700 });
app.setPath("userData", where.shell);
app.setPath("sessionData", where.shell);
app.setAppLogsPath(where.logs);
app.enableSandbox();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", show);
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

// Whether to quit while Oriel works. Quit quits, without asking again.
function ask() {
  if (asking || !window) return;
  asking = true;
  show();
  note(`asked before quitting, while working on ${working}`);
  void dialog
    .showMessageBox(window, { type: "warning", noLink: true, ...quitQuestion(working) })
    .then(({ response }) => {
      asking = false;
      note(response === 0 ? "quitting anyway" : "not quitting");
      if (response === 0) app.quit();
    });
}

function show() {
  if (!window) return;
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
    const child = ownNode()
      ? forkServer(env)
      : (spawn(node, [main, "--desktop", "--data", where.data], {
          cwd: where.data,
          env,
          detached: true,
          stdio: ["pipe", "pipe", log >= 0 ? log : "ignore"],
        }) as unknown as ChildProcessWithoutNullStreams);
    server = child;
    child.stdin.on("error", () => {});
    child.stdin.write(`${secret}\n`);
    note(`started the server, pid ${child.pid}`);
    let first = true;
    const lines = new Lines(maxLine, () => note(`dropped a line over ${maxLine} bytes`));
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      for (const line of lines.push(chunk)) {
        if (server !== child) return;
        if (first) {
          first = false;
          void open(child, line, secret);
        } else answer(child, line);
      }
    });
    child.on("error", (error) => {
      note(`couldn't start the server: ${error.message}`);
      exited(child);
    });
    child.on("exit", (code, signal) => {
      note(`the server exited, ${signal ?? `status ${code}`}`);
      exited(child);
    });
  });
}

// The first line: set the cookie, then load the page.
async function open(child: ChildProcessWithoutNullStreams, line: string, secret: string) {
  const found = readyOrigin(line);
  if (!found) {
    note("the server's first line wasn't its URL");
    child.stdin.end();
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
  // Not if the server stopped meanwhile, which shows the stopped page.
  if (server === child) await window?.loadURL(`${found}/`);
}

let deadline: NodeJS.Timeout | undefined;

// Closing stdin asks the server to quit; after 5 s its group is killed.
function stop() {
  quitting = true;
  const child = server;
  if (!child) return void app.quit();
  child.stdin.end();
  deadline = setTimeout(() => {
    note(`the server didn't stop in ${quitGrace / 1000} s; killing it`);
    if (child.pid) killGroup(child.pid);
  }, quitGrace);
}

function exited(child: ChildProcessWithoutNullStreams) {
  if (server !== child) return;
  server = null;
  origin = null;
  working = 0;
  clearTimeout(deadline);
  // Anything the server left in its group, such as a Deno or tsc.
  if (child.pid) killGroup(child.pid);
  if (quitting) return void app.quit();
  stopped();
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

function answer(child: ChildProcessWithoutNullStreams, line: string) {
  const parsed = parseRequest(line);
  const reply = (body: { ok: true; value: string | null } | { ok: false; error: string }) => {
    if (server === child) child.stdin.write(`${JSON.stringify({ id: parsed.id, ...body })}\n`);
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
      show();
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
    show();
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
    show();
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

// MARK: The server on Electron's own Node (the desktop-size spike)

// `pnpm desktop --own-node` marks the app's package.json: the server runs in
// a utility process on Electron's Node, with the channel's lines as messages.
function ownNode(): boolean {
  const own = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8")) as {
    ownNode?: boolean;
  };
  return own.ownNode === true;
}

// The utility process, in the shape the rest of the shell uses: stdin's
// lines become messages, and so do stdout's; ending stdin sends "end".
function forkServer(env: Record<string, string>): ChildProcessWithoutNullStreams {
  const child = utilityProcess.fork(main, ["--desktop", "--data", where.data], {
    cwd: where.data,
    env,
    stdio: ["ignore", "ignore", "pipe"],
    serviceName: "Oriel Server",
  });
  const stdout = Object.assign(new EventEmitter(), { setEncoding: () => stdout });
  const facade = Object.assign(new EventEmitter(), {
    pid: undefined as number | undefined,
    stdout,
    stdin: Object.assign(new EventEmitter(), {
      write: (text: string) => {
        for (const line of text.split("\n").filter(Boolean)) child.postMessage(line);
        return true;
      },
      end: () => child.postMessage({ end: true }),
    }),
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (log >= 0) writeSync(log, chunk);
  });
  child.on("spawn", () => (facade.pid = child.pid));
  child.on("message", (line: string) => stdout.emit("data", `${line}\n`));
  child.on("exit", (code) => facade.emit("exit", code, null));
  child.on("error", (type) => facade.emit("error", new Error(String(type))));
  return facade as unknown as ChildProcessWithoutNullStreams;
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
