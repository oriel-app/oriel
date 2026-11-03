// The window chat's questions to start from (decision 0030): a few offered
// under the ask bar, each computed from the overview, never generated. Each
// is one of these kinds, which telemetry counts by. `make-candidate` is the
// first run's instruction to make the top candidate a workstream (decision
// 0038), in place of asking whether it should become one.
export const startQuestions = [
  "chart-moved",
  "moved-most",
  "stalled",
  "candidates",
  "make-candidate",
] as const;
export type StartQuestion = (typeof startQuestions)[number];
