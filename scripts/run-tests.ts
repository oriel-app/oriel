// `node --test` with Node's compile cache, which keeps each file's type
// stripping and compiled code between runs. `pnpm test` runs it from the
// root, and each package's `check` from the package, so every test run
// shares the one cache under the root's node_modules/.cache.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cache = fileURLToPath(new URL("../node_modules/.cache/node", import.meta.url));
const { status, signal, error } = spawnSync(
  process.execPath,
  ["--test", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, NODE_COMPILE_CACHE: cache },
  },
);
if (error) console.error(error);
if (signal) process.kill(process.pid, signal);
process.exitCode = status ?? 1;
