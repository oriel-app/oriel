// Runs `gh` as the agent token (decision 0014): a fine-grained token read from
// .env and nothing else from it, a fresh gh config with no aliases, extensions
// or saved logins, and no subcommands that print tokens, run code or touch
// secrets. Use `pnpm -s github …`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const refused = ["auth", "alias", "extension", "config", "secret", "variable"];

export function prepare(
  args: readonly string[],
  envFile: string | null,
): { error: string } | { args: string[]; token: string } {
  const token = envFile ? parseEnv(envFile).GH_TOKEN : undefined;
  if (!token?.startsWith("github_pat_")) {
    return {
      error: "GH_TOKEN in .env must be the fine-grained agent token described in env.example.",
    };
  }
  const command = args[0];
  if (!command || refused.includes(command)) {
    return {
      error: `pnpm github refuses ${JSON.stringify(command ?? "")}: ${refused.join(", ")} stay with the maintainer.`,
    };
  }
  return { args: [...args], token };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const envPath = `${root}.env`;
  const prepared = prepare(
    process.argv.slice(2),
    existsSync(envPath) ? readFileSync(envPath, "utf8") : null,
  );
  if ("error" in prepared) {
    console.error(prepared.error);
    process.exit(1);
  }
  const configDir = `${root}node_modules/.cache/oriel-gh`;
  mkdirSync(configDir, { recursive: true });
  const result = spawnSync("gh", prepared.args, {
    stdio: "inherit",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      GH_TOKEN: prepared.token,
      GH_HOST: "github.com",
      GH_CONFIG_DIR: configDir,
      GH_PROMPT_DISABLED: "1",
    },
  });
  if (result.error) console.error(`gh failed to start: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
}
