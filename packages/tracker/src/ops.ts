import { array, number, refine, shortText, string } from "@oriel/core";
import { isStatusName, statusNames } from "./issues.ts";

export const maxSummary = 255;
export const maxDescription = 32_767;
export const maxName = 120;
export const maxLabel = 60;
export const maxLabels = 20;

export const summary = shortText(maxSummary, "a summary");
export const description = refine(
  string,
  (text) => [...text].length <= maxDescription,
  `expected at most ${maxDescription} characters`,
);
export const personName = shortText(maxName, "a name");
export const label = refine(
  shortText(maxLabel, "a label"),
  (text) => !/\s/.test(text),
  "expected a label with no spaces",
);
export const labels = refine(
  array(label),
  (list) => list.length <= maxLabels && new Set(list).size === list.length,
  `expected at most ${maxLabels} labels, each once`,
);
export const points = refine(
  number,
  (n) => Number.isFinite(n) && n >= 0 && n <= 1000,
  "expected points from 0 to 1000",
);
export const status = refine(
  string,
  isStatusName,
  `expected one of ${statusNames.map((name) => JSON.stringify(name)).join(", ")}`,
);
