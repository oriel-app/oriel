// Settings (OA-181): the person's providers, the default model and the
// Title model, the theme, the text size, which key sends a question, and
// whether the desktop app notifies (OA-184) and asks before quitting while
// Oriel works (decision 0045), and where a thread's page goes after an
// approval.
// They live in one JSON file in the data folder, `.oriel/` under `pnpm dev`,
// and apply as soon as they change. The file holds no key or credential.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";
import {
  boolean,
  homeExpanded,
  homeRelative,
  type Log,
  literal,
  nullable,
  number,
  object,
  refine,
  string,
  union,
  type Validator,
} from "@oriel/core";
import { defaultTheme } from "@oriel/web/themes";
import type { Models } from "./model.ts";
import {
  type AfterApprove,
  afterApproves,
  type ModelPick,
  type ProviderKind,
  type SendKey,
  sendKeys,
  type SettingsChange,
  type SettingsView,
  type TextSize,
  textSizes,
  type TimeFormat,
  timeFormats,
  type UsageView,
} from "@oriel/web/view";

// One provider instance. A second account of a kind is another instance,
// with its own ID and name. `path`: where its CLI is, when the person set
// one; it wins over the PATH.
export type ProviderSetting = {
  id: string;
  kind: ProviderKind;
  name: string;
  on: boolean;
  path?: string;
};

// `model` and `titleModel` null: Oriel picks, as before Settings existed.
export type Settings = {
  providers: ProviderSetting[];
  model: ModelPick | null;
  titleModel: ModelPick | null;
  theme: string;
  textSize: TextSize;
  send: SendKey;
  // A desktop notification when a thread newly needs the person.
  notify: boolean;
  // The desktop app asks before quitting while a thread's turn runs or a
  // change set applies.
  askBeforeQuitting: boolean;
  // How the window writes a time, everywhere but a review link's page.
  timeFormat: TimeFormat;
  // Whether a thread's page stays after an approval there, or goes on to
  // the next thread that needs the person.
  afterApprove: AfterApprove;
  // How often Oriel reads the person's source servers, in minutes, or null
  // for when it opens and when they press sync (decision 0059).
  sourceSync: number | null;
};

// One instance of each kind, on, in the order Settings lists them. An API
// key is no provider Settings lists (decision 0059): an `api` instance an
// older file kept is dropped as it's read, and `.env`'s key runs only under
// `pnpm dev --agent api` (model.ts).
const settingsKinds = ["claude-code", "codex"] as const;
const defaultProviders: readonly ProviderSetting[] = [
  { id: "claude-code", kind: "claude-code", name: "Claude Code", on: true },
  { id: "codex", kind: "codex", name: "Codex", on: true },
];

export const defaultSettings: Settings = {
  providers: [...defaultProviders],
  model: null,
  titleModel: null,
  theme: defaultTheme,
  textSize: "default",
  send: "enter",
  notify: true,
  askBeforeQuitting: true,
  timeFormat: "relative",
  afterApprove: "stay",
  sourceSync: null,
};

export type SettingsStore = { get(): Settings; set(next: Settings): void };

const idValue = refine(string, (id) => /^[a-z0-9-]{1,40}$/.test(id), "expected an ID");
const oneOf = <const T extends readonly string[]>(values: T) =>
  union(...values.map((value) => literal(value))) as Validator<T[number]>;
const pickValue = object({ provider: idValue, model: string });
// Every so many minutes, from 5 to a day.
const syncMinutes = refine(
  number,
  (minutes) => Number.isInteger(minutes) && minutes >= 5 && minutes <= 1440,
  "a whole number of minutes from 5 to 1440",
);
const nameValue = refine(string, (name) => name.trim() !== "" && name.length <= 60, "a name");

// A CLI's path as Settings takes it: absolute, and to a program named for
// the CLI, so a path can only ever start the CLI it names.
export function cliPath(kind: ProviderKind, path: string): boolean {
  const program = kind === "claude-code" ? "claude" : kind === "codex" ? "codex" : null;
  const names = program ? [program, `${program}.exe`, `${program}.cmd`] : [];
  return (
    path.length <= 1024 &&
    !path.includes("\0") &&
    isAbsolute(path) &&
    names.includes(basename(path).toLowerCase())
  );
}

const providerValue = object({
  id: idValue,
  kind: oneOf(settingsKinds),
  name: nameValue,
  on: boolean,
  path: string,
});

// What the file holds, field by field: a field it can't read falls back to
// its default, so one bad value never loses the rest.
function read(parsed: unknown): Settings {
  const record = typeof parsed === "object" && parsed !== null ? parsed : {};
  const field = <T>(key: keyof Settings, validator: Validator<T>, fallback: T): T => {
    const result = validator((record as Record<string, unknown>)[key]);
    return result.ok ? result.value : fallback;
  };
  const listed = (record as Record<string, unknown>).providers;
  const kept: ProviderSetting[] = [];
  for (const entry of Array.isArray(listed) ? listed : []) {
    const result = providerValue({ path: "", ...(entry as object) });
    if (!result.ok || kept.some((p) => p.id === result.value.id)) continue;
    const { path, ...rest } = result.value;
    kept.push(path !== "" && cliPath(rest.kind, path) ? { ...rest, path } : rest);
  }
  // A kind Oriel added since the file was written shows up, on.
  const missing = defaultProviders.filter((p) => !kept.some((k) => k.kind === p.kind));
  return {
    providers: [...kept, ...missing],
    model: field("model", nullable(pickValue), null),
    titleModel: field("titleModel", nullable(pickValue), null),
    theme: field(
      "theme",
      refine(string, (t) => /^[a-z][a-z0-9-]*$/.test(t), "a theme's name"),
      defaultTheme,
    ),
    textSize: field("textSize", oneOf(textSizes), "default"),
    send: field("send", oneOf(sendKeys), "enter"),
    notify: field("notify", boolean, true),
    askBeforeQuitting: field("askBeforeQuitting", boolean, true),
    timeFormat: field("timeFormat", oneOf(timeFormats), "relative"),
    afterApprove: field("afterApprove", oneOf(afterApproves), "stay"),
    sourceSync: field("sourceSync", nullable(syncMinutes), null),
  };
}

// The settings file at `path`, read once and kept in memory; each change is
// written whole and renamed into place, readable by its owner only.
export function settingsFile(path: string, log: Log): SettingsStore {
  let current = load();
  function load(): Settings {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        log("settings: unreadable", { error: (error as Error).message });
      return defaultSettings;
    }
    try {
      return read(JSON.parse(text));
    } catch {
      log("settings: not JSON, so the defaults stand", {});
      return defaultSettings;
    }
  }
  return {
    get: () => current,
    set(next) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, path);
      current = next;
    },
  };
}

export function memorySettings(initial: Partial<Settings> = {}): SettingsStore {
  let current: Settings = { ...defaultSettings, ...initial };
  return {
    get: () => current,
    set(next) {
      current = next;
    },
  };
}

// A change from the settings page, as the route takes it.
export const settingsChange: Validator<SettingsChange> = union(
  object({ theme: string }),
  object({ textSize: oneOf(textSizes) }),
  object({ send: oneOf(sendKeys) }),
  object({ notify: boolean }),
  object({ askBeforeQuitting: boolean }),
  object({ timeFormat: oneOf(timeFormats) }),
  object({ afterApprove: oneOf(afterApproves) }),
  object({ sourceSync: nullable(syncMinutes) }),
  object({ model: pickValue }),
  object({ titleModel: pickValue }),
  object({ provider: idValue, on: boolean }),
  object({ provider: idValue, path: nullable(string) }),
);

export class SettingsRefused extends Error {}

// `settings` with `change` made, or why not. Themes and models are checked
// against what exists; whether a model's provider is connected is the
// model chooser's to say.
export function changed(
  settings: Settings,
  change: SettingsChange,
  themes: readonly string[],
): Settings {
  if ("theme" in change) {
    if (!themes.includes(change.theme)) throw new SettingsRefused("There's no such theme.");
    return { ...settings, theme: change.theme };
  }
  if ("textSize" in change) return { ...settings, textSize: change.textSize };
  if ("send" in change) return { ...settings, send: change.send };
  if ("notify" in change) return { ...settings, notify: change.notify };
  if ("askBeforeQuitting" in change)
    return { ...settings, askBeforeQuitting: change.askBeforeQuitting };
  if ("timeFormat" in change) return { ...settings, timeFormat: change.timeFormat };
  if ("afterApprove" in change) return { ...settings, afterApprove: change.afterApprove };
  if ("sourceSync" in change) return { ...settings, sourceSync: change.sourceSync };
  if ("model" in change) return { ...settings, model: change.model };
  if ("titleModel" in change) return { ...settings, titleModel: change.titleModel };
  const provider = settings.providers.find((p) => p.id === change.provider);
  if (!provider) throw new SettingsRefused("There's no such provider.");
  const providers = (next: ProviderSetting) =>
    settings.providers.map((p) => (p.id === next.id ? next : p));
  if ("on" in change) return { ...settings, providers: providers({ ...provider, on: change.on }) };
  if (change.path === null) {
    const { path: _, ...rest } = provider;
    return { ...settings, providers: providers(rest) };
  }
  if (!cliPath(provider.kind, change.path))
    throw new SettingsRefused(
      provider.kind === "claude-code"
        ? "Give the full path to the claude program, such as /opt/homebrew/bin/claude."
        : provider.kind === "codex"
          ? "Give the full path to the codex program, such as /opt/homebrew/bin/codex."
          : "This provider takes no path.",
    );
  return { ...settings, providers: providers({ ...provider, path: change.path }) };
}

// The settings page's routes, over the store and the model chooser. Without
// a chooser, the server runs the scripted agent and lists no provider.
export type SettingsService = {
  view(): SettingsView;
  change(change: SettingsChange): Promise<SettingsView>;
  // Looks for every provider again, as Check again asks.
  look(): Promise<SettingsView>;
  // What the page's <html> carries, so its first paint is right.
  page(): { theme: string; textSize: TextSize };
  // How much of each Claude Code instance's plan Oriel has used (decision
  // 0046).
  usage(): Promise<UsageView[]>;
};

export function settingsService(deps: {
  store: SettingsStore;
  models: Models | null;
  themes: readonly string[];
  // Whether a change may set where a CLI is (decision 0041).
  cliPaths: boolean;
  // The person's home folder: a CLI's path shows from `~`, and a `~/…`
  // saved expands back (OA-315). None in a test that doesn't care.
  home?: string;
  // Whether this server can notify: only the desktop app's shell shows them.
  notifies?: boolean;
  // Whether this server's app asks before quitting: only the desktop app's.
  asksBeforeQuitting?: boolean;
  // A theme was picked, for telemetry.
  picked(theme: string): void;
  // A change was kept.
  saved?(): void;
  // Threads run on another agent now, which may have other source servers
  // (decision 0059); and how often sync runs changed.
  agentChanged?(): void;
  synced?(): void;
}): SettingsService {
  const { store, models, themes } = deps;
  const home = deps.home ?? "";
  const view = (): SettingsView => {
    const settings = store.get();
    const choice = models?.choose(settings);
    const pick = (r: { provider: { id: string }; model: string } | null | undefined) =>
      r ? { provider: r.provider.id, model: r.model } : null;
    return {
      providers: (models?.providers(settings) ?? []).map((provider) => ({
        ...provider,
        path: provider.path === null ? null : homeRelative(provider.path, home),
      })),
      models: models?.options(settings) ?? [],
      model: pick(choice?.model),
      titleModel: pick(choice?.title),
      scripted: models === null,
      cliPaths: deps.cliPaths,
      theme: themes.includes(settings.theme) ? settings.theme : defaultTheme,
      themes: [...themes],
      textSize: settings.textSize,
      send: settings.send,
      notify: settings.notify,
      notifies: deps.notifies ?? false,
      askBeforeQuitting: settings.askBeforeQuitting,
      asksBeforeQuitting: deps.asksBeforeQuitting ?? false,
      timeFormat: settings.timeFormat,
      afterApprove: settings.afterApprove,
      sourceSync: settings.sourceSync,
    };
  };
  return {
    view,
    async change(asked) {
      // A path saved from `~` is kept as the real one.
      const change =
        "path" in asked && asked.path !== null
          ? { ...asked, path: homeExpanded(asked.path, home) }
          : asked;
      const before = store.get();
      if ("path" in change && !deps.cliPaths)
        throw new SettingsRefused(
          "Set where Claude Code is with --claude-code. Only the desktop app takes a path from this page.",
        );
      const next = changed(before, change, themes);
      const pick =
        "model" in change ? change.model : "titleModel" in change ? change.titleModel : null;
      if (
        pick &&
        !models?.options(before).some((o) => o.provider === pick.provider && o.model === pick.model)
      )
        throw new SettingsRefused("That model's provider isn't connected and on.");
      const runs = (settings: Settings) => models?.choose(settings).model?.provider.id ?? null;
      store.set(next);
      deps.saved?.();
      if (runs(before) !== runs(next)) deps.agentChanged?.();
      if ("sourceSync" in change) deps.synced?.();
      if ("theme" in change && change.theme !== before.theme) deps.picked(change.theme);
      // A new path is a new CLI to check.
      if ("path" in change && models) await models.look(next);
      return view();
    },
    async look() {
      const runs = () => models?.choose(store.get()).model?.provider.id ?? null;
      const before = runs();
      await models?.look(store.get());
      // A CLI signed out or in since: Sources ask the agent that runs now.
      if (runs() !== before) deps.agentChanged?.();
      return view();
    },
    usage: async () => (await models?.usage(store.get())) ?? [],
    page() {
      const { theme, textSize } = store.get();
      return { theme: themes.includes(theme) ? theme : defaultTheme, textSize };
    },
  };
}
