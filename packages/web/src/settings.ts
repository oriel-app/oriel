import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import { defaultTimeFormat } from "./time.ts";
import type {
  AfterApprove,
  SendKey,
  SettingsChange,
  SettingsView,
  TimeFormat,
  UsageView,
} from "./view.ts";

export type SettingsModel = {
  view: SettingsView | null;
  // Only the answer to the last change stands, since each answer is the whole view.
  pending: number;
  looking: boolean;
  paths: Readonly<Record<string, string>>;
  problem: string | null;
  usage: UsageView[] | null;
};

export type SettingsMsg =
  | { type: "changed"; change: SettingsChange }
  | { type: "lookClicked" }
  | { type: "pathTyped"; provider: string; text: string }
  | { type: "pathSaved"; provider: string };

export const loadSettings: Effect = get("/api/settings", { kind: "settings" });
export const loadUsage: Effect = post("/api/settings/usage", {}, { kind: "settingsUsage" });

export function initSettings(): SettingsModel {
  return {
    view: null,
    pending: 0,
    looking: false,
    paths: {},
    problem: null,
    usage: null,
  };
}

export const noAi = (model: SettingsModel): boolean => {
  const { view } = model;
  return (
    view !== null &&
    !view.scripted &&
    view.models.length === 0 &&
    !view.providers.some((p) => p.status === "checking")
  );
};

export const sendKey = (model: SettingsModel): SendKey => model.view?.send ?? "enter";

export const timeFormat = (model: SettingsModel): TimeFormat =>
  model.view?.timeFormat ?? defaultTimeFormat;

export const afterApprove = (model: SettingsModel): AfterApprove =>
  model.view?.afterApprove ?? "stay";

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

// The keyboard path skips the button, so each reducer keeps its own guard too.
export const sendable = (draft: string, busy: boolean): boolean => !busy && draft.trim() !== "";

const showLook = (view: SettingsView): Effect => ({
  type: "showLook",
  theme: view.theme,
  textSize: view.textSize,
});

function applied(view: SettingsView, change: SettingsChange): SettingsView {
  if ("theme" in change) return { ...view, theme: change.theme };
  if ("textSize" in change) return { ...view, textSize: change.textSize };
  if ("send" in change) return { ...view, send: change.send };
  if ("notify" in change) return { ...view, notify: change.notify };
  if ("askBeforeQuitting" in change)
    return { ...view, askBeforeQuitting: change.askBeforeQuitting };
  if ("timeFormat" in change) return { ...view, timeFormat: change.timeFormat };
  if ("afterApprove" in change) return { ...view, afterApprove: change.afterApprove };
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
  }
}

export function settingsReplied(model: SettingsModel, msg: Replied): [SettingsModel, Effect[]] {
  const { kind } = msg.tag;
  if (kind === "settingsUsage")
    return [msg.ok ? { ...model, usage: (msg.body as { usage: UsageView[] }).usage } : model, []];
  if (kind !== "settings" && kind !== "settingsChanged" && kind !== "settingsLooked")
    return [model, []];
  const pending = kind === "settingsChanged" ? Math.max(0, model.pending - 1) : model.pending;
  const looking = kind === "settingsLooked" ? false : model.looking;
  if (!msg.ok) {
    const problem = errorOf(msg.body);
    return [
      { ...model, pending, looking, problem },
      kind === "settingsChanged" ? [loadSettings] : [],
    ];
  }
  if (pending > 0) return [{ ...model, pending, looking }, []];
  const view = msg.body as SettingsView;
  const saved = (id: string, text: string) =>
    (view.providers.find((p) => p.id === id)?.path ?? "") === text.trim();
  const paths = Object.fromEntries(
    Object.entries(model.paths).filter(([id, text]) => !saved(id, text)),
  );
  const problem = kind === "settings" ? model.problem : null;
  const usage = kind === "settingsLooked" ? [loadUsage] : [];
  return [{ ...model, view, pending, looking, paths, problem }, [showLook(view), ...usage]];
}
