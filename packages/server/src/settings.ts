// Settings (OA-181): the person's providers, the default model and the
// Title model, the theme, the text size, which key sends a question, and
// whether the desktop app notifies (OA-184).
// They live in one JSON file in the data folder, `.oriel/` under `pnpm dev`,
// and apply as soon as they change. The file holds no key or credential: a
// provider's row says only whether one is set.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";
import {
  boolean,
  type Log,
  literal,
  nullable,
  object,
  refine,
  string,
  union,
  type Validator,
} from "@oriel/core";
import { defaultTheme } from "@oriel/web/themes";
import { type KeyStore, keepKey, KeyRefused } from "./api-key.ts";
import type { Models } from "./model.ts";
import {
  type ModelPick,
  type ProviderKind,
  providerKinds,
  type SendKey,
  sendKeys,
  type SettingsChange,
  type SettingsView,
  type TextSize,
  textSizes,
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
};

// One instance of each kind, on, in the order Settings lists them.
const defaultProviders: readonly ProviderSetting[] = [
  { id: "claude-code", kind: "claude-code", name: "Claude Code", on: true },
  { id: "codex", kind: "codex", name: "Codex", on: true },
  { id: "api", kind: "api", name: "API key", on: true },
];

export const defaultSettings: Settings = {
  providers: [...defaultProviders],
  model: null,
  titleModel: null,
  theme: defaultTheme,
  textSize: "default",
  send: "enter",
  notify: true,
};

export type SettingsStore = { get(): Settings; set(next: Settings): void };

const idValue = refine(string, (id) => /^[a-z0-9-]{1,40}$/.test(id), "expected an ID");
const oneOf = <const T extends readonly string[]>(values: T) =>
  union(...values.map((value) => literal(value))) as Validator<T[number]>;
const pickValue = object({ provider: idValue, model: string });
const nameValue = refine(string, (name) => name.trim() !== "" && name.length <= 60, "a name");

// A CLI's path as Settings takes it: absolute, and to a program named for
// the CLI, so a path can only ever start the CLI it names.
export function cliPath(kind: ProviderKind, path: string): boolean {
  const names = kind === "claude-code" ? ["claude", "claude.exe", "claude.cmd"] : [];
  return (
    path.length <= 1024 &&
    !path.includes("\0") &&
    isAbsolute(path) &&
    names.includes(basename(path).toLowerCase())
  );
}

const providerValue = object({
  id: idValue,
  kind: oneOf(providerKinds),
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
  // Keeps an API key, once Anthropic takes it, or removes it with null.
  key(key: string | null): Promise<SettingsView>;
  // What the page's <html> carries, so its first paint is right.
  page(): { theme: string; textSize: TextSize };
};

export function settingsService(deps: {
  store: SettingsStore;
  models: Models | null;
  themes: readonly string[];
  // Whether a change may set where a CLI is (decision 0041).
  cliPaths: boolean;
  // Where the page may keep an API key: the desktop app's secret store. The
  // check stands in for Anthropic in tests.
  keys?: { store: KeyStore; check?: Parameters<typeof keepKey>[2] };
  // Whether this server can notify: only the desktop app's shell shows them.
  notifies?: boolean;
  // A theme was picked, for telemetry.
  picked(theme: string): void;
}): SettingsService {
  const { store, models, themes } = deps;
  const view = (): SettingsView => {
    const settings = store.get();
    const choice = models?.choose(settings);
    const pick = (r: { provider: { id: string }; model: string } | null | undefined) =>
      r ? { provider: r.provider.id, model: r.model } : null;
    return {
      providers: models?.providers(settings) ?? [],
      models: models?.options(settings) ?? [],
      model: pick(choice?.model),
      titleModel: pick(choice?.title),
      scripted: models === null,
      cliPaths: deps.cliPaths,
      apiKeys: deps.keys !== undefined && models !== null,
      theme: themes.includes(settings.theme) ? settings.theme : defaultTheme,
      themes: [...themes],
      textSize: settings.textSize,
      send: settings.send,
      notify: settings.notify,
      notifies: deps.notifies ?? false,
    };
  };
  return {
    view,
    async change(change) {
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
      store.set(next);
      if ("theme" in change && change.theme !== before.theme) deps.picked(change.theme);
      // A new path is a new CLI to check.
      if ("path" in change && models) await models.look(next);
      return view();
    },
    async look() {
      await models?.look(store.get());
      return view();
    },
    async key(key) {
      const { keys } = deps;
      if (!keys || !models)
        throw new SettingsRefused(
          "Set ANTHROPIC_API_KEY in .env. Only the desktop app keeps a key from this page.",
        );
      try {
        if (key === null) await keys.store.delete();
        else await keepKey(keys.store, key, keys.check);
      } catch (error) {
        if (error instanceof KeyRefused) throw new SettingsRefused(error.message);
        throw new SettingsRefused("Oriel couldn't remove the key from the OS secret store.");
      }
      await models.look(store.get());
      return view();
    },
    page() {
      const { theme, textSize } = store.get();
      return { theme: themes.includes(theme) ? theme : defaultTheme, textSize };
    },
  };
}
