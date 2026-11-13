// Written whole and renamed into place, readable by its owner only; it holds no credential.
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
  openedAt: Instant | null;
  fresh: boolean;
  steps: Partial<Record<SetupStep, StepOutcome>>;
  finishedAt: Instant | null;
  installed: boolean;
  signedIn: boolean;
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

export function nextStep(state: SetupState): SetupStep | "finished" {
  if (state.finishedAt !== null) return "finished";
  return setupSteps.find((step) => state.steps[step] === undefined) ?? "work";
}
