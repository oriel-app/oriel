// `node scripts/mcp-connect-timing.ts <window> <door> <codex-home>`: the
// spike's timing of connecting a program from Settings, Outside tools, on
// a throwaway Oriel. In the installed Chrome, headless, it opens the page,
// starts Codex's sign-in (`codex mcp login --no-browser`, on a throwaway
// CODEX_HOME that keeps its token in a file), plays the browser Codex would
// open, and clicks Let it in when the ask shows; then it adds a program
// with a token by hand. It prints each step's time from opening Settings,
// and writes screenshots to the folder `--shots` names.
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { shots: { type: "string", default: "/tmp" } },
});
const [window, door, home] = positionals as [string, string, string];
const browser = await chromium.launch({ channel: "chrome", chromiumSandbox: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const t0 = Date.now();
const at = (what: string) => console.log(`${String(Date.now() - t0).padStart(6)} ms  ${what}`);
await page.goto(new URL("settings/tools", window).href);
await page.getByRole("heading", { name: "Outside tools" }).waitFor();
at("Settings, Outside tools, open");
await page.screenshot({ path: `${values.shots}/tools-empty.png`, fullPage: true });

const codex = spawn(
  "codex",
  [
    "mcp",
    "login",
    "oriel",
    "--no-browser",
    "-c",
    'mcp_oauth_credentials_store="file"',
    "-c",
    `mcp_servers.oriel.url="${door}"`,
  ],
  { env: { ...process.env, CODEX_HOME: home }, stdio: ["pipe", "pipe", "pipe"] },
);
const printed = Promise.withResolvers<string>();
let out = "";
const read = (chunk: Buffer) => {
  out += chunk;
  const url = /(http:\/\/127\.0\.0\.1:\d+\/authorize\?\S+)/.exec(out)?.[1];
  if (url) printed.resolve(url);
};
codex.stdout.on("data", read);
codex.stderr.on("data", read);
const exited = new Promise<number | null>((resolve) => codex.on("exit", resolve));
const authorize = await printed.promise;
at("codex mcp login printed its sign-in URL");
// The browser Codex would open: the page waits for the window's answer.
const tab = await browser.newPage({ viewport: { width: 900, height: 500 } });
await tab.goto(authorize);
at("the browser shows the code");
await tab.screenshot({ path: `${values.shots}/tools-browser-waiting.png` });
const ask = page.getByRole("form", { name: "Codex asks to sign in" });
await ask.waitFor();
at("the window shows Codex asking");
await page.screenshot({ path: `${values.shots}/tools-ask.png`, fullPage: true });
await ask.getByRole("radio", { name: "Read and act" }).check();
await ask.getByRole("button", { name: "Let it in" }).click();
at("the person clicked Let it in");
await tab.waitForURL(/\/callback\//, { timeout: 10_000 });
at(`the browser went back to Codex: ${(await tab.textContent("body"))?.trim().slice(0, 60)}`);
at(`codex mcp login exited ${await exited}`);
await page.getByText("Signed in from Oriel's window").first().waitFor();
at("Settings lists Codex, signed in");

await page.getByRole("button", { name: "Add a program with a token instead" }).click();
await page.getByPlaceholder("Claude Code").fill("Claude Code");
await page.getByRole("radio", { name: "Read and act" }).last().check();
await page.getByRole("button", { name: "Add", exact: true }).click();
await page.getByText("Claude Code is connected").waitFor();
at("a token for Claude Code shows, once");
await page.screenshot({ path: `${values.shots}/tools-token.png`, fullPage: true });
const command = await page
  .locator(".outside-tool-added .outside-tool-command")
  .first()
  .textContent();
console.log(`TOKEN ${/Bearer (oriel_pt_[\w-]+)/.exec(command ?? "")?.[1] ?? ""}`);
await page.getByRole("main").getByRole("button", { name: "Done" }).click();
await page.screenshot({ path: `${values.shots}/tools-connected.png`, fullPage: true });
await browser.close();
