// Oriel can't read the account setting that allows training, so the line says "may" and never
// says training is off.
import type { CliView } from "./view.ts";

export type TrainingNotice = { vendor: string; page: string };

const notices = {
  "claude-code": { vendor: "Anthropic", page: "https://claude.ai/settings/data-privacy-controls" },
  codex: { vendor: "OpenAI", page: "https://chatgpt.com/#settings/DataControls" },
} as const;

export function trainingNotice(
  cli: keyof typeof notices,
  view: Pick<CliView, "state" | "account">,
): TrainingNotice | null {
  return view.state === "ready" && view.account?.personal ? notices[cli] : null;
}
