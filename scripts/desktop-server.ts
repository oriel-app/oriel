// `pnpm desktop:server`: the server in desktop mode, started by a fake shell
// on this terminal, so a person can try the desktop app's server without
// the app (decision 0036, desktop/PROTOCOL.md). For development only:
//
// - It draws the launch secret, as the shell does, and prints it here, so
//   another browser can be given the cookie by hand.
// - It opens Chrome with the cookie already set, as the shell's window has
//   it, unless `--no-browser`.
// - Secrets are kept in memory and gone when it stops. A folder pick asks
//   on this terminal; a notification prints here.
// - The data folder is the gitignored `.oriel/desktop/`.
//
// Ctrl-C quits both: the server's stdin closes, as when the shell quits.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type Browser, chromium } from "playwright-core";
import type { ServerLine } from "../packages/server/src/desktop/protocol.ts";

const { values } = parseArgs({ options: { "no-browser": { type: "boolean" } } });
const root = fileURLToPath(new URL("../", import.meta.url));
const data = join(root, ".oriel", "desktop");
mkdirSync(data, { recursive: true, mode: 0o700 });
const secret = randomBytes(32).toString("hex");

// Only what the shell would give it: never this terminal's own environment.
const env: Record<string, string> = {};
for (const name of ["HOME", "TMPDIR", "LANG", "PATH"]) {
  const value = process.env[name];
  if (value !== undefined) env[name] = value;
}
const server = spawn(
  process.execPath,
  [join(root, "packages/server/src/main.ts"), "--desktop", "--data", data],
  { stdio: ["pipe", "pipe", "inherit"], env },
);
server.stdin.write(`${secret}\n`);
const exited = new Promise<number>((resolve) =>
  server.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))),
);
// The terminal sends Ctrl-C to the server too; closing its stdin is how the
// shell asks on every OS.
process.on("SIGINT", () => server.stdin.end());

const secrets = new Map<string, string>();
let browser = null as Browser | null;

const answer = (id: number, value: unknown) =>
  server.stdin.write(`${JSON.stringify({ id, ok: true, value })}\n`);

// Asked only when a folder is, so the terminal is otherwise left alone.
async function askFolder(prompt: string): Promise<string | null> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const typed = await new Promise<string>((resolve) =>
    terminal.question(`${prompt}. An absolute path, or Enter to cancel: `, resolve),
  );
  terminal.close();
  return typed.trim() || null;
}

async function opened(url: string): Promise<void> {
  console.log(`\nOriel's desktop server is at ${url}`);
  console.log(`Launch secret, for development only: ${secret}`);
  console.log(
    "Another browser needs it as the cookie oriel-launch for 127.0.0.1, HttpOnly, SameSite=Strict.\n",
  );
  if (values["no-browser"]) return;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: false });
    const context = await browser.newContext({ viewport: null });
    await context.addCookies([
      {
        name: "oriel-launch",
        value: secret,
        url,
        httpOnly: true,
        sameSite: "Strict",
        secure: false,
      },
    ]);
    await (await context.newPage()).goto(url);
  } catch (error) {
    console.log(`Couldn't open Chrome (${String(error).split("\n")[0]}); open ${url} by hand.`);
  }
}

for await (const line of createInterface({ input: server.stdout, crlfDelay: Infinity })) {
  const sent = JSON.parse(line) as ServerLine;
  if (!("id" in sent)) {
    void opened(sent.url);
    continue;
  }
  switch (sent.kind) {
    case "secret.get":
      answer(sent.id, secrets.get(sent.name) ?? null);
      break;
    case "secret.set":
      secrets.set(sent.name, sent.secret);
      console.log(`Kept the secret ${sent.name}, in memory.`);
      answer(sent.id, null);
      break;
    case "secret.delete":
      secrets.delete(sent.name);
      answer(sent.id, null);
      break;
    case "notify":
      console.log(`Notification: ${sent.title}: ${sent.body}`);
      answer(sent.id, null);
      break;
    case "folder.pick":
      void askFolder(sent.prompt).then((path) => answer(sent.id, path));
      break;
  }
}

await browser?.close().catch(() => {});
process.exit(await exited);
