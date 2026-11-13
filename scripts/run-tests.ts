import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { onCi } from "./annotations.ts";

const reporters = onCi
  ? [
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      `--test-reporter=${new URL("./annotations.ts", import.meta.url).href}`,
      "--test-reporter-destination=stdout",
    ]
  : [];
const cache = fileURLToPath(new URL("../node_modules/.cache/node", import.meta.url));
const { status, signal, error } = spawnSync(
  process.execPath,
  ["--test", ...reporters, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, NODE_COMPILE_CACHE: cache },
  },
);
if (error) console.error(error);
if (signal) process.kill(process.pid, signal);
process.exitCode = status ?? 1;
