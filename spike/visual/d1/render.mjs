// Renders a direction's specimen in light and dark, side by side, into
// spike/visual/d1/<a|b>/specimen.png, and its contrast table into
// contrast.json. `node spike/visual/d1/render.mjs a <out-dir>`.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const dir = process.argv[2];
const out = process.argv[3] ?? fileURLToPath(new URL(`${dir}/`, import.meta.url));
const page = fileURLToPath(new URL(`${dir}/specimen.html`, import.meta.url));
const browser = await chromium.launch({ channel: "chrome" });
try {
  const shots = {};
  const contrast = {};
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1180, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: theme,
    });
    const tab = await context.newPage();
    await tab.goto(`file://${page}`);
    await tab.waitForFunction("window.contrast");
    contrast[theme] = await tab.evaluate("window.contrast");
    // A tall window, not a full-page capture, which leaves the sandboxed
    // frame below the fold blank.
    const height = await tab.evaluate("document.documentElement.scrollHeight");
    await tab.setViewportSize({ width: 1180, height });
    await tab.waitForTimeout(200);
    shots[theme] = (await tab.screenshot()).toString("base64");
    writeFileSync(`${out}/specimen-${theme}.png`, Buffer.from(shots[theme], "base64"));
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 2360, height: 900 } });
  const tab = await context.newPage();
  await tab.setContent(
    `<body style="margin:0;display:flex;background:#888;gap:0">${["light", "dark"]
      .map(
        (t) => `<img style="width:1180px;display:block" src="data:image/png;base64,${shots[t]}">`,
      )
      .join("")}</body>`,
  );
  await tab.waitForFunction("[...document.images].every((i) => i.complete)");
  await tab.screenshot({ path: `${out}/specimen.png`, fullPage: true });
  writeFileSync(`${out}/contrast.json`, JSON.stringify(contrast, null, 1));
  const failing = Object.entries(contrast).flatMap(([t, rows]) =>
    rows.filter(([, , r]) => r < 4.5).map((r) => `${t}: ${r.join(" ")}`),
  );
  console.log(failing.length ? `under AA:\n${failing.join("\n")}` : "every pair at AA or better");
} finally {
  await browser.close();
}
