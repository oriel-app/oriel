#!/usr/bin/env node
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { run } from "./cli.ts";

// The address is an argument, never on a shell's command line, and never
// printed: it carries the client's ID.
function open(url: string): Promise<void> {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  fetch,
  open,
  now: Date.now,
});
