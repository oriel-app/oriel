// `pnpm shots`: screenshots of the window, for looking at. A tool, not a test.
// It drives the installed Chrome, downloads no browser, and writes PNGs to the
// gitignored shots/. `pnpm shots` builds the web app first.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { serve } from "../packages/server/src/serve.ts";

type Grouping = "epic" | "assignee" | "stuck";
type Scene = { name: string; start: Grouping; act?(page: Page): Promise<void> };

const scenes: Scene[] = [
  { name: "epic", start: "epic" },
  { name: "epic-expanded", start: "epic", act: openFirstCluster },
  { name: "assignee", start: "epic", act: (page) => pick(page, "assignee", "Assignee") },
  { name: "assignee-expanded", start: "assignee", act: openAll },
  { name: "stuck", start: "stuck" },
  { name: "stuck-expanded", start: "stuck", act: openAll },
];
const widths = [1280, 390];
const themes = ["light", "dark"] as const;

async function shown(page: Page, grouping: Grouping): Promise<void> {
  await page.locator(`main[aria-busy="false"] .clusters[data-grouping="${grouping}"]`).waitFor();
}

// Switches grouping with the control, as a user would.
async function pick(page: Page, grouping: Grouping, name: string): Promise<void> {
  await page.getByRole("group", { name: "Group by" }).getByRole("button", { name }).click();
  await shown(page, grouping);
  await page.waitForURL(`**/?grouping=${grouping}`);
}

async function openFirstCluster(page: Page): Promise<void> {
  await page.locator(".cluster-toggle").first().click();
  await page.locator('.cluster-toggle[aria-expanded="true"]').first().waitFor();
}

async function openAll(page: Page): Promise<void> {
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Items" }).click();
  await page
    .locator('.cluster-toggle[aria-expanded="false"]')
    .first()
    .waitFor({ state: "detached" });
}

const out = new URL("../shots/", import.meta.url);
mkdirSync(out, { recursive: true });

const server = await serve(0);
const browser = await chromium.launch({ channel: "chrome" });
const problems: string[] = [];
try {
  for (const theme of themes) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: width < 600 ? 844 : 800 },
        deviceScaleFactor: 2,
        colorScheme: theme,
        locale: "en-US",
        timezoneId: "UTC",
      });
      const page = await context.newPage();
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
          problems.push(`${theme} ${width}: console ${message.type()}: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => problems.push(`${theme} ${width}: ${error.message}`));
      for (const scene of scenes) {
        await page.goto(new URL(`?grouping=${scene.start}`, server.url).href);
        await shown(page, scene.start);
        await scene.act?.(page);
        const path = fileURLToPath(new URL(`${scene.name}-${theme}-${width}.png`, out));
        await page.screenshot({ path, fullPage: true, animations: "disabled" });
        console.log(path);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

for (const problem of problems) console.error(problem);
process.exitCode = problems.length === 0 ? 0 : 1;
