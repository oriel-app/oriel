// `pnpm ui-check [check…]`; ORIEL=<path> judges another checkout than this one:
//   ORIEL=../my-story pnpm ui-check
import { execFileSync } from "node:child_process";
import { oriel, root } from "../src/oriel.ts";
import { checks, runChecks } from "./checks.ts";

const git = (...args: string[]) => {
  try {
    return execFileSync("git", ["-C", oriel, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};
const at = [git("rev-parse", "--abbrev-ref", "HEAD"), git("rev-parse", "--short", "HEAD")]
  .filter(Boolean)
  .join(" at ");
console.log(`Checking the window in ${oriel}${at ? ` (${at})` : ""} against ${root}.\n`);

const passed = await runChecks(checks, process.argv.slice(2));
if (!passed)
  console.log(
    `The guide's pages and UNDOCUMENTED.md are in ${root}; pnpm -s ds where <name> says where a name is now.`,
  );
process.exitCode = passed ? 0 : 1;
