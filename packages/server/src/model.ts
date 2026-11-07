// Which model the agent and thread titles run on (decisions 0037, 0041 and
// 0048). Oriel looks for each provider instance Settings lists: an API key,
// in `.env` or, on the desktop app, in the OS secret store, and the person's
// own Claude Code and Codex, each installed, a supported version and signed
// in. Each turn and each title then runs on the provider and model Settings
// pick, among those found and turned on, so a change in Settings applies at
// the next turn. With no pick, the key wins, then Claude Code, then Codex, a
// preview. With none, each turn says how to set one up, naming no
// credential.
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

// The models a Claude provider offers, by the API's IDs, the largest first.
export const claudeModels: readonly { id: string; label: string }[] = [
  { id: defaultModel, label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: titleModel, label: "Haiku 5.5" },
];

// What Oriel found for one instance when it last looked. An untrusted CLI's
// problem is the trust check's sentence. A ready Codex has the models it
// lists and, for its row only, its plan and email.
export type Found =
  | { status: "ready"; cli: ClaudeCode | null; models?: CodexModel[]; account?: CodexAccount }
  | {
      status: Exclude<ProviderStatus, "ready">;
      problem?: HarnessProblem | { kind: "untrusted"; message: string };
    };

// What runs a turn or a title: an instance found ready and turned on, and
// one of its models.
export type Running = { provider: ProviderSetting; model: string; cli: ClaudeCode | null };

// Noticed's model where the provider offers Claude's.
export const noticedModel = "claude-sonnet-5-5";

export type Choice = { model: Running | null; title: Running | null; problem: string };

export type ModelsOptions = {
  // ANTHROPIC_API_KEY from `.env`, or null.
  key: string | null;
  // On the desktop app, the key kept in the OS secret store, which Settings
  // can change, in place of `.env`'s. Each look reads it again.
  kept?: { get(): Promise<string | null> };
  // `--claude-code <path>`; a path set in Settings wins.
  claudeCodePath?: string;
  // Whether Oriel may run the CLI at `path`, asked before each look runs it
  // and before each turn and title on it: on the desktop app, that a Claude
  // Code from its vendor's installer is signed by its vendor (decision
  // 0038). Null when it may; else the sentence its row says.
  trust?: (path: string) => Promise<string | null>;
  // The desktop app, whose first run and Settings install and sign in the
  // person's Claude Code: a turn with no model points there, never to a
  // terminal (decision 0038).
  desktop?: true;
  // The environment the CLIs are found in. Default `process.env`.
  env?: Readonly<Record<string, string | undefined>>;
  // Stand in for the CLI check and the providers in tests.
  check?: (options: CheckOptions) => ReturnType<typeof checkClaudeCode>;
  checkCodex?: (options: CheckOptions) => ReturnType<typeof checkCodex>;
  provider?: (running: Running, key: string | null, effort?: Effort) => Provider;
  titler?: (running: Running, key: string | null) => Titler;
  // Today's counts of each CLI instance's turns and tokens, kept in the
  // data folder (decision 0046). In memory when absent.
  counts?: UsageCounts;
  // Asks a CLI how much of the plan is used; tests stand in for it.
  plan?: (cli: ClaudeCode, kind: "claude-code" | "codex") => Promise<PlanUsage>;
  // Asks a CLI for the person's MCP servers; tests stand in for it.
  servers?: (cli: ClaudeCode, kind: "claude-code" | "codex") => Promise<FoundServer[]>;
  // Starts a process that calls one of them; tests stand in for it.
  serverCalls?: (
    cli: ClaudeCode,
    kind: "claude-code" | "codex",
    options: ServerCallsOptions,
  ) => ServerCalls;
  // Stand-in source servers each CLI gets beside the person's own, in dev
  // only (`ORIEL_DEV_STANDINS`, OA-276): never on the desktop app.
  dev?: readonly DevServer[];
};

// What a sync or a replay calls one source server with: the CLI that runs
// threads, the process, and the agent by its Settings ID and name.
export type Calling = { calls: ServerCalls; agent: { id: string; name: string; kind: string } };

export type Models = {
  // Looks for every instance again, the CLIs' checks included. Ends once
  // the latest look's answers stand, even when a later look started.
  look(settings: Settings): Promise<void>;
  // What was found for an instance; "checking" until the first look ends.
  found(id: string): Found;
  choose(settings: Settings): Choice;
  // The agent and the titler, each choosing again at every turn and title.
  agent(settings: () => Settings, deps: ServerAgentDeps): Agent;
  titler(settings: () => Settings): Titler;
  // What Noticed's pass runs on (decision 0052): the
  // threads' provider, with Sonnet at low effort where it offers Claude's
  // models, as the noticed-1 climb found best; null with no model, or a CLI
  // that doesn't pass its trust check now.
  noticer(settings: Settings): Promise<{ provider: Provider; model: string } | null>;
  // The models the default and Title model can be, from instances found
  // ready and turned on.
  options(settings: Settings): ModelOptionView[];
  providers(settings: Settings): ProviderView[];
  // The line the server prints at startup.
  describe(settings: Settings): string;
  // Each CLI instance's usage: today's counts, and the plan's windows from
  // its CLI, asked now.
  usage(settings: Settings): Promise<UsageView[]>;
  // The person's MCP servers, from the CLI that runs threads, once the
  // latest look ends (decision 0059): null when none runs them, or an API
  // key does, which has no servers to bring.
  servers(settings: Settings): Promise<Discovery>;
  // A process of the CLI that runs threads that calls `server`, one of the
  // person's own, with only `tools` (decision 0059): null when none runs
  // them, or the CLI doesn't pass its trust check now.
  serverCalls(
    settings: Settings,
    server: FoundServer,
    tools: readonly string[],
    log: Log,
  ): Promise<Calling | null>;
};

const checking: Found = { status: "checking" };

// Which instance runs when nothing is picked: the key, then Claude Code,
// then Codex.
const order = ["api", "claude-code", "codex"] as const;

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

// The model Codex runs when nothing names one: its own default, else the
// first it lists; none until it's found ready.
export function codexDefault(found: Found): string {
  const list = ready(found) ? (found.models ?? []) : [];
  return (list.find((m) => m.isDefault) ?? list[0])?.id ?? "";
}

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
  // Only the latest look's answers stand, and every look ends when it does.
  let looks = 0;
  let latest: Promise<void> = Promise.resolve();

  // Only the turns and tokens of the person's Claude Code count toward
  // their plan: an API key bills per question.
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
  // A found server as a process loads it alone: a dev stand-in by its
  // command, a remote one by its URL, else by its name, as Codex can.
  const calledOf = (server: FoundServer): CalledServer => {
    const stand = dev.find((each) => each.name === server.name);
    if (stand) return { name: server.name, dev: stand };
    if (server.url && server.transport)
      return { name: server.name, url: server.url, transport: server.transport };
    return { name: server.name };
  };

  async function lookFor(provider: ProviderSetting, key: string | null): Promise<Found> {
    if (provider.kind === "api") return key ? { status: "ready", cli: null } : { status: "no-key" };
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
    settings.providers.filter((p) => p.on && ready(foundOf(p.id)));
  // The models an instance offers: Claude's three, or what Codex lists.
  const modelsOf = (provider: ProviderSetting): readonly { id: string; label: string }[] => {
    if (provider.kind !== "codex") return claudeModels;
    const at = foundOf(provider.id);
    return ready(at) ? (at.models ?? []) : [];
  };
  // What an instance runs when nothing names a model: for threads, Claude's
  // largest or Codex's own default; for titles, Claude's smallest or the same.
  const defaultFor = (provider: ProviderSetting, purpose: "model" | "title"): string => {
    if (provider.kind !== "codex") return purpose === "model" ? defaultModel : titleModel;
    return codexDefault(foundOf(provider.id));
  };
  // Codex's row shows once it's installed: on the PATH, or at a path set in
  // Settings, which its row can change. Oriel doesn't install it.
  const shown = (provider: ProviderSetting) =>
    provider.kind !== "codex" ||
    foundOf(provider.id).status !== "missing" ||
    provider.path !== undefined ||
    locateCodex(env) !== null;

  // The pick, if its instance is usable and offers its model; else the
  // first usable instance, the key first, then Claude Code, with its default.
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
    // Titles follow the default model's provider until the person picks.
    const title = running(
      settings,
      settings.titleModel ??
        (model && { provider: model.provider.id, model: defaultFor(model.provider, "title") }),
      "title",
    );
    return { model, title, problem: model ? "" : problemOf(settings) };
  }

  // Why no model runs, and what to do, for a turn.
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
      return "Oriel has no AI set up yet. Set up Claude Code or Codex in Settings, or add an API key there.";
    // Only Codex is there, and it isn't ready: its own problem.
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
      found = new Map(settings.providers.map((p) => [p.id, found.get(p.id) ?? checking]));
      latest = (async () => {
        const keyNow = kept ? await kept.get() : key;
        const answers = await Promise.all(
          settings.providers.map(async (p) => [p.id, await lookFor(p, keyNow)] as const),
        );
        // A later look started meanwhile: wait for its answers, not these.
        if (look !== looks) return latest;
        key = keyNow;
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
        others: server.tools.filter((tool) => !tools.includes(tool)),
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
      // Codex runs at its own default effort too.
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
      return settings.providers.flatMap((provider): ProviderView[] => {
        const at = foundOf(provider.id);
        if (!shown(provider)) return [];
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
              model: model?.provider.id === provider.id ? label(provider, model.model) : null,
              title: title?.provider.id === provider.id ? label(provider, title.model) : null,
            },
          },
        ];
      });
    },
    async usage(settings) {
      // Codex's, like its row, only once it's installed.
      const instances = settings.providers.flatMap((p) =>
        p.kind === "api" || !shown(p) ? [] : [{ ...p, kind: p.kind }],
      );
      return Promise.all(
        instances.map(async (provider): Promise<UsageView> => {
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
          : `${label(r.provider, r.model)} with ${where === "store" ? "the API key in the OS secret store" : "the model key from .env"}`;
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
    default:
      return provider.kind === "codex" ? "Not installed." : "Not found.";
  }
}
