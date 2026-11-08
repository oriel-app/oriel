// The desktop app's first run (decisions 0038 and 0059): two steps, Your AI
// and then Your work, which sees what Oriel found in the person's agent and
// what it reads, then the overview. What the server knows, the Claude Code
// and Codex rows and the first run's progress, comes from one view, which
// Settings' CLI rows share. While a command runs, the page asks for it again
// each second. Which screen shows is the page's own.
import { type Effect, errorOf, get, post, report, type Replied } from "./http.ts";
import { lookForServers } from "./connections.ts";
import type { CliCommand, SetupView } from "./view.ts";

export type SetupScreen =
  // Your AI; an API key in its place; Claude Code's own way, in Terminal.
  | "ai"
  | "key"
  | "other-ways"
  // Your work: what Oriel found in the person's agent (decision 0059); then
  // what it reads.
  | "found"
  | "work";

export type SetupModel = {
  view: SetupView | null;
  screen: SetupScreen;
  // The setup opened at its second step, as when it was reopened halfway.
  resumed: boolean;
  // A command or the AI's choice sent and not yet answered.
  sending: boolean;
  // The test turn is running.
  testing: boolean;
  // An API key typed and not yet sent, and why the last one wasn't taken.
  key: string;
  keyProblem: string | null;
  // Show details is open on the row's failure.
  details: boolean;
  // Use another account: the warning before it signs in again.
  another: boolean;
  // Why the last request didn't work, for the page.
  problem: string | null;
  // A request for the view again is due.
  waiting: boolean;
  // The first run's end was asked for.
  finishing: boolean;
};

// A command's details, by what it was.
export type DetailsOf = string;

export type SetupMsg =
  // A command for Claude Code, or for Codex (decision 0048).
  | { type: "commandClicked"; command: CliCommand | "check" | "cancel"; cli?: "codex" }
  // Continue with Claude Code, or Codex, which runs the test turn first;
  // `anyway`, past a usage limit.
  | { type: "continueClicked"; anyway?: true; ai?: "codex" }
  | { type: "keyTyped"; text: string }
  | { type: "keySaved" }
  | { type: "screenShown"; screen: SetupScreen }
  | { type: "skipClicked"; step: "ai" | "work" }
  | { type: "workDone" }
  | { type: "finished" }
  | { type: "detailsToggled" }
  | { type: "detailsCopied"; text: string; what: DetailsOf }
  | { type: "anotherClicked"; open: boolean }
  // A line to type in Terminal, copied.
  | { type: "lineCopied"; text: string }
  // The overview's one-time line, dismissed.
  | { type: "lineDismissed" }
  // Time to ask for the view again, while something runs.
  | { type: "polled" };

export const loadSetup: Effect = get("/api/setup", { kind: "setup" });

const progress = (did: string): Effect =>
  post("/api/setup/progress", { did }, { kind: "setupProgress", did });

// Entering the first run: its clock starts, once, and Claude Code is looked
// for again.
export const openSetup: Effect = progress("opened");

export function initSetup(): SetupModel {
  return {
    view: null,
    screen: "ai",
    resumed: false,
    sending: false,
    testing: false,
    key: "",
    keyProblem: null,
    details: false,
    another: false,
    problem: null,
    waiting: false,
    finishing: false,
  };
}

// Whether something runs that the page shows as it goes.
const busy = (model: SetupModel) =>
  model.view?.cli?.running != null || model.view?.codex?.running != null;

// Asks for the view again in a second, while something runs, once at a time.
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
    case "keyTyped":
      return [{ ...model, key: msg.text, keyProblem: null }, []];
    case "keySaved": {
      const key = model.key.trim();
      if (model.sending || key === "") return [model, []];
      // Kept through Settings' own route; the page forgets it once it's sent.
      return [
        { ...model, sending: true, key: "", keyProblem: null },
        [post("/api/settings/key", { key }, { kind: "setupKey" })],
      ];
    }
    case "screenShown":
      return [{ ...model, screen: msg.screen, details: false, problem: null }, []];
    case "skipClicked":
      return [model, [progress(msg.step === "ai" ? "skipped-ai" : "skipped-work")]];
    // What Oriel reads is read by now: a source server's first sync reads as
    // its kind turns on, and one on this Mac as it's picked.
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

// A reply about the first run. Its view is the whole state, so each one
// that brings it replaces it, and asks again while something runs.
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
      // With the AI set up, Oriel looks in it for the person's servers.
      const [next, effects] = polling({
        ...model,
        ...done,
        view,
        ...(chosen ? { screen: "found" as const } : {}),
      });
      return [next, chosen ? [...effects, lookForServers] : effects];
    }
    case "setupKey":
      if (!msg.ok) return [{ ...model, sending: false, keyProblem: errorOf(msg.body) }, []];
      // Kept: it becomes the AI the first run continues with.
      return [model, [post("/api/setup/ai", { ai: "api" }, { kind: "setupAi" })]];
    case "setupProgress": {
      if (!msg.ok) return [{ ...model, finishing: false, problem: errorOf(msg.body) }, []];
      const view = msg.body as SetupView;
      // Opened: at the first step neither done nor skipped.
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
      // The first run is over: the overview, which it never comes back to.
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
