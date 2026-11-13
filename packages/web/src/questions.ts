// Here, not in @oriel/core: the page loads nothing from core at run time.
import type { StartQuestion } from "@oriel/core/window-chat";

export const planQuestion = "Draft a small launch plan: one epic and a few stories I can edit";

// `short` sits beside its headline, so it names nothing the headline names.
const words: Record<StartQuestion, { label: (name: string) => string; short: string } | null> = {
  "chart-moved": {
    label: () => "Chart what moved since I looked, by workstream",
    short: "Chart what moved",
  },
  "moved-most": { label: (name) => `What moved in ${name}?`, short: "What moved in it?" },
  stalled: { label: (name) => `Why is ${name} stalled?`, short: "Why is it stalled?" },
  candidates: {
    label: (name) => `Should ${name} become a workstream?`,
    short: "Should it become a workstream?",
  },
  "make-candidate": { label: (name) => `Make ${name} a workstream`, short: "Make it a workstream" },
  plan: { label: () => planQuestion, short: planQuestion },
  noticed: null,
};

export const questionLabel = (kind: StartQuestion, name: string): string | null =>
  words[kind]?.label(name) ?? null;

export const questionShort = (kind: StartQuestion): string => words[kind]?.short ?? "";

export const aboutWorkstream: readonly StartQuestion[] = ["moved-most", "stalled"];
export const aboutItem: readonly StartQuestion[] = ["candidates", "make-candidate"];
