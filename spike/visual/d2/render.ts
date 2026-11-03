// Renders the specimen page in light and dark, then both side by side, to
// spike/visual/d2/out/. A spike's tool: `node spike/visual/d2/render.ts a`.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const name = process.argv[2] ?? "a";
const page = new URL("specimen.html", import.meta.url).href;
const out = new URL("out/", import.meta.url);
mkdirSync(out, { recursive: true });
const shot = (file: string) => fileURLToPath(new URL(file, out));

const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    const tab = await context.newPage();
    await tab.goto(page);
    await tab.frameLocator("#frame").locator("h1").waitFor();
    // A full-page shot leaves a frame below the fold unpainted until it
    // has been scrolled to.
    await tab.locator("#frame").scrollIntoViewIfNeeded();
    await tab.evaluate(() => new Promise(requestAnimationFrame));
    await tab.screenshot({ path: shot(`specimen-${name}-${theme}.png`), fullPage: true });
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 2200, height: 900 } });
  const tab = await context.newPage();
  const both = new URL(`specimen-${name}.html`, out);
  writeFileSync(
    both,
    `<body style="margin:0;display:flex;align-items:start;background:#888">` +
      ["light", "dark"].map((theme) => `<img src="specimen-${name}-${theme}.png" style="width:1100px">`).join("") +
      `</body>`,
  );
  await tab.goto(both.href);
  await tab.screenshot({ path: shot(`specimen-${name}.png`), fullPage: true });
  await context.close();
} finally {
  await browser.close();
}
console.log(shot(`specimen-${name}.png`));
