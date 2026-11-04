// The system prompts a Noticed climb tries, by name. `v1` is the product's
// own (`noticedPrompt`); each later one is one change, as the climb's plan
// lists them.
import { noticedPrompt } from "@oriel/agent";

export const prompts: Readonly<Record<string, string>> = {
  v1: noticedPrompt,
};
