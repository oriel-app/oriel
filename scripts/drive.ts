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
//   drop <selector> <link>…  drop links or text on an element, as a drag from another tab does
//   wait <selector>          wait for an element to be visible
//   shot [name]              a full-page screenshot
//   threads [id]             each thread as JSON lines, newest last; `person` lines are the maintainer's
//   close                    close Chrome
//
// ORIEL_URL, ORIEL_DRIVE_PORT and ORIEL_CHROME_PROFILE (a folder under
// `.oriel/`) drive a second window, e.g. a fresh run on another port.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";

const root = new URL("../", import.meta.url);
const port = Number(process.env.ORIEL_DRIVE_PORT ?? 9333);
const app = process.env.ORIEL_URL ?? "http://127.0.0.1:4310/";
// A second window, e.g. a mock PM's fresh run beside the maintainer's, needs
// its own profile as well as its own debugging port.
const profileName = process.env.ORIEL_CHROME_PROFILE ?? "chrome";
if (!/^[a-z0-9-]+$/.test(profileName))
  throw new Error("ORIEL_CHROME_PROFILE is lowercase letters, digits and dashes");
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
  const profile = fileURLToPath(new URL(`.oriel/${profileName}/`, root));
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

// The page as an accessibility outline, with every password field's value
// masked: the outline carries what a field holds, and this one is printed.
async function outline(tab: Page): Promise<string> {
  const secrets = await tab
    .locator('input[type="password"]')
    .evaluateAll((fields) => fields.map((field) => (field as unknown as { value: string }).value));
  let text = await tab.locator("body").ariaSnapshot();
  for (const secret of secrets) if (secret) text = text.split(secret).join("••••••••");
  return text;
}

async function look(tab: Page): Promise<void> {
  console.log(`${await tab.title()} — ${tab.url()}`);
  console.log(await outline(tab));
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
  workstream: { name: string };
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
// `person` lines come from someone at the window; the rest, workstream names
// included, is source content, which anyone who can edit a source can write.
async function threads(only?: string): Promise<void> {
  const { threads: list } = await get<{ threads: { id: string }[] }>("/api/threads");
  const line = (value: Record<string, unknown>) => console.log(JSON.stringify(value));
  for (const { id } of list.toReversed()) {
    if (only && id !== only) continue;
    const view = await get<ThreadView>(`/api/threads/${id}`);
    line({ thread: view.id, state: view.state, workstream: view.workstream.name });
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

// Only a person approves a change set (decision 0003), and only a person
// sends a message held for the user to the agent, or discards it
// (decision 0024). The driver never presses a control that does either, or
// submits a form that has one, and never acts on a review link's page,
// whatever the server: the maintainer does that, in the same window.
const writes = /^(approve|apply|try again|revert)/i;
const held = /^(send to agent|discard)/i;
function refuse(why: string): true {
  console.error(`${why} Only a person does that; ask the maintainer.`);
  process.exitCode = 3;
  return true;
}
function refused(names: readonly string[]): boolean {
  const trimmed = names.map((name) => name.trim());
  const write = trimmed.find((name) => writes.test(name));
  if (write !== undefined) return refuse(`"${write}" can approve, apply or revert a change set.`);
  const settle = trimmed.find((name) => held.test(name));
  return (
    settle !== undefined && refuse(`"${settle}" sends or discards a message held for the user.`)
  );
}
const onReviewPage = (path: string): boolean =>
  path.startsWith("/review/") && refuse("This is a review link's page.");
// One key, after any modifiers: a chord like Tab+Enter would move focus onto
// a control and press it before the guard could see it.
const modifiers = new Set(["Shift", "Control", "Alt", "Meta", "ControlOrMeta"]);
const oneKey = (chord: string): boolean => {
  const keys = chord.split("+");
  return keys.length > 0 && keys.slice(0, -1).every((key) => modifiers.has(key));
};

// An element's accessible name, near enough: its label, else its text. It
// runs in the page; these are the two DOM members it uses.
type Named = { getAttribute(name: string): string | null; textContent: string | null };
const nameOf = (el: Named | null): string =>
  el ? (el.getAttribute("aria-label") ?? (el.textContent || el.getAttribute("value")) ?? "") : "";
// An element's name and the names of the controls inside it. It runs in the
// page, so it stands alone.
type Within = Named & { querySelectorAll(selector: string): ArrayLike<Named> };
const namesWithin = (el: Within): string[] =>
  [el, ...Array.from(el.querySelectorAll("button, input[type=submit], [role=button]"))].map(
    (each) =>
      each.getAttribute("aria-label") ?? (each.textContent || each.getAttribute("value")) ?? "",
  );
// The focused element's name, and its form's submit buttons', which Enter presses.
const focusedNames = `(() => {
  const nameOf = ${nameOf.toString()};
  const el = document.activeElement;
  const submits = el?.form?.querySelectorAll("button:not([type]), button[type=submit], input[type=submit]") ?? [];
  return [nameOf(el), ...Array.from(submits, nameOf)];
})()`;

const commands = [
  "open",
  "look",
  "click",
  "fill",
  "press",
  "drop",
  "wait",
  "shot",
  "threads",
  "close",
];
const [command = "look", ...args] = process.argv.slice(2);
// What each command needs, checked before Chrome opens.
const needs: Record<string, number> = { click: 1, fill: 2, press: 1, drop: 2, wait: 1 };
// Output is left to drain: exiting at once could cut a long transcript.
if (!commands.includes(command)) {
  console.error(`unknown command ${command}; see the comment at the top of scripts/drive.ts`);
  process.exitCode = 2;
} else if (args.length < (needs[command] ?? 0)) {
  console.error(`${command} needs ${needs[command]} argument(s); see scripts/drive.ts`);
  process.exitCode = 2;
} else if (command === "threads") await threads(args[0]);
else if (command === "close") {
  // Only a running Chrome; nothing running is already closed.
  const running = await attach();
  if (running) await (await running.newBrowserCDPSession()).send("Browser.close");
} else await drive();

// One command at a time, so none can move focus or change the page between
// another's check and its action. A lock left by a command that died is
// taken over.
function lock(): boolean {
  const path = fileURLToPath(new URL(".oriel/drive.lock", root));
  mkdirSync(fileURLToPath(new URL(".oriel/", root)), { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(path, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      process.once("exit", () => rmSync(path, { force: true }));
      return true;
    } catch {
      const holder = Number(readFileSync(path, "utf8"));
      try {
        process.kill(holder, 0);
        return false;
      } catch {
        rmSync(path, { force: true });
      }
    }
  }
  return false;
}

async function drive(): Promise<void> {
  if (!lock()) {
    console.error("Another drive command is running; wait for it to finish.");
    process.exitCode = 2;
    return;
  }
  const on = await browser();
  try {
    const tab = await page(on);
    // Only Oriel's own pages: no other site, and no javascript: URL, which
    // would run in the page past every check here.
    const going = command === "open" ? URL.parse(args[0] ?? "/", app) : URL.parse(tab.url());
    if (going?.origin !== new URL(app).origin) {
      console.error(
        command === "open"
          ? `open goes only to Oriel's pages, at ${app}`
          : `The tab isn't on Oriel; run \`open\` first.`,
      );
      process.exitCode = 2;
      return;
    }
    if (command !== "look" && command !== "shot" && command !== "wait")
      if (onReviewPage(going.pathname)) return;
    switch (command) {
      case "open":
        await tab.goto(going.href);
        await look(tab);
        break;
      case "look":
        await look(tab);
        break;
      case "click": {
        // One element, found once: what's checked is what's clicked, and a
        // control inside it counts, since a click on it can land there.
        const target = await tab.locator(need(args[0], "a selector")).first().elementHandle();
        if (!target) throw new Error(`nothing matches ${args[0]}`);
        const names = await target.evaluate(namesWithin);
        if (refused(names)) return;
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
        if (!oneKey(args[0] ?? "")) {
          console.error("press takes one key, after any modifiers, like Enter or Shift+Tab");
          process.exitCode = 2;
          return;
        }
        const focused: unknown = await tab.evaluate(focusedNames);
        if (refused(Array.isArray(focused) ? focused.map(String) : [])) return;
        await tab.keyboard.press(need(args[0], "a key"));
        await look(tab);
        break;
      }
      case "drop": {
        const target = tab.locator(need(args[0], "a selector")).first();
        const links = args.slice(1);
        if (links.length === 0) need(undefined, "a link or text to drop");
        // Built in the page, which has the DOM this script's types don't.
        const data = await tab.evaluateHandle(`(() => {
          const dropped = ${JSON.stringify(links)};
          const transfer = new DataTransfer();
          const urls = dropped.filter((each) => URL.canParse(each));
          if (urls.length > 0) transfer.setData("text/uri-list", urls.join("\\r\\n"));
          transfer.setData("text/plain", dropped.join("\\n"));
          return transfer;
        })()`);
        // The zone shows its veil on dragenter, and the veil takes the drop.
        await target.dispatchEvent("dragenter", { dataTransfer: data });
        const veil = tab.locator(".drop-veil");
        const onto = (await veil.count()) > 0 ? veil : target;
        for (const type of ["dragover", "drop"])
          await onto.dispatchEvent(type, { dataTransfer: data });
        await tab.waitForLoadState();
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
