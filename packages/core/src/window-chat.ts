// The window chat's questions to start from (decision 0030): a few offered
// under the ask bar, each computed from the overview, never generated. Each
// is one of these kinds, which telemetry counts by. `make-candidate` is the
// first run's instruction to make the top candidate a workstream (decision
// 0038), in place of asking whether it should become one. `noticed` is a
// Noticed card's Ask about this (decision 0052). `plan` asks for a plan to
// draft into the stand-in tracker, while it's on and the window holds
// nothing yet (decision 0059).
export const startQuestions = [
  "chart-moved",
  "moved-most",
  "stalled",
  "candidates",
  "make-candidate",
  "noticed",
  "plan",
] as const;
export type StartQuestion = (typeof startQuestions)[number];
