// The first run's own progress (decision 0038): each step done or skipped,
// when the setup first opened and when it finished, whether it installed or
// signed in the person's CLI, and whether the overview's one-time line was
// dismissed. Everything else is read fresh each time: the CLIs' states and
// the connected sources. The AI chosen is a setting (settings.json), not
// this. It lives in `setup.json` in the data folder, written whole and
// renamed into place, readable by its owner only, and holds no credential.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  boolean,
  type Instant,
  isInstant,
  literal,
  nullable,
  object,
  optional,
  refine,
  string,
  union,
} from "@oriel/core";

export const setupSteps = ["ai", "work"] as const;
export type SetupStep = (typeof setupSteps)[number];
export type StepOutcome = "done" | "skipped";

export type SetupState = {
  // When the setup's first screen first showed: the budget's clock starts.
  openedAt: Instant | null;
  // Whether that was on a data folder with nothing in it yet.
  fresh: boolean;
  steps: Partial<Record<SetupStep, StepOutcome>>;
  finishedAt: Instant | null;
  // What the setup did to the person's CLI, for the finished event.
  installed: boolean;
  signedIn: boolean;
  // The overview's one-time line was dismissed.
  dismissed: boolean;
};

export const blankSetup: SetupState = {
  openedAt: null,
  fresh: false,
  steps: {},
  finishedAt: null,
  installed: false,
  signedIn: false,
  dismissed: false,
};

export type SetupStore = { get(): SetupState; set(next: SetupState): void };

const instantValue = refine(string, isInstant, "an instant");
const outcome = optional(union(literal("done"), literal("skipped")));
const stateValue = object({
  openedAt: nullable(instantValue),
  fresh: boolean,
  steps: object({ ai: outcome, work: outcome }),
  finishedAt: nullable(instantValue),
  installed: boolean,
  signedIn: boolean,
  dismissed: boolean,
});

// Field by field, as settings are read: one it can't read is its blank.
function read(parsed: unknown): SetupState {
  const whole = stateValue(parsed);
  if (whole.ok) {
    const { ai, work } = whole.value.steps;
    return { ...whole.value, steps: { ...(ai ? { ai } : {}), ...(work ? { work } : {}) } };
  }
  return blankSetup;
}

export function setupFile(path: string): SetupStore & { existed: boolean } {
  let existed = true;
  let current = ((): SetupState => {
    try {
      return read(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") existed = false;
      return blankSetup;
    }
  })();
  return {
    existed,
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

export function memorySetup(initial: Partial<SetupState> = {}): SetupStore {
  let current: SetupState = { ...blankSetup, ...initial };
  return {
    get: () => current,
    set(next) {
      current = next;
    },
  };
}

// The first step neither done nor skipped, where a setup reopened before it
// finished opens; "finished" once both are and the setup has ended.
export function nextStep(state: SetupState): SetupStep | "finished" {
  if (state.finishedAt !== null) return "finished";
  return setupSteps.find((step) => state.steps[step] === undefined) ?? "work";
}
