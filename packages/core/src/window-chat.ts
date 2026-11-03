// The window chat's questions to start from (decision 0030): a few offered
// under the ask bar, each computed from the overview, never generated. Each
// is one of these kinds, which telemetry counts by.
export const startQuestions = ["chart-moved", "moved-most", "stalled", "candidates"] as const;
export type StartQuestion = (typeof startQuestions)[number];
