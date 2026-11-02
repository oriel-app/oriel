// Spike: each candidate the hill-climb scores. A candidate is a design id the
// web app reads from `?design=` (none for today's window), the element whose
// paint counts as useful, and its scripted path for each task: the clicks and
// typed strings that get the answer on screen, or null for no path.
import type { Locator, Page } from "playwright-core";
import type { Truth, World } from "./world.ts";

export type Steps = {
  page: Page;
  narrow: boolean;
  truth: Truth;
  world: World;
  click(target: Locator | string): Promise<void>;
  type(target: Locator | string, text: string): Promise<void>;
  press(key: string): Promise<void>;
};
export type TaskId = "t1" | "t2" | "t3" | "t4" | "t5" | "t6" | "t7";
export type Path = ((s: Steps) => Promise<void>) | null;
export type Design = {
  id: string;
  // The query that selects it; empty for today's window.
  query: string;
  useful: string;
  paths: Record<TaskId, Path>;
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
