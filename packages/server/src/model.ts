// Which model the agent and thread titles run on (decision 0037). With an API
// key, the Messages API, as before. Without one, the person's own Claude Code
// when a supported one is installed and signed in. Otherwise no model: each
// turn says how to set one up, naming no credential. A settings page (OA-181)
// will pass the person's choice as `prefer`; today nothing does.
import {
  agent,
  anthropicProvider,
  anthropicTitler,
  checkClaudeCode,
  type CheckOptions,
  type ClaudeCode,
  claudeCodeProvider,
  claudeCodeTitler,
  defaultModel,
  type HarnessProblem,
  titleModel,
} from "@oriel/agent";
import type { Agent, ServerAgentDeps } from "./agent.ts";
import type { AppOptions } from "./app.ts";

export type ModelChoice =
  | { kind: "api"; key: string }
  | { kind: "claude-code"; cli: ClaudeCode }
  | { kind: "none"; problem: HarnessProblem };

export type ChooseOptions = {
  // ANTHROPIC_API_KEY from `.env`, or null.
  key: string | null;
  // The person's pick, once a settings page offers one. Without it, the key
  // wins.
  prefer?: "api" | "claude-code";
  claudeCode?: CheckOptions;
  // Stands in for the CLI check in tests.
  check?: typeof checkClaudeCode;
};

export async function chooseModel(options: ChooseOptions): Promise<ModelChoice> {
  const { key } = options;
  if (key && options.prefer !== "claude-code") return { kind: "api", key };
  const found = await (options.check ?? checkClaudeCode)(options.claudeCode);
  if (found.ok) return { kind: "claude-code", cli: found.cli };
  if (key) return { kind: "api", key };
  return { kind: "none", problem: found.problem };
}

// A turn with no model to run it: it says why and how to set one up.
export function setupAgent(problem: HarnessProblem): Agent {
  return {
    async *turn() {
      yield { kind: "error", message: problem.message };
      yield { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

// What the server is built with for a choice, and the line it prints.
export function modelOptions(
  choice: ModelChoice,
): Pick<AppOptions, "agent" | "titler"> & { describe: string } {
  if (choice.kind === "api") {
    const apiKey = choice.key;
    return {
      agent: (deps: ServerAgentDeps) => agent({ ...deps, provider: anthropicProvider({ apiKey }) }),
      titler: anthropicTitler({ apiKey }),
      describe: `Agent: the model-backed agent (${defaultModel}), with the model key from .env. Thread titles: ${titleModel}.`,
    };
  }
  if (choice.kind === "claude-code") {
    const { cli } = choice;
    return {
      agent: (deps: ServerAgentDeps) => agent({ ...deps, provider: claudeCodeProvider({ cli }) }),
      titler: claudeCodeTitler({ cli }),
      describe: `Agent: ${defaultModel} through Claude Code ${cli.version} at ${cli.path}, on its own sign-in. Thread titles: ${titleModel}, the same way.`,
    };
  }
  return {
    agent: () => setupAgent(choice.problem),
    describe: `Agent: none. ${choice.problem.message} Or set ANTHROPIC_API_KEY in .env, or pass --agent scripted for the scripted agent.`,
  };
}
