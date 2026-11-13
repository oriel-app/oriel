// `node scripts/check.ts [check…]` runs only the checks named; `pnpm ui-check` adds the
// browser ones.
import { checks, runChecks } from "./checks.ts";

process.exitCode = (await runChecks(
  checks.filter((c) => !c.browser),
  process.argv.slice(2),
))
  ? 0
  : 1;
