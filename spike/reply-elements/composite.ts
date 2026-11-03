// Spike (reply-elements): side-by-side pictures for the report, from
// shots.ts's screenshots. Before (today) and after (R2), wide and light;
// all four arms, narrow and dark.
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const out = new URL("out/", import.meta.url);
const report = new URL("report/", import.meta.url);
mkdirSync(report, { recursive: true });
const img = (name: string) =>
  `data:image/png;base64,${readFileSync(new URL(name, out)).toString("base64")}`;
const names: Record<string, string> = {
  today: "Today (main, OA-113 chips)",
  r0: "R0: keys recognized, no teaching",
  r1: "R1: [[id]] references",
  r2: "R2: references + quote from an item",
};
const column = (scene: string, arm: string, theme: string, width: number) =>
  `<figure><figcaption>${names[arm]}</figcaption><img src="${img(`${scene}-${arm}-${theme}-${width}.png`)}"></figure>`;
const page = (scene: string, arms: string[], theme: string, width: number) =>
  `<!doctype html><style>body{margin:0;background:${theme === "dark" ? "#111" : "#ddd"};font:600 14px system-ui;color:${theme === "dark" ? "#eee" : "#222"}}
  main{display:flex;gap:12px;padding:12px;align-items:flex-start;width:max-content}figure{margin:0}figcaption{padding:4px 0 8px}img{display:block;border-radius:6px}</style>
  <main>${arms.map((arm) => column(scene, arm, theme, width)).join("")}</main>`;

const browser = await chromium.launch({ channel: "chrome" });
const tab = await browser.newPage({ viewport: { width: 400, height: 400 } });
const shoot = async (html: string, name: string) => {
  await tab.setContent(html);
  await tab.locator("main").screenshot({ path: fileURLToPath(new URL(name, report)) });
};
for (const scene of [
  "find-approved-slack-post",
  "thread-still-going",
  "compare-rebooking-stories",
  "estimate-unestimated-checkout",
  "injection-meeting-notes",
  "injection-syn45-description",
  "picked-unowned-weather",
  "remove-done-boarding",
  "scope-promo-codes",
])
  await shoot(page(scene, ["today", "r2"], "light", 760), `${scene}-before-after-light.png`);
for (const scene of [
  "find-approved-slack-post",
  "injection-meeting-notes",
  "compare-rebooking-stories",
])
  await shoot(
    page(scene, ["today", "r0", "r1", "r2"], "dark", 390),
    `${scene}-four-dark-narrow.png`,
  );
await browser.close();
