// Settings (OA-181): the person's providers, the default model and the Title
// model, the theme, the text size, and which key sends a question. Each
// change shows at once and goes to the server, which keeps it; there's no
// Save. The look, theme and text size, is on the page's <html>, which the
// server writes for the first paint and a change sets in place. An API key,
// on the desktop app, goes to the OS secret store once Anthropic takes it;
// the page forgets it once it's sent, and the server never sends it back.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import { defaultTimeFormat } from "./time.ts";
import type { SendKey, SettingsChange, SettingsView, TimeFormat, UsageView } from "./view.ts";

export type SettingsModel = {
  // As the server has them, with any change not yet answered shown; null
  // before they load.
  view: SettingsView | null;
  // Changes sent and not yet answered. Only the answer to the last stands,
  // since each answer is the whole view.
  pending: number;
  // Check again is looking for every provider.
  looking: boolean;
  // A path typed into a provider's row, by instance, until it's saved.
  paths: Readonly<Record<string, string>>;
  // An API key typed and not yet sent, and whether one sent is being checked.
  key: string;
  keying: boolean;
  // Why the last change or load didn't work, until one does.
  problem: string | null;
  // How much of each CLI instance's plan Oriel has used; null
  // until it loads.
  usage: UsageView[] | null;
};

export type SettingsMsg =
  | { type: "changed"; change: SettingsChange }
  | { type: "lookClicked" }
  | { type: "pathTyped"; provider: string; text: string }
  | { type: "pathSaved"; provider: string }
  | { type: "keyTyped"; text: string }
  | { type: "keySaved" }
  | { type: "keyRemoved" };

export const loadSettings: Effect = get("/api/settings", { kind: "settings" });
export const loadUsage: Effect = post("/api/settings/usage", {}, { kind: "settingsUsage" });

export function initSettings(): SettingsModel {
  return {
    view: null,
    pending: 0,
    looking: false,
    paths: {},
    key: "",
    keying: false,
    problem: null,
    usage: null,
  };
}

// No AI is set up: nothing found ready and on, once Oriel has looked, and
// not the scripted agent. Until settings load, or while Oriel looks, it
// isn't said.
export const noAi = (model: SettingsModel): boolean => {
  const { view } = model;
  return (
    view !== null &&
    !view.scripted &&
    view.models.length === 0 &&
    !view.providers.some((p) => p.status === "checking")
  );
};

// Which key sends a question, before the settings load too.
export const sendKey = (model: SettingsModel): SendKey => model.view?.send ?? "enter";

// How a time is written, before the settings load too.
export const timeFormat = (model: SettingsModel): TimeFormat =>
  model.view?.timeFormat ?? defaultTimeFormat;

// Whether a key pressed in a box for a question sends it.
export function sends(
  event: {
    key: string;
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    isComposing: boolean;
  },
  key: SendKey,
): boolean {
  if (event.key !== "Enter" || event.isComposing) return false;
  return key === "enter" ? !event.shiftKey : event.metaKey || event.ctrlKey;
}

const showLook = (view: SettingsView): Effect => ({
  type: "showLook",
  theme: view.theme,
  textSize: view.textSize,
});

// The view with `change` made, as the server will make it. A path is the
// server's to check, so it waits for the answer.
function applied(view: SettingsView, change: SettingsChange): SettingsView {
  if ("theme" in change) return { ...view, theme: change.theme };
  if ("textSize" in change) return { ...view, textSize: change.textSize };
  if ("send" in change) return { ...view, send: change.send };
  if ("notify" in change) return { ...view, notify: change.notify };
  if ("askBeforeQuitting" in change)
    return { ...view, askBeforeQuitting: change.askBeforeQuitting };
  if ("timeFormat" in change) return { ...view, timeFormat: change.timeFormat };
  if ("model" in change) return { ...view, model: change.model };
  if ("titleModel" in change) return { ...view, titleModel: change.titleModel };
  if ("on" in change)
    return {
      ...view,
      providers: view.providers.map((p) =>
        p.id === change.provider ? { ...p, on: change.on } : p,
      ),
    };
  return view;
}

export function updateSettings(model: SettingsModel, msg: SettingsMsg): [SettingsModel, Effect[]] {
  switch (msg.type) {
    case "changed": {
      if (model.view === null) return [model, []];
      const view = applied(model.view, msg.change);
      const look = "theme" in msg.change || "textSize" in msg.change ? [showLook(view)] : [];
      return [
        { ...model, view, pending: model.pending + 1, problem: null },
        [...look, post("/api/settings", msg.change, { kind: "settingsChanged" })],
      ];
    }
    case "lookClicked":
      if (model.looking) return [model, []];
      return [
        { ...model, looking: true, problem: null },
        [post("/api/settings/look", {}, { kind: "settingsLooked" })],
      ];
    case "pathTyped":
      return [{ ...model, paths: { ...model.paths, [msg.provider]: msg.text } }, []];
    case "pathSaved": {
      const typed = model.paths[msg.provider];
      if (typed === undefined) return [model, []];
      const path = typed.trim() === "" ? null : typed.trim();
      return updateSettings(model, { type: "changed", change: { provider: msg.provider, path } });
    }
    case "keyTyped":
      return [{ ...model, key: msg.text }, []];
    case "keySaved":
    case "keyRemoved": {
      const key = msg.type === "keySaved" ? model.key.trim() : null;
      if (model.keying || key === "") return [model, []];
      return [
        { ...model, key: "", keying: true, problem: null },
        [post("/api/settings/key", { key }, { kind: "settingsKey" })],
      ];
    }
  }
}

// A reply about settings. A change that was refused loads them again, so
// the page shows what the server kept.
export function settingsReplied(model: SettingsModel, msg: Replied): [SettingsModel, Effect[]] {
  const { kind } = msg.tag;
  // Usage that didn't load leaves the rows as they were.
  if (kind === "settingsUsage")
    return [msg.ok ? { ...model, usage: (msg.body as { usage: UsageView[] }).usage } : model, []];
  if (
    kind !== "settings" &&
    kind !== "settingsChanged" &&
    kind !== "settingsLooked" &&
    kind !== "settingsKey"
  )
    return [model, []];
  const pending = kind === "settingsChanged" ? Math.max(0, model.pending - 1) : model.pending;
  const looking = kind === "settingsLooked" ? false : model.looking;
  const keying = kind === "settingsKey" ? false : model.keying;
  if (!msg.ok) {
    const problem = errorOf(msg.body);
    return [
      { ...model, pending, looking, keying, problem },
      kind === "settingsChanged" ? [loadSettings] : [],
    ];
  }
  // An answer to an earlier change, with a later one still on its way.
  if (pending > 0) return [{ ...model, pending, looking, keying }, []];
  const view = msg.body as SettingsView;
  // A path the server now holds is saved; one typed since stays.
  const saved = (id: string, text: string) =>
    (view.providers.find((p) => p.id === id)?.path ?? "") === text.trim();
  const paths = Object.fromEntries(
    Object.entries(model.paths).filter(([id, text]) => !saved(id, text)),
  );
  // A load after a refused change keeps saying why it was refused.
  const problem = kind === "settings" ? model.problem : null;
  // Checking again may have found a CLI to ask about the plan.
  const usage = kind === "settingsLooked" ? [loadUsage] : [];
  return [{ ...model, view, pending, looking, keying, paths, problem }, [showLook(view), ...usage]];
}
