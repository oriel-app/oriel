// Photographs every screen build.ts wrote, at 1280×800 and 960×640, light
// theme, with the installed Chrome. `node shoot.ts [prefix…]` takes only the
// screens whose names start with a prefix.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const screens = JSON.parse(readFileSync(join(here, "screens", "index.json"), "utf8")) as {
  name: string;
}[];
const prefixes = process.argv.slice(2);
const picked = screens.filter(
  ({ name }) => prefixes.length === 0 || prefixes.some((prefix) => name.startsWith(prefix)),
);
const png = join(here, "png");
mkdirSync(png, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const [width, height] of [
    [1280, 800],
    [960, 640],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    const page = await context.newPage();
    for (const { name } of picked) {
      await page.goto(pathToFileURL(join(here, "screens", `${name}.html`)).href);
      await page.evaluate(() => document.fonts.ready);
      const file = join(png, `${name}-${width}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
