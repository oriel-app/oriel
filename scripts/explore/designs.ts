// Spike: each candidate the hill-climb scores. A candidate is a design id the
// web app reads from `?design=` (none for today's window), the element whose
// paint counts as useful, and its scripted path for each task: the clicks and
// typed strings that get the answer on screen, or null for no path.
import type { Locator, Page } from "playwright-core";
import type { AskTruth } from "./ask.ts";
import type { Truth, World } from "./world.ts";

export type Steps = {
  page: Page;
  narrow: boolean;
  truth: Truth;
  ask: AskTruth;
  world: World;
  click(target: Locator | string): Promise<void>;
  type(target: Locator | string, text: string): Promise<void>;
  press(key: string): Promise<void>;
};
export type TaskId = "t1" | "t2" | "t3" | "t4" | "t5" | "t6" | "t7";
// TASKS2.md's asking tasks; A3 runs last, since making a workstream moves others' counts.
export type AskId = "a1" | "a2" | "a4" | "a5" | "a3";
export const askIds: AskId[] = ["a1", "a2", "a4", "a5", "a3"];
export type Path = ((s: Steps) => Promise<void>) | null;
export type Design = {
  id: string;
  // The query that selects it; empty for today's window.
  query: string;
  useful: string;
  paths: Record<TaskId, Path>;
  // Rounds 10 on: the asking tasks' paths, and where to ask.
  asks?: Record<AskId, Path>;
  askAt?: string;
};

const drawer = async (s: Steps) => {
  if (s.narrow) await s.click(".bar-menu");
};

// Today's window (round 0).
const today: Design = {
  id: "0",
  query: "",
  useful: ".cluster",
  paths: {
    // Needs you lists the newest first, eight of them; the rest behind "N more".
    t1: async (s) => {
      await drawer(s);
      const more = s.page.locator("#sidebar .nav-more").first();
      if (await more.isVisible()) await s.click(more);
    },
    t2: null,
    t3: null,
    t4: null,
    t5: null,
    t6: null,
    t7: null,
  },
};

// The overview designs share their paths: each section has the same roles.
const overviewPaths = (opts: { needsDrawer?: boolean } = {}): Design["paths"] => ({
  t1: async (s) => {
    if (opts.needsDrawer) await drawer(s);
    const more = s.page.locator("[data-section=needs] [data-more]");
    if ((await more.count()) > 0) await s.click(more.first());
  },
  t2: async () => {},
  t3: async () => {},
  t4: async (s) => {
    await s.click(s.page.locator("[data-section=candidates] [data-make]").first());
  },
  t5: async (s) => {
    if (!(await s.page.locator("[data-find]").first().isVisible())) await s.click("[data-browse]");
    await s.type("[data-find]", s.truth.t5.key);
  },
  t6: async (s) => {
    const row = s.page.locator("[data-section=people] [data-person]", {
      hasText: s.truth.t6.person,
    });
    if ((await row.count()) === 0 || !(await row.first().isVisible())) {
      await s.click(s.page.locator("[data-section=people] [data-more]").first());
    }
    const again = s.page.locator("[data-person]", { hasText: s.truth.t6.person });
    if ((await again.first().getAttribute("data-open")) === null) await s.click(again.first());
  },
  t7: async () => {},
});

export const designs: Record<string, Design> = {
  "0": today,
};

export function register(design: Omit<Design, "paths"> & { paths?: Design["paths"] }) {
  designs[design.id] = { ...design, paths: design.paths ?? overviewPaths() };
}

const asked = {
  a1: "Which sources changed most since I looked?",
  a2: "Chart what moved since I looked, by workstream",
  a5: "Why is it stalled?",
};

// Typing the question and Enter; or, with `suggest`, its suggestion when one is shown.
const askPaths = (opts: { suggest?: boolean } = {}): Record<AskId, Path> => {
  const ask = async (s: Steps, q: string) => {
    const chip = s.page.locator("[data-suggest]", { hasText: q });
    if (opts.suggest && (await chip.count()) > 0 && (await chip.first().isVisible())) {
      await s.click(chip.first());
      return;
    }
    await s.type("[data-ask-input]", q);
    await s.press("Enter");
  };
  return {
    a1: (s) => ask(s, asked.a1),
    a2: (s) => ask(s, asked.a2),
    a4: async (s) => {
      await ask(s, asked.a2);
      await s.click(s.page.locator("[data-pin]").last());
    },
    a5: async (s) => {
      const row = s.page.locator(`[data-workstream="${s.ask.a5.workstream}"]`).first();
      await row.hover();
      await s.click(row.locator("[data-cite]"));
      const chip = s.page.locator("[data-suggest]", { hasText: "happening" });
      if (opts.suggest && (await chip.count()) > 0) {
        await s.click(chip.first());
        return;
      }
      await s.type("[data-ask-input]", asked.a5);
      await s.press("Enter");
    },
    a3: (s) => s.click(s.page.locator("[data-section=candidates] [data-make]").first()),
  };
};

// Round 1: 0027's overview as written.
register({ id: "r1", query: "design=r1", useful: "[data-useful]" });

// Round 2: denser. A line per workstream, two columns.
register({ id: "r2", query: "design=r2", useful: "[data-useful]" });

// Round 3: R2 with a band of headlines.
register({ id: "r3", query: "design=r3", useful: "[data-useful]" });

// Round 4: R3 with everyone in progress beside the workstreams.
register({ id: "r4", query: "design=r4", useful: "[data-useful]" });

// Round 5: R4 with the narrow roster as tokens.
register({ id: "r5", query: "design=r5", useful: "[data-useful]" });

// Round 6: R5 with the workstream list capped at 8, plus any stalled one.
register({ id: "r6", query: "design=r6", useful: "[data-useful]" });

// Round 7: R6 without headlines; flags on rows instead.
register({ id: "r7", query: "design=r7", useful: "[data-useful]" });

// Round 8: R6 calmer: Needs you first, four headlines, no sidebar Needs you here.
register({ id: "r8", query: "design=r8", useful: "[data-useful]" });

// Round 9: R8 with candidates as one-line rows under their rule.
register({ id: "r9", query: "design=r9", useful: "[data-useful]" });
// Round 9 as the baseline for rounds 10 on: no chat, so only A3 has a path.
designs["r9"] = {
  ...designs["r9"]!,
  asks: { a1: null, a2: null, a4: null, a5: null, a3: askPaths().a3 },
  askAt: "[data-ask-input]",
};

// Round 10: 0027's window chat as written, a rail beside the overview.
register({ id: "r10", query: "design=r10", useful: "[data-useful]" });
designs["r10"]!.asks = askPaths();
designs["r10"]!.askAt = "[data-ask-input]";

// Round 11: an ask bar at the top; answers in a panel only while asking.
register({ id: "r11", query: "design=r11", useful: "[data-useful]" });
designs["r11"]!.asks = askPaths();
designs["r11"]!.askAt = "[data-ask-input]";

// Round 12: answers in place under the ask bar; pins keep their form.
register({ id: "r12", query: "design=r12", useful: "[data-useful]" });
designs["r12"]!.asks = askPaths();
designs["r12"]!.askAt = "[data-ask-input]";

// Round 13: round 11 with suggestions, a compact pinned strip, narrow roster with workstreams.
register({ id: "r13", query: "design=r13", useful: "[data-useful]" });
designs["r13"]!.asks = askPaths({ suggest: true });
designs["r13"]!.askAt = "[data-ask-input]";

// Round 14: round 13, and a cited row offers questions about itself.
register({ id: "r14", query: "design=r14", useful: "[data-useful]" });
designs["r14"]!.asks = askPaths({ suggest: true });
designs["r14"]!.askAt = "[data-ask-input]";
