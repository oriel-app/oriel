/// <reference lib="dom" />
// Spike: TASKS.md's measured scores for one candidate, and the screenshots its
// judges see. Drives the installed Chrome at 4× CPU throttle.
//
// node scripts/explore/measure.ts <design> [--out /tmp/wx] [--scales large,medium]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { type Design, designs, type Steps, type TaskId } from "./designs.ts";
import { startExplore } from "./serve.ts";
import { type Scale, truth, type Truth } from "./world.ts";

export const widths = { laptop: 1280, narrow: 600 } as const;
export type Width = keyof typeof widths;
const height = 800;
const tasks: TaskId[] = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
const judged: TaskId[] = ["t1", "t2", "t3", "t4", "t6", "t7"];

// What must be on screen, together, for each task's answer to count as shown.
type Want = { all: string[]; near?: { re: string; max: number } };
export function wants(task: TaskId, t: Truth): Want | null {
  switch (task) {
    case "t1":
      return t.t1.oldest[0]
        ? {
            all: [t.t1.oldest[0]],
            near: {
              re: `\\b${t.t1.count}\\b[^]{0,40}(need|wait)|(need|wait)[^]{0,40}\\b${t.t1.count}\\b`,
              max: 120,
            },
          }
        : null;
    case "t2":
      return t.t2.workstreams[0] ? { all: [t.t2.workstreams[0], `${t.t2.count}`] } : null;
    case "t3":
      return t.t3.workstreams[0] ? { all: [t.t3.workstreams[0], `${t.t3.days}`] } : null;
    case "t4":
      return t.t4.names[0] ? { all: [t.t4.names[0]] } : null;
    case "t5":
      return { all: [t.t5.key, t.t5.status, ...(t.t5.workstream ? [t.t5.workstream] : [])] };
    case "t6":
      return { all: [t.t6.person, `${t.t6.count}`] };
    case "t7":
      return t.t7.keys[0] ? { all: [t.t7.keys[0], `${t.t7.count}`] } : null;
  }
}

// Whether an element of at most 400 characters inside the viewport holds
// every wanted string, and, when asked, another short one matches `near`.
async function shown(page: Page, want: Want, scrollTo = false): Promise<boolean> {
  return page.evaluate(
    ({ want, scrollTo }) => {
      const lower = want.all.map((s) => s.toLowerCase());
      const inView = (el: Element) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          r.bottom > 0 &&
          r.top < innerHeight &&
          r.right > 0 &&
          r.left < innerWidth
        );
      };
      const visible = (el: Element) => {
        const style = getComputedStyle(el);
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          (el as HTMLElement).offsetParent !== null
        );
      };
      const find = (test: (text: string) => boolean, max: number) => {
        let best: Element | null = null;
        for (const el of document.querySelectorAll("body *")) {
          const text = (el.textContent ?? "").toLowerCase();
          if (text.length > max || !test(text) || !visible(el)) continue;
          if (!best || (best.textContent ?? "").length > text.length) best = el;
        }
        return best;
      };
      const main = find((text) => lower.every((s) => text.includes(s)), 400);
      const near = want.near
        ? find((text) => new RegExp(want.near!.re, "i").test(text), want.near.max)
        : null;
      if (scrollTo) {
        main?.scrollIntoView({ block: "center" });
        return main !== null && (!want.near || near !== null);
      }
      return main !== null && inView(main) && (!want.near || (near !== null && inView(near)));
    },
    { want, scrollTo },
  );
}

async function open(browser: Browser, url: string, width: number, throttle: boolean) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  if (throttle) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  return { context, page };
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

export type Measured = {
  ttfup: number;
  dom: number;
  screens: number;
  visible: number;
  visibleTasks: TaskId[];
  steps: Partial<Record<TaskId, number | null>>;
};

export async function measure(
  browser: Browser,
  design: Design,
  base: string,
  t: Truth,
  world: Awaited<ReturnType<typeof startExplore>>["world"],
  width: Width,
  shots: string | null,
): Promise<Measured> {
  const url = `${base}/${design.query ? `?${design.query}` : ""}`;
  // Time to first useful paint: three loads, the median.
  const times: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const { context, page } = await open(browser, url, widths[width], true);
    await page.addInitScript((selector: string) => {
      const w = window as unknown as { __useful?: number };
      const look = () => {
        if (w.__useful === undefined && document.querySelector(selector))
          requestAnimationFrame(() => {
            w.__useful ??= performance.now();
          });
      };
      new MutationObserver(look).observe(document, { childList: true, subtree: true });
    }, design.useful);
    await page.goto(url);
    await page.waitForFunction(
      () => (window as unknown as { __useful?: number }).__useful !== undefined,
      null,
      { timeout: 60_000 },
    );
    times.push(await page.evaluate(() => (window as unknown as { __useful: number }).__useful));
    await context.close();
  }
  const ttfup = Math.round(times.toSorted((a, b) => a - b)[1] ?? 0);
  // The page as loaded, unthrottled.
  const { context, page } = await open(browser, url, widths[width], false);
  await page.goto(url);
  await page.waitForSelector(design.useful);
  await settle(page);
  const dom = await page.evaluate(() => document.querySelectorAll("*").length);
  const screens = await page.evaluate(() => document.documentElement.scrollHeight / innerHeight);
  const visibleTasks: TaskId[] = [];
  for (const task of judged) {
    const want = wants(task, t);
    if (want && (await shown(page, want))) visibleTasks.push(task);
  }
  if (shots) {
    for (let i = 0; i < 4; i += 1) {
      await page.evaluate((y) => scrollTo(0, y), i * (height - 60));
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${shots}-${i + 1}.png` });
      const end = await page.evaluate(
        () => scrollY + innerHeight >= document.documentElement.scrollHeight - 2,
      );
      if (end) break;
    }
  }
  await context.close();
  // Each task's path, from a fresh load.
  const steps: Measured["steps"] = {};
  for (const task of tasks) {
    const path = design.paths[task];
    const want = wants(task, t);
    if (path === null || want === null) {
      steps[task] = null;
      continue;
    }
    const { context, page } = await open(browser, url, widths[width], false);
    await page.goto(url);
    await page.waitForSelector(design.useful);
    await settle(page);
    let count = 0;
    const at = (target: Locator | string) =>
      typeof target === "string" ? page.locator(target).first() : target;
    const s: Steps = {
      page,
      narrow: width === "narrow",
      truth: t,
      world,
      click: async (target) => {
        count += 1;
        await at(target).click({ timeout: 5000 });
        await settle(page);
      },
      type: async (target, text) => {
        count += 1;
        await at(target).click({ timeout: 5000 });
        await at(target).fill(text);
        await page.waitForTimeout(400);
        await settle(page);
      },
      press: async (key) => {
        count += 1;
        await page.keyboard.press(key);
        await settle(page);
      },
    };
    try {
      await path(s);
      if (!(await shown(page, want))) {
        // One scroll to it, if it is on the page at all.
        if (await shown(page, want, true)) {
          count += 1;
          await page.waitForTimeout(150);
        }
        steps[task] = (await shown(page, want)) ? count : null;
      } else steps[task] = count;
    } catch (error) {
      console.error(`${design.id} ${task} ${width}:`, (error as Error).message.split("\n")[0]);
      steps[task] = null;
    }
    await context.close();
  }
  return {
    ttfup,
    dom,
    screens: Math.round(screens * 10) / 10,
    visible: visibleTasks.length,
    visibleTasks,
    steps,
  };
}

export async function measureDesign(id: string, out: string, scales: Scale[]) {
  const design = designs[id];
  if (!design) throw new Error(`no design ${id}`);
  const browser = await chromium.launch({ channel: "chrome" });
  const results: Record<string, Measured> = {};
  let port = 4391;
  for (const scale of scales) {
    for (const width of Object.keys(widths) as Width[]) {
      // A fresh world per run: T4's path makes a workstream.
      const serving = await startExplore(scale, port++);
      const t = truth(serving.world);
      const dir = `${out}/${id}`;
      mkdirSync(dir, { recursive: true });
      const m = await measure(
        browser,
        design,
        serving.url,
        t,
        serving.world,
        width,
        `${dir}/${scale}-${width}`,
      );
      results[`${scale}-${width}`] = m;
      console.log(id, scale, width, JSON.stringify(m));
      await serving.close();
    }
  }
  await browser.close();
  writeFileSync(`${out}/${id}/measured.json`, `${JSON.stringify(results, null, 1)}\n`);
  return results;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", default: "/tmp/wx" },
      scales: { type: "string", default: "fixtures,medium,large" },
    },
  });
  for (const id of positionals)
    await measureDesign(id, values.out, values.scales.split(",") as Scale[]);
}
