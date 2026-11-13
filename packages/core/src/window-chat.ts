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
