// Whether a CLI's row says its vendor may train on the person's chats, and
// where the person checks (OA-226). Only a personal plan can be trained on,
// and only if the person allowed it, in a setting on their account that
// Oriel can't read. So the line says "may", points at that setting, and
// never says training is off. No line for an API key or a Team, Business,
// Enterprise or Edu plan.
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
