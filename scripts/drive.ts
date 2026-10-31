// `pnpm drive`: drive the running window from a shell, one command per call,
// so an agent can use Oriel the way a person does while that person watches
// and clicks in the same window. A tool, not a test.
//
// The first command opens the installed Chrome, headed, with its own profile
// under the gitignored `.oriel/chrome/` and a debugging port, and leaves it
// running; later commands attach to it. Screenshots go to the gitignored
// `shots/drive/`.
//
//   open [url]               go to a page; the window at :4310 by default
//   look                     the page as an accessibility outline, and a screenshot
//   click <selector>         click; a Playwright selector, e.g. 'role=button[name="Approve"]'
//   fill <selector> <text>   replace a field's text
//   press <key>              press a key in the focused element, e.g. Enter
//   wait <selector>          wait for an element to be visible
//   shot [name]              a full-page screenshot
//   threads [id]             each thread as JSON lines, newest last; `person` lines are the maintainer's
//   close                    close Chrome
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";

const root = new URL("../", import.meta.url);
const port = Number(process.env.ORIEL_DRIVE_PORT ?? 9333);
const app = process.env.ORIEL_URL ?? "http://127.0.0.1:4310/";
const chrome =
  process.env.ORIEL_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const shots = fileURLToPath(new URL("shots/drive/", root));
// Long enough for a model turn to land, short enough to notice a hang.
const timeout = 30_000;

async function attach(): Promise<Browser | null> {
  try {
    return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2_000 });
  } catch {
    return null;
  }
}

async function browser(): Promise<Browser> {
  const running = await attach();
  if (running) return running;
  const profile = fileURLToPath(new URL(".oriel/chrome/", root));
  mkdirSync(profile, { recursive: true });
  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
      app,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  for (let tries = 0; tries < 50; tries++) {
    const started = await attach();
    if (started) return started;
    await wait(200);
  }
  throw new Error(`Chrome didn't open its debugging port, ${port}`);
}

// The tab showing Oriel, or the first tab.
async function page(on: Browser): Promise<Page> {
  const pages = on.contexts().flatMap((context) => context.pages());
  const origin = new URL(app).origin;
  const found = pages.find((tab) => tab.url().startsWith(origin)) ?? pages[0];
  if (found) {
    found.setDefaultTimeout(timeout);
    return found;
  }
  const context = on.contexts()[0] ?? (await on.newContext());
  const opened = await context.newPage();
  opened.setDefaultTimeout(timeout);
  return opened;
}

let count = 0;
async function shot(tab: Page, name?: string): Promise<string> {
  mkdirSync(shots, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const path = `${shots}${name ?? `${stamp}-${count++}`}.png`;
  await tab.screenshot({ path, fullPage: true });
  return path;
}

async function look(tab: Page): Promise<void> {
  console.log(`${await tab.title()} — ${tab.url()}`);
  console.log(await tab.locator("body").ariaSnapshot());
  console.log(`screenshot: ${await shot(tab)}`);
}

type Entry = {
  seq: number;
  at: string;
  kind: string;
  text?: string;
  changeSetId?: string;
} & Record<string, unknown>;
type ThreadView = {
  id: string;
  group: { name: string };
  state: string;
  entries: Entry[];
  changeSets: { id: string; status: string }[];
};

// GETs need no Origin (packages/server/src/guard.ts).
async function get<T>(path: string): Promise<T> {
  const reply = await fetch(new URL(path, app));
  if (!reply.ok) throw new Error(`GET ${path}: ${reply.status}`);
  return (await reply.json()) as T;
}

// Each thread as a transcript, oldest first, one JSON line per entry, so no
// text inside an entry can pass for another: what the person typed, what the
// agent said (its streamed text joined), its runs and its change sets. Only
// `person` lines come from someone at the window; the rest, group names
// included, is source content, which anyone who can edit a source can write.
async function threads(only?: string): Promise<void> {
  const { threads: list } = await get<{ threads: { id: string }[] }>("/api/threads");
  const line = (value: Record<string, unknown>) => console.log(JSON.stringify(value));
  for (const { id } of list.toReversed()) {
    if (only && id !== only) continue;
    const view = await get<ThreadView>(`/api/threads/${id}`);
    line({ thread: view.id, state: view.state, group: view.group.name });
    let said = "";
    const flush = () => {
      if (said) line({ kind: "agent", text: said });
      said = "";
    };
    for (const entry of view.entries) {
      if (entry.kind === "text") {
        said += entry.text ?? "";
        continue;
      }
      flush();
      if (entry.kind === "user") line({ kind: "person", at: entry.at, text: entry.text });
      else if (entry.kind === "change-set") {
        const set = view.changeSets.find((each) => each.id === entry.changeSetId);
        line({ kind: "change-set", id: entry.changeSetId, status: set?.status ?? null });
      } else if (entry.kind === "run.started" || entry.kind === "run.finished")
        line({ kind: entry.kind });
      else {
        // Markers, errors, limits, searches: everything they say but the order.
        const { seq: _seq, ...rest } = entry;
        line(rest);
      }
    }
    flush();
  }
}

// Only a person approves a change set (decision 0003). Against a server that
// writes to a real site, the driver won't press a control that approves,
// applies or reverts one; the maintainer does, in the same window. On the
// fixture, nothing real is written, so mock PMs may.
const writes = /^(approve|apply|try again|revert)/i;
async function refused(name: string): Promise<boolean> {
  if (!writes.test(name.trim())) return false;
  const window = await get<{ fixture: boolean }>("/api/window").catch(() => null);
  if (window?.fixture) return false;
  console.error(
    `"${name.trim()}" writes to a real site, and only a person approves that. Ask the maintainer to press it.`,
  );
  process.exitCode = 3;
  return true;
}

// An element's accessible name, near enough: its label, else its text. It
// runs in the page; these are the two DOM members it uses.
type Named = { getAttribute(name: string): string | null; textContent: string | null };
const nameOf = (el: Named | null): string =>
  el ? (el.getAttribute("aria-label") ?? el.textContent ?? "") : "";

const commands = ["open", "look", "click", "fill", "press", "wait", "shot", "threads", "close"];
const [command = "look", ...args] = process.argv.slice(2);
// Output is left to drain: exiting at once could cut a long transcript.
if (!commands.includes(command)) {
  console.error(`unknown command ${command}; see the comment at the top of scripts/drive.ts`);
  process.exitCode = 2;
} else if (command === "threads") await threads(args[0]);
else if (command === "close") {
  // Only a running Chrome; nothing running is already closed.
  const running = await attach();
  if (running) await (await running.newBrowserCDPSession()).send("Browser.close");
} else await drive();

async function drive(): Promise<void> {
  const on = await browser();
  try {
    const tab = await page(on);
    switch (command) {
      case "open":
        await tab.goto(args[0] ? new URL(args[0], app).href : app);
        await look(tab);
        break;
      case "look":
        await look(tab);
        break;
      case "click": {
        const target = tab.locator(need(args[0], "a selector")).first();
        if (await refused(await target.evaluate(nameOf))) return;
        await target.click();
        await tab.waitForLoadState();
        await look(tab);
        break;
      }
      case "fill":
        await tab.locator(need(args[0], "a selector")).first().fill(need(args[1], "the text"));
        await look(tab);
        break;
      case "press": {
        const focused = await tab.evaluate(`(${nameOf.toString()})(document.activeElement)`);
        if (await refused(String(focused))) return;
        await tab.keyboard.press(need(args[0], "a key"));
        await look(tab);
        break;
      }
      case "wait":
        await tab.locator(need(args[0], "a selector")).first().waitFor();
        await look(tab);
        break;
      case "shot":
        console.log(await shot(tab, args[0]));
        break;
    }
  } finally {
    // Detaches; Chrome keeps running.
    await on.close();
  }
}

function need(value: string | undefined, what: string): string {
  if (value === undefined) {
    console.error(`${command} needs ${what}`);
    process.exit(2);
  }
  return value;
}
