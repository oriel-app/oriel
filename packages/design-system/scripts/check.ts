// The checks that need no browser, for Oriel's `pnpm check`: the guide's own,
// and those that judge Oriel's window.css and packages/web/src by name.
// `node scripts/check.ts references` runs only the checks it names. What
// each one checks is in scripts/checks.ts; `pnpm ui-check` adds the rest.
import { checks, runChecks } from "./checks.ts";

process.exitCode = (await runChecks(
  checks.filter((c) => !c.browser),
  process.argv.slice(2),
))
  ? 0
  : 1;
