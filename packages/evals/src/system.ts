import type { SystemUnderTest } from "./runner.ts";

// What `pnpm evals` and `evals:ci` run each case through: the agent loop,
// once it exists. Until then they only validate the cases.
export const system: SystemUnderTest | null = null;
