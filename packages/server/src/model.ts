// There is no API-key way in: `.env`'s key is an instance only under `pnpm dev --agent api`.
import {
  agent,
  anthropicProvider,
  anthropicTitler,
  checkClaudeCode,
  type CalledServer,
  checkCodex,
  type CheckOptions,
  type ClaudeCode,
  claudeCodePlan,
  claudeCodeProvider,
  claudeCodeServerCalls,
  claudeCodeServers,
  claudeCodeTitler,
  type CodexAccount,
  type CodexModel,
  codexPlan,
  codexProvider,
  codexServerCalls,
  codexServers,
  codexTitler,
  defaultModel,
  type DevServer,
  type Effort,
  type HarnessProblem,
  locateClaudeCode,
  locateCodex,
  type PlanUsage,
  type Provider,
  type ServerCalls,
  type ServerCallsOptions,
  type Titler,
  titleModel,
  type Usage,
} from "@oriel/agent";
import type {
  ModelOptionView,
  ModelPick,
  ProviderStatus,
  ProviderView,
  UsageView,
} from "@oriel/web/view";
import type { FoundServer, Log } from "@oriel/core";
import type { Agent, ServerAgentDeps } from "./agent.ts";
import type { Discovery } from "./source-servers.ts";
import type { ProviderSetting, Settings } from "./settings.ts";
import { memoryUsage, type UsageCounts } from "./usage.ts";

export const claudeModels: readonly { id: string; label: string }[] = [
  { id: defaultModel, label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: titleModel, label: "Haiku 5.5" },
];

export type Found =
  | { status: "ready"; cli: ClaudeCode | null; models?: CodexModel[]; account?: CodexAccount }
  | {
      status: Exclude<ProviderStatus, "ready">;
      problem?: HarnessProblem | { kind: "untrusted"; message: string };
    };

export type Running = { provider: ProviderSetting; model: string; cli: ClaudeCode | null };

export const noticedModel = "claude-sonnet-5-5";

export type Choice = { model: Running | null; title: Running | null; problem: string };

export type ModelsOptions = {
  // The only way a key runs anything.
  key: string | null;
  claudeCodePath?: string;
  // Asked before each look runs the CLI and before each turn and title on it.
  trust?: (path: string) => Promise<string | null>;
  desktop?: true;
  env?: Readonly<Record<string, string | undefined>>;
  check?: (options: CheckOptions) => ReturnType<typeof checkClaudeCode>;
  checkCodex?: (options: CheckOptions) => ReturnType<typeof checkCodex>;
  provider?: (running: Running, key: string | null, effort?: Effort) => Provider;
  titler?: (running: Running, key: string | null) => Titler;
  counts?: UsageCounts;
  plan?: (cli: ClaudeCode, kind: "claude-code" | "codex") => Promise<PlanUsage>;
  servers?: (cli: ClaudeCode, kind: "claude-code" | "codex") => Promise<FoundServer[]>;
  serverCalls?: (
    cli: ClaudeCode,
    kind: "claude-code" | "codex",
    options: ServerCallsOptions,
  ) => ServerCalls;
  // In dev only, never on the desktop app.
  dev?: readonly DevServer[];
};

export type Calling = { calls: ServerCalls; agent: { id: string; name: string; kind: string } };

export type Models = {
  look(settings: Settings): Promise<void>;
  found(id: string): Found;
  choose(settings: Settings): Choice;
  agent(settings: () => Settings, deps: ServerAgentDeps): Agent;
  titler(settings: () => Settings): Titler;
  noticer(settings: Settings): Promise<{ provider: Provider; model: string } | null>;
  options(settings: Settings): ModelOptionView[];
  providers(settings: Settings): ProviderView[];
  describe(settings: Settings): string;
  usage(settings: Settings): Promise<UsageView[]>;
  servers(settings: Settings): Promise<Discovery>;
  serverCalls(
    settings: Settings,
    server: FoundServer,
    tools: readonly string[],
    log: Log,
  ): Promise<Calling | null>;
};

const checking: Found = { status: "checking" };

export const order = ["api", "claude-code", "codex"] as const;

// Settings never lists it, and the desktop app never has one.
const apiInstance: ProviderSetting = { id: "api", kind: "api", name: "API key", on: true };

export const instancesOf = (settings: Settings, key: string | null): ProviderSetting[] => [
  ...(key ? [apiInstance] : []),
  ...settings.providers.filter((p) => p.kind !== "api"),
];

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

export function codexDefault(found: Found): string {
  const list = ready(found) ? (found.models ?? []) : [];
  return (list.find((m) => m.isDefault) ?? list[0])?.id ?? "";
}

export function models(options: ModelsOptions): Models {
  const env = options.env ?? process.env;
  const check = options.check ?? checkClaudeCode;
  const { key } = options;
  const instances = (settings: Settings) => instancesOf(settings, key);
  let found = new Map<string, Found>();
  const agents = new Map<string, Agent>();
  const titlers = new Map<string, Titler>();
  const cacheKey = (r: Running) => JSON.stringify([r.provider.id, r.model, r.cli]);
  // Only the latest look's answers stand, and every look ends when it does.
  let looks = 0;
  let latest: Promise<void> = Promise.resolve();

  // Only the turns and tokens of the person's Claude Code count toward
  // their plan: `--agent api`'s key bills per question.
  const counts = options.counts ?? memoryUsage(() => "");
  const providerOf =
    options.provider ??
    ((r: Running, apiKey: string | null, effort?: Effort): Provider => {
      const counted = (used: Usage, first: boolean) => counts.count(r.provider.id, used, first);
      const at = effort ? { effort } : {};
      if (!r.cli) return anthropicProvider({ apiKey: apiKey ?? "", model: r.model, ...at });
      return r.provider.kind === "codex"
        ? codexProvider({ cli: r.cli, model: r.model, counted })
        : claudeCodeProvider({ cli: r.cli, model: r.model, counted, ...at });
    });
  const titlerOf =
    options.titler ??
    ((r: Running, apiKey: string | null): Titler => {
      const counted = (used: Usage) => counts.count(r.provider.id, used, false);
      if (!r.cli) return anthropicTitler({ apiKey: apiKey ?? "", model: r.model });
      return r.provider.kind === "codex"
        ? codexTitler({ cli: r.cli, model: r.model, counted })
        : claudeCodeTitler({ cli: r.cli, model: r.model, counted });
    });
  const planOf =
    options.plan ??
    ((cli: ClaudeCode, kind: "claude-code" | "codex") =>
      kind === "codex" ? codexPlan(cli, { env }) : claudeCodePlan(cli, { env }));

  const dev = options.dev ?? [];
  const serversOf =
    options.servers ??
    ((cli: ClaudeCode, kind: "claude-code" | "codex") =>
      kind === "codex" ? codexServers(cli, { env, dev }) : claudeCodeServers(cli, { env, dev }));
  const callsOf =
    options.serverCalls ??
    ((cli: ClaudeCode, kind: "claude-code" | "codex", called: ServerCallsOptions) =>
      kind === "codex"
        ? codexServerCalls(cli, { ...called, env })
        : claudeCodeServerCalls(cli, { ...called, env }));
  // A local one by its command and arguments, which Claude Code starts from the person's own entry; else by its name, as Codex can.
  const calledOf = (server: FoundServer): CalledServer => {
    const stand = dev.find((each) => each.name === server.name);
    if (stand) return { name: server.name, dev: stand };
    if (server.url && server.transport)
      return { name: server.name, url: server.url, transport: server.transport };
    if (server.local) return { name: server.name, local: server.local };
    return { name: server.name };
  };

  async function lookFor(provider: ProviderSetting): Promise<Found> {
    if (provider.kind === "api") return { status: "ready", cli: null };
    if (provider.kind === "codex") {
      const result = await (options.checkCodex ?? checkCodex)({
        env,
        ...(provider.path ? { path: provider.path } : {}),
      });
      return result.ok
        ? { status: "ready", cli: result.cli, models: result.models, account: result.account }
        : { status: result.problem.kind, problem: result.problem };
    }
    const given = provider.path ?? options.claudeCodePath;
    // With a trust check, the CLI is found first, so the check sees the file
    // the look then runs.
    const located = options.trust ? locateClaudeCode(env, given) : null;
    const refused = located && (await options.trust?.(located));
    if (refused) return { status: "untrusted", problem: { kind: "untrusted", message: refused } };
    const path = located ?? given;
    const result = await check({ env, ...(path ? { path } : {}) });
    return result.ok
      ? { status: "ready", cli: result.cli }
      : { status: result.problem.kind, problem: result.problem };
  }

  const foundOf = (id: string) => found.get(id) ?? checking;
  const usable = (settings: Settings) =>
    instances(settings).filter((p) => p.on && ready(foundOf(p.id)));
  const modelsOf = (provider: ProviderSetting): readonly { id: string; label: string }[] => {
    if (provider.kind !== "codex") return claudeModels;
    const at = foundOf(provider.id);
    return ready(at) ? (at.models ?? []) : [];
  };
  const defaultFor = (provider: ProviderSetting, purpose: "model" | "title"): string => {
    if (provider.kind !== "codex") return purpose === "model" ? defaultModel : titleModel;
    return codexDefault(foundOf(provider.id));
  };
  // Oriel doesn't install it.
  const shown = (provider: ProviderSetting) =>
    provider.kind !== "codex" ||
    foundOf(provider.id).status !== "missing" ||
    provider.path !== undefined ||
    locateCodex(env) !== null;

  function running(
    settings: Settings,
    pick: ModelPick | null,
    purpose: "model" | "title",
  ): Running | null {
    const list = usable(settings);
    const picked = pick && list.find((p) => p.id === pick.provider);
    const first = order.map((kind) => list.find((p) => p.kind === kind)).find(Boolean);
    const [provider, model] =
      picked && modelsOf(picked).some((m) => m.id === pick.model)
        ? [picked, pick.model]
        : first
          ? [first, defaultFor(first, purpose)]
          : [null, ""];
    if (!provider || !model) return null;
    const at = foundOf(provider.id);
    return { provider, model, cli: ready(at) ? at.cli : null };
  }

  function choose(settings: Settings): Choice {
    const model = running(settings, settings.model, "model");
    const title = running(
      settings,
      settings.titleModel ??
        (model && { provider: model.provider.id, model: defaultFor(model.provider, "title") }),
      "title",
    );
    return { model, title, problem: model ? "" : problemOf(settings) };
  }

  function problemOf(settings: Settings): string {
    const claude = settings.providers.find((p) => p.kind === "claude-code");
    const claudeFound = claude ? foundOf(claude.id) : checking;
    const codex = settings.providers.find((p) => p.kind === "codex");
    const codexFound = codex ? foundOf(codex.id) : null;
    if (settings.providers.some((p) => !p.on && ready(foundOf(p.id))))
      return "Every provider Oriel can use is turned off. Turn one on in Settings.";
    if (claudeFound.status === "checking")
      return "Oriel is still looking for Claude Code. Try again in a moment.";
    if (options.desktop && claudeFound.status !== "untrusted")
      return "Oriel has no AI set up yet. Set up Claude Code or Codex in Settings.";
    const codexProblem = codexFound && "problem" in codexFound ? codexFound.problem : undefined;
    if (claudeFound.status === "missing" && codexProblem && codexFound?.status !== "missing")
      return codexProblem.message;
    if ("problem" in claudeFound && claudeFound.problem) return claudeFound.problem.message;
    return "Oriel has no model to run on. Open Settings to set one up.";
  }

  const label = (provider: ProviderSetting, model: string) =>
    modelsOf(provider).find((m) => m.id === model)?.label ?? model;

  return {
    look(settings) {
      const look = ++looks;
      found = new Map(instances(settings).map((p) => [p.id, found.get(p.id) ?? checking]));
      latest = (async () => {
        const answers = await Promise.all(
          instances(settings).map(async (p) => [p.id, await lookFor(p)] as const),
        );
        // A later look started meanwhile: wait for its answers, not these.
        if (look !== looks) return latest;
        found = new Map(answers);
        agents.clear();
        titlers.clear();
      })();
      return latest;
    },
    found: foundOf,
    choose,
    async servers(settings) {
      await latest;
      const { model: chosen } = choose(settings);
      if (!chosen?.cli || chosen.provider.kind === "api") return null;
      const agent = { id: chosen.provider.id, name: chosen.provider.name };
      if (await options.trust?.(chosen.cli.path)) return null;
      try {
        return { agent, found: await serversOf(chosen.cli, chosen.provider.kind) };
      } catch (error) {
        return {
          agent,
          problem: error instanceof Error ? error.message : "it didn't answer",
        };
      }
    },
    async serverCalls(settings, server, tools, log) {
      await latest;
      const { model: chosen } = choose(settings);
      if (!chosen?.cli || chosen.provider.kind === "api") return null;
      if (await options.trust?.(chosen.cli.path)) return null;
      const calls = callsOf(chosen.cli, chosen.provider.kind, {
        server: calledOf(server),
        tools,
        log,
      });
      return {
        calls,
        agent: { id: chosen.provider.id, name: chosen.provider.name, kind: chosen.provider.kind },
      };
    },
    async noticer(settings) {
      const { model: chosen } = choose(settings);
      if (!chosen) return null;
      const codex = chosen.provider.kind === "codex";
      const model = codex ? defaultFor(chosen.provider, "model") : noticedModel;
      if (chosen.cli && (await options.trust?.(chosen.cli.path))) return null;
      const provider = providerOf({ ...chosen, model }, key, codex ? undefined : "low");
      return { provider, model };
    },
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
          const { cli } = model;
          const { trust } = options;
          if (!cli || !trust) return built.turn(input, turnOptions);
          // The file may have changed since the look, as when the CLI
          // updated itself: it runs only once the check passes again.
          const running = built;
          return (async function* () {
            const refused = await trust(cli.path);
            yield* (refused ? setupAgent(refused) : running).turn(input, turnOptions);
          })();
        },
      };
    },
    titler(settings) {
      return async (text, titleOptions) => {
        const { title } = choose(settings());
        if (!title) throw new Error("No model is on to write titles.");
        const id = cacheKey(title);
        let built = titlers.get(id);
        if (!built) {
          built = titlerOf(title, key);
          titlers.set(id, built);
        }
        const refused = title.cli && (await options.trust?.(title.cli.path));
        if (refused) throw new Error(refused);
        return built(text, titleOptions);
      };
    },
    options(settings) {
      return usable(settings).flatMap((provider) =>
        modelsOf(provider).map((m) => ({
          provider: provider.id,
          model: m.id,
          label: `${m.label} · ${provider.name}`,
        })),
      );
    },
    providers(settings) {
      const { model, title } = choose(settings);
      return instances(settings).flatMap((provider): ProviderView[] => {
        const at = foundOf(provider.id);
        if (!shown(provider)) return [];
        return [
          {
            id: provider.id,
            kind: provider.kind,
            name: provider.name,
            on: provider.on,
            status: at.status,
            detail: detailOf(provider, at),
            version: ready(at) ? (at.cli?.version ?? null) : null,
            path: provider.path ?? null,
            uses: {
              model: model?.provider.id === provider.id ? label(provider, model.model) : null,
              title: title?.provider.id === provider.id ? label(provider, title.model) : null,
            },
          },
        ];
      });
    },
    async usage(settings) {
      const clis = settings.providers.flatMap((p) =>
        p.kind === "api" || !shown(p) ? [] : [{ ...p, kind: p.kind }],
      );
      return Promise.all(
        clis.map(async (provider): Promise<UsageView> => {
          const at = foundOf(provider.id);
          const cli = ready(at) ? at.cli : null;
          // A CLI runs only once the trust check passes, as for a turn.
          const refused = cli && (await options.trust?.(cli.path));
          return {
            provider: provider.id,
            today: counts.today(provider.id),
            plan: cli && !refused ? await planOf(cli, provider.kind) : { none: "not-ready" },
          };
        }),
      );
    },
    describe(settings) {
      const { model, title, problem } = choose(settings);
      if (!model) return `Agent: none. ${problem}`;
      const how = (r: Running) =>
        r.cli
          ? `${label(r.provider, r.model)} through ${r.provider.kind === "codex" ? "Codex" : "Claude Code"} ${r.cli.version} at ${r.cli.path}, on its own sign-in`
          : `${label(r.provider, r.model)} with the model key from .env, as --agent api asked`;
      return `Agent: ${how(model)}. Thread titles: ${title ? how(title) : "the first message, clipped"}.`;
    },
  };
}

// In the person's words, never a key.
function detailOf(provider: ProviderSetting, found: Found): string {
  if ("problem" in found && found.problem)
    return found.problem.message
      .replace("then restart Oriel.", "then check again.")
      .replace("Restart Oriel to try again.", "Check again to try once more.");
  switch (found.status) {
    case "ready":
      if (found.cli) return `Signed in · version ${found.cli.version}`;
      return "A key is set in .env, and --agent api asked for it";
    case "checking":
      return "Checking…";
    default:
      return provider.kind === "codex" ? "Not installed." : "Not found.";
  }
}
