// `pnpm shots [path…] [--width 1280] [--height 900] [--full]`: screenshots
// of the workshop's pages in headless Chrome, written to the gitignored
// shots/. With no paths, the review set: the index, a component page, the
// select lab and a screen, in Graphite and Broadsheet. It starts its own
// server on a free port, so it never touches :4400.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { root } from "../src/oriel.ts";
import { start } from "../src/server.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "900" },
    full: { type: "boolean", default: false },
  },
});

const review = [
  "/",
  "/components/chat-input",
  "/lab/select",
  "/screens/thread-approve",
  "/?theme=broadsheet",
  "/components/chat-input?theme=broadsheet&scheme=dark",
  "/lab/select?theme=broadsheet",
  "/screens/thread-approve?theme=broadsheet&scheme=dark",
];

const paths = positionals.length > 0 ? positionals : review;
const out = join(root, "shots");
mkdirSync(out, { recursive: true });

const server = await start(0);
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const browser = await chromium.launch({ channel: "chrome", chromiumSandbox: true, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: Number(values.width), height: Number(values.height) },
    deviceScaleFactor: 2,
  });
  for (const path of paths) {
    await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
    // Frames report their heights a moment after they load.
    await page.waitForTimeout(600);
    const name =
      path
        .replace(/^\//, "")
        .replace(/[?&=#/]+/g, "-")
        .replace(/-$/, "") || "index";
    const file = join(out, `${name}-${values.width}.png`);
    await page.screenshot({ path: file, fullPage: values.full });
    console.log(file);
  }
} finally {
  await browser.close();
  server.close();
}
