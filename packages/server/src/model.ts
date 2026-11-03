// Which model the agent and thread titles run on (decisions 0037 and 0041).
// Oriel looks for each provider instance Settings lists: an API key, in
// `.env` or, on the desktop app, in the OS secret store, the person's own
// Claude Code, installed, a supported version and
// signed in, and Codex, which it can't run on yet, so it's only looked for
// on the PATH and never run (decision 0040). Each turn and each title
// then runs on the provider and model Settings pick, among those found and
// turned on, so a change in Settings applies at the next turn. With no pick,
// the key wins, then Claude Code, as before Settings. With none, each turn
// says how to set one up, naming no credential.
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
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
  type Provider,
  type Titler,
  titleModel,
} from "@oriel/agent";
import type { ModelOptionView, ModelPick, ProviderStatus, ProviderView } from "@oriel/web/view";
import type { Agent, ServerAgentDeps } from "./agent.ts";
import type { ProviderSetting, Settings } from "./settings.ts";

// The models a Claude provider offers, by the API's IDs, the largest first.
export const claudeModels: readonly { id: string; label: string }[] = [
  { id: defaultModel, label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: titleModel, label: "Haiku 5.5" },
];

// What Oriel found for one instance when it last looked.
export type Found =
  | { status: "ready"; cli: ClaudeCode | null }
  | { status: Exclude<ProviderStatus, "ready">; problem?: HarnessProblem };

// What runs a turn or a title: an instance found ready and turned on, and
// one of its models.
export type Running = { provider: ProviderSetting; model: string; cli: ClaudeCode | null };

export type Choice = { model: Running | null; title: Running | null; problem: string };

export type ModelsOptions = {
  // ANTHROPIC_API_KEY from `.env`, or null.
  key: string | null;
  // On the desktop app, the key kept in the OS secret store, which Settings
  // can change, in place of `.env`'s. Each look reads it again.
  kept?: { get(): Promise<string | null> };
  // `--claude-code <path>`; a path set in Settings wins.
  claudeCodePath?: string;
  // The environment the CLIs are found in. Default `process.env`.
  env?: Readonly<Record<string, string | undefined>>;
  // Stand in for the CLI check and the providers in tests.
  check?: (options: CheckOptions) => ReturnType<typeof checkClaudeCode>;
  provider?: (running: Running, key: string | null) => Provider;
  titler?: (running: Running, key: string | null) => Titler;
};

export type Models = {
  // Looks for every instance again, the CLIs' checks included.
  look(settings: Settings): Promise<void>;
  // What was found for an instance; "checking" until the first look ends.
  found(id: string): Found;
  choose(settings: Settings): Choice;
  // The agent and the titler, each choosing again at every turn and title.
  agent(settings: () => Settings, deps: ServerAgentDeps): Agent;
  titler(settings: () => Settings): Titler;
  // The models the default and Title model can be, from instances found
  // ready and turned on.
  options(settings: Settings): ModelOptionView[];
  providers(settings: Settings): ProviderView[];
  // The line the server prints at startup.
  describe(settings: Settings): string;
};

const checking: Found = { status: "checking" };

// An executable called `name` on `env`'s PATH.
function onPath(name: string, env: Readonly<Record<string, string | undefined>>): boolean {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean))
    for (const file of names)
      try {
        accessSync(join(dir, file), constants.X_OK);
        if (statSync(join(dir, file)).isFile()) return true;
      } catch {
        // Not here.
      }
  return false;
}

// Why Codex, when it's the only CLI found, can't run the agent (decision
// 0040). Oriel only looks for it; it never runs it.
export const codexNotYet =
  "Oriel can't run on Codex yet, because Codex can't be limited to Oriel's one tool. Install Claude Code and sign in to it, or add an API key.";

// A turn with no model to run it: it says why and how to set one up.
export function setupAgent(message: string): Agent {
  return {
    async *turn() {
      yield { kind: "error", message };
      yield { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

const ready = (found: Found): found is Extract<Found, { status: "ready" }> =>
  found.status === "ready";

export function models(options: ModelsOptions): Models {
  const env = options.env ?? process.env;
  const check = options.check ?? checkClaudeCode;
  const { kept } = options;
  // Where the key comes from, for the words a row and the server's line use.
  const where = kept ? "store" : "env";
  let key = kept ? null : options.key;
  let found = new Map<string, Found>();
  // Agents and titlers by instance, model and CLI, built once each.
  const agents = new Map<string, Agent>();
  const titlers = new Map<string, Titler>();
  const cacheKey = (r: Running) => JSON.stringify([r.provider.id, r.model, r.cli]);
  // Only the latest look's answers stand.
  let looks = 0;

  const providerOf =
    options.provider ??
    ((r: Running, apiKey: string | null): Provider =>
      r.cli
        ? claudeCodeProvider({ cli: r.cli, model: r.model })
        : anthropicProvider({ apiKey: apiKey ?? "", model: r.model }));
  const titlerOf =
    options.titler ??
    ((r: Running, apiKey: string | null): Titler =>
      r.cli
        ? claudeCodeTitler({ cli: r.cli, model: r.model })
        : anthropicTitler({ apiKey: apiKey ?? "", model: r.model }));

  async function lookFor(provider: ProviderSetting, key: string | null): Promise<Found> {
    if (provider.kind === "api") return key ? { status: "ready", cli: null } : { status: "no-key" };
    if (provider.kind === "codex")
      return onPath("codex", env) ? { status: "not-yet" } : { status: "missing" };
    const path = provider.path ?? options.claudeCodePath;
    const result = await check({ env, ...(path ? { path } : {}) });
    return result.ok
      ? { status: "ready", cli: result.cli }
      : { status: result.problem.kind, problem: result.problem };
  }

  const foundOf = (id: string) => found.get(id) ?? checking;
  const usable = (settings: Settings) =>
    settings.providers.filter((p) => p.on && ready(foundOf(p.id)));

  // The pick, if its instance is usable and offers its model; else the
  // first usable instance, the key first, with `fallback`.
  function running(settings: Settings, pick: ModelPick | null, fallback: string): Running | null {
    const list = usable(settings);
    const offered = (model: string) => claudeModels.some((m) => m.id === model);
    const picked = pick && list.find((p) => p.id === pick.provider);
    const [provider, model] =
      picked && offered(pick.model)
        ? [picked, pick.model]
        : [list.find((p) => p.kind === "api") ?? list[0], fallback];
    if (!provider) return null;
    const at = foundOf(provider.id);
    return { provider, model, cli: ready(at) ? at.cli : null };
  }

  function choose(settings: Settings): Choice {
    const model = running(settings, settings.model, defaultModel);
    // Titles follow the default model's provider until the person picks.
    const title = running(
      settings,
      settings.titleModel ?? (model && { provider: model.provider.id, model: titleModel }),
      titleModel,
    );
    return { model, title, problem: model ? "" : problemOf(settings) };
  }

  // Why no model runs, and what to do, for a turn.
  function problemOf(settings: Settings): string {
    const claude = settings.providers.find((p) => p.kind === "claude-code");
    const claudeFound = claude ? foundOf(claude.id) : checking;
    if (settings.providers.some((p) => !p.on && ready(foundOf(p.id))))
      return "Every provider Oriel can use is turned off. Turn one on in Settings.";
    if (claudeFound.status === "checking")
      return "Oriel is still looking for Claude Code. Try again in a moment.";
    if (
      claudeFound.status === "missing" &&
      settings.providers.some((p) => foundOf(p.id).status === "not-yet")
    )
      return codexNotYet;
    if ("problem" in claudeFound && claudeFound.problem) return claudeFound.problem.message;
    return "Oriel has no model to run on. Open Settings to set one up.";
  }

  const label = (model: string) => claudeModels.find((m) => m.id === model)?.label ?? model;

  return {
    async look(settings) {
      const look = ++looks;
      found = new Map(settings.providers.map((p) => [p.id, found.get(p.id) ?? checking]));
      const keyNow = kept ? await kept.get() : key;
      const answers = await Promise.all(
        settings.providers.map(async (p) => [p.id, await lookFor(p, keyNow)] as const),
      );
      if (look !== looks) return;
      key = keyNow;
      found = new Map(answers);
      agents.clear();
      titlers.clear();
    },
    found: foundOf,
    choose,
    agent(settings, deps) {
      return {
        turn(input, turnOptions) {
          const { model, problem } = choose(settings());
          if (!model) return setupAgent(problem).turn(input, turnOptions);
          const id = cacheKey(model);
          let built = agents.get(id);
          if (!built) {
            built = agent({ ...deps, provider: providerOf(model, key) });
            agents.set(id, built);
          }
          return built.turn(input, turnOptions);
        },
      };
    },
    titler(settings) {
      return (text, titleOptions) => {
        const { title } = choose(settings());
        if (!title) return Promise.reject(new Error("No model is on to write titles."));
        const id = cacheKey(title);
        let built = titlers.get(id);
        if (!built) {
          built = titlerOf(title, key);
          titlers.set(id, built);
        }
        return built(text, titleOptions);
      };
    },
    options(settings) {
      return usable(settings).flatMap((provider) =>
        claudeModels.map((m) => ({
          provider: provider.id,
          model: m.id,
          label: `${m.label} · ${provider.name}`,
        })),
      );
    },
    providers(settings) {
      const { model, title } = choose(settings);
      return settings.providers.flatMap((provider): ProviderView[] => {
        const at = foundOf(provider.id);
        // Codex shows only once it's installed: there's nothing to set up.
        if (provider.kind === "codex" && at.status === "missing") return [];
        return [
          {
            id: provider.id,
            kind: provider.kind,
            name: provider.name,
            on: provider.on,
            status: at.status,
            detail: detailOf(provider, at, where),
            version: ready(at) ? (at.cli?.version ?? null) : null,
            path: provider.path ?? null,
            uses: {
              model: model?.provider.id === provider.id ? label(model.model) : null,
              title: title?.provider.id === provider.id ? label(title.model) : null,
            },
          },
        ];
      });
    },
    describe(settings) {
      const { model, title, problem } = choose(settings);
      if (!model) return `Agent: none. ${problem}`;
      const how = (r: Running) =>
        r.cli
          ? `${label(r.model)} through Claude Code ${r.cli.version} at ${r.cli.path}, on its own sign-in`
          : `${label(r.model)} with ${where === "store" ? "the API key in the OS secret store" : "the model key from .env"}`;
      return `Agent: ${how(model)}. Thread titles: ${title ? how(title) : "the first message, clipped"}.`;
    },
  };
}

// What a row says was found, in the person's words. Never a key. The
// CLI's own problems say to restart Oriel; Settings can check again instead.
function detailOf(provider: ProviderSetting, found: Found, where: "env" | "store"): string {
  if ("problem" in found && found.problem)
    return found.problem.message
      .replace("then restart Oriel.", "then check again.")
      .replace("Restart Oriel to try again.", "Check again to try once more.");
  switch (found.status) {
    case "ready":
      if (found.cli) return `Signed in · version ${found.cli.version}`;
      return where === "store" ? "A key is kept in the OS secret store" : "A key is set in .env";
    case "checking":
      return "Checking…";
    case "no-key":
      return where === "store"
        ? "No key is set. Paste one from Anthropic's console to pay per question."
        : "No key is set. Add ANTHROPIC_API_KEY to .env, then restart Oriel.";
    case "not-yet":
      return codexNotYet;
    default:
      return provider.kind === "codex" ? "Not installed." : "Not found.";
  }
}
