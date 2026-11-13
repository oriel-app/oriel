import { type Effect, errorOf, get, post, report, type Replied } from "./http.ts";
import { lookForServers } from "./connections.ts";
import type { CliCommand, SetupView } from "./view.ts";

export type SetupScreen = "ai" | "other-ways" | "found" | "work";

export type SetupModel = {
  view: SetupView | null;
  screen: SetupScreen;
  resumed: boolean;
  sending: boolean;
  testing: boolean;
  details: boolean;
  another: boolean;
  problem: string | null;
  waiting: boolean;
  finishing: boolean;
};

export type DetailsOf = string;

export type SetupMsg =
  | { type: "commandClicked"; command: CliCommand | "check" | "cancel"; cli?: "codex" }
  | { type: "continueClicked"; anyway?: true; ai?: "codex" }
  | { type: "screenShown"; screen: SetupScreen }
  | { type: "skipClicked"; step: "ai" | "work" }
  | { type: "workDone" }
  | { type: "finished" }
  | { type: "detailsToggled" }
  | { type: "detailsCopied"; text: string; what: DetailsOf }
  | { type: "anotherClicked"; open: boolean }
  | { type: "lineCopied"; text: string }
  | { type: "lineDismissed" }
  | { type: "polled" };

export const loadSetup: Effect = get("/api/setup", { kind: "setup" });

const progress = (did: string): Effect =>
  post("/api/setup/progress", { did }, { kind: "setupProgress", did });

export const openSetup: Effect = progress("opened");

export function initSetup(): SetupModel {
  return {
    view: null,
    screen: "ai",
    resumed: false,
    sending: false,
    testing: false,
    details: false,
    another: false,
    problem: null,
    waiting: false,
    finishing: false,
  };
}

const busy = (model: SetupModel) =>
  model.view?.cli?.running != null || model.view?.codex?.running != null;

function polling(model: SetupModel, effects: Effect[] = []): [SetupModel, Effect[]] {
  if (!busy(model) || model.waiting) return [model, effects];
  return [
    { ...model, waiting: true },
    [...effects, { type: "after", ms: 1000, msg: { type: "setup", msg: { type: "polled" } } }],
  ];
}

export function updateSetup(model: SetupModel, msg: SetupMsg): [SetupModel, Effect[]] {
  switch (msg.type) {
    case "commandClicked":
      if (model.sending) return [model, []];
      return [
        { ...model, sending: true, details: false, another: false, problem: null },
        [
          post(
            "/api/setup/cli",
            { command: msg.command, ...(msg.cli ? { cli: msg.cli } : {}) },
            { kind: "setupCli" },
          ),
        ],
      ];
    case "continueClicked":
      if (model.sending) return [model, []];
      return [
        { ...model, sending: true, testing: msg.anyway !== true, details: false, problem: null },
        [
          post(
            "/api/setup/ai",
            { ai: msg.ai ?? "claude-code", ...(msg.anyway ? { anyway: true } : {}) },
            { kind: "setupAi" },
          ),
        ],
      ];
    case "screenShown":
      return [{ ...model, screen: msg.screen, details: false, problem: null }, []];
    case "skipClicked":
      return [model, [progress(msg.step === "ai" ? "skipped-ai" : "skipped-work")]];
    case "workDone":
      if (model.finishing) return [model, []];
      return [{ ...model, finishing: true }, [progress("work")]];
    case "finished":
      if (model.finishing) return [model, []];
      return [{ ...model, finishing: true }, [progress("finished")]];
    case "detailsToggled":
      return [{ ...model, details: !model.details }, []];
    case "detailsCopied":
      return [
        model,
        [
          { type: "copy", text: msg.text },
          report({ name: "first-run.details-copied", what: msg.what }),
        ],
      ];
    case "anotherClicked":
      return [{ ...model, another: msg.open }, []];
    case "lineCopied":
      return [model, [{ type: "copy", text: msg.text }]];
    case "lineDismissed":
      return [model, [progress("dismissed")]];
    case "polled":
      return [{ ...model, waiting: false }, busy(model) ? [loadSetup] : []];
  }
}

export function setupReplied(model: SetupModel, msg: Replied): [SetupModel, Effect[]] {
  const { tag } = msg;
  switch (tag.kind) {
    case "setup":
    case "setupCli":
    case "setupAi": {
      const done = tag.kind !== "setup" ? { sending: false, testing: false } : {};
      if (!msg.ok) return [{ ...model, ...done, problem: errorOf(msg.body) }, []];
      const view = msg.body as SetupView;
      const chosen = tag.kind === "setupAi" && view.firstRun?.steps.ai === "done";
      const [next, effects] = polling({
        ...model,
        ...done,
        view,
        ...(chosen ? { screen: "found" as const } : {}),
      });
      return [next, chosen ? [...effects, lookForServers] : effects];
    }
    case "setupProgress": {
      if (!msg.ok) return [{ ...model, finishing: false, problem: errorOf(msg.body) }, []];
      const view = msg.body as SetupView;
      if (tag.did === "opened") {
        const resumed = view.firstRun?.step === "work";
        return polling({
          ...model,
          view,
          resumed,
          screen: resumed ? "work" : model.screen,
        });
      }
      if (tag.did === "skipped-ai") return [{ ...model, view, screen: "work" }, []];
      if (tag.did === "skipped-work" || tag.did === "work")
        return [{ ...model, view }, [progress("finished")]];
      if (tag.did === "finished")
        return [
          { ...model, view },
          [{ type: "navigate", route: { page: "overview" }, replace: true }],
        ];
      return polling({ ...model, view });
    }
    default:
      return [model, []];
  }
}
