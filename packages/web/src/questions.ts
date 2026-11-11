// Here, not in @oriel/core: the page loads nothing from core at run time.
import type { StartQuestion } from "@oriel/core/window-chat";

export const planQuestion = "Draft a small launch plan: one epic and a few stories I can edit";

export function questionLabel(kind: StartQuestion, name: string): string | null {
  switch (kind) {
    case "chart-moved":
      return "Chart what moved since I looked, by workstream";
    case "moved-most":
      return `What moved in ${name}?`;
    case "stalled":
      return `Why is ${name} stalled?`;
    case "candidates":
      return `Should ${name} become a workstream?`;
    case "make-candidate":
      return `Make ${name} a workstream`;
    case "plan":
      return planQuestion;
    case "noticed":
      return null;
  }
}

export const aboutWorkstream: readonly StartQuestion[] = ["moved-most", "stalled"];
export const aboutItem: readonly StartQuestion[] = ["candidates", "make-candidate"];
