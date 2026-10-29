// Runs `gh` as the agent token (GH_TOKEN from .env), never the maintainer's
// own login, which can edit rulesets, settings and secrets. Refuses to run
// without the token rather than fall back to that login.
import { spawnSync } from "node:child_process";

if (!process.env.GH_TOKEN) {
  console.error("GH_TOKEN is not set in .env: create the agent token described in env.example.");
  process.exit(1);
}
const result = spawnSync("gh", process.argv.slice(2), { stdio: "inherit" });
process.exitCode = result.status ?? 1;
