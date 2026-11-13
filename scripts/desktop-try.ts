// `pnpm desktop:try <scenario> [--show] [--build]`, or `pnpm desktop:try stop`.
// See packages/desktop/README.md.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { claudeCodeMinVersion } from "../packages/agent/src/claude-code.ts";
import { target } from "../packages/desktop/src/electron.ts";
import { defaultSettings, type Settings } from "../packages/server/src/settings.ts";
import type { StandIn } from "./stand-in-claude.ts";

export const scenarios = {
  fresh: null,
  "no-cli": "none",
  "signed-out": { version: claudeCodeMinVersion, signedIn: false, signIn: "works" },
  "too-old": { version: "2.1.0", signedIn: true, signIn: "works" },
  "sign-in-fails": { version: claudeCodeMinVersion, signedIn: false, signIn: "fails" },
} as const satisfies Record<string, Omit<StandIn, "updatesTo"> | "none" | null>;
export type Scenario = keyof typeof scenarios;

export function scenarioSettings(home: string): Settings {
  const paths: Record<string, string> = {
    "claude-code": join(home, ".local/bin/claude"),
    codex: join(home, ".local/bin/codex"),
  };
  return {
    ...defaultSettings,
    providers: defaultSettings.providers.map((p) =>
      paths[p.kind] ? { ...p, path: paths[p.kind]! } : p,
    ),
  };
}

export function standInScript(node: string, script: string, folder: string): string {
  for (const path of [node, script, folder])
    if (path.includes("'")) throw new Error(`a path with a quote in it: ${path}`);
  return `#!/bin/sh\nexec '${node}' '${script}' '${folder}' "$@"\n`;
}

export function stale(listed: readonly string[], built: number, mtime: (path: string) => number) {
  return listed.some((path) => {
    try {
      return mtime(path) > built;
    } catch {
      return true;
    }
  });
}

export function findPid(table: string, executable: string): number | null {
  for (const row of table.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(row);
    if (match && (match[2] === executable || match[2]!.startsWith(`${executable} `)))
      return Number(match[1]);
  }
  return null;
}

type Running = { pid: number; folder: string; executable: string };

const root = fileURLToPath(new URL("../", import.meta.url));
const stateFile = join(root, ".oriel", "desktop-try.json");

const commandOf = (pid: number) => {
  try {
    return execFileSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
};
const isOurs = (running: Running) => {
  const command = commandOf(running.pid);
  return command === running.executable || !!command?.startsWith(`${running.executable} `);
};

async function stop() {
  if (!existsSync(stateFile)) return console.log("Nothing to stop.");
  const running = JSON.parse(readFileSync(stateFile, "utf8")) as Running;
  if (isOurs(running)) {
    process.kill(running.pid, "SIGTERM");
    const deadline = Date.now() + 10_000;
    while (isOurs(running) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    if (isOurs(running)) process.kill(running.pid, "SIGKILL");
    console.log(`Stopped ${running.pid}.`);
  } else console.log(`${running.pid} had already stopped.`);
  rmSync(running.folder, { recursive: true, force: true });
  rmSync(stateFile, { force: true });
}

export function build(force: boolean): string {
  const app = join(
    root,
    "packages/desktop/build",
    target(process.platform, process.arch),
    "Oriel.app",
  );
  const stamp = join(app, "Contents/Resources/app/package.json");
  const listed = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "packages",
      "fixtures",
      "mise.toml",
      "pnpm-lock.yaml",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean);
  if (
    force ||
    !existsSync(stamp) ||
    stale(listed, statSync(stamp).mtimeMs, (path) => statSync(join(root, path)).mtimeMs)
  ) {
    console.log("Building the app…");
    // On the Node mise.toml pins, which the build insists on.
    execFileSync("mise", ["exec", "--", "node", "packages/desktop/src/bundle.ts"], {
      cwd: root,
      stdio: "inherit",
    });
  }
  return app;
}

async function launch(scenario: Scenario, show: boolean, force: boolean) {
  if (existsSync(stateFile)) {
    const running = JSON.parse(readFileSync(stateFile, "utf8")) as Running;
    if (isOurs(running)) {
      console.error(`A try is running already, pid ${running.pid}: pnpm desktop:try stop`);
      process.exit(1);
    }
    await stop();
  }
  const app = build(force);
  // As the process table names it: macOS's temp folder is under a link.
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "oriel-try-")));
  const copy = join(folder, "Oriel.app");
  execFileSync("ditto", [app, copy]);
  const data = join(folder, "data");
  mkdirSync(data, { mode: 0o700 });

  const env: string[] = [];
  const setup = scenarios[scenario];
  if (setup !== null) {
    const home = join(folder, "home");
    const bin = join(home, ".local/bin");
    mkdirSync(bin, { recursive: true, mode: 0o700 });
    env.push("--env", `HOME=${home}`);
    writeFileSync(
      join(data, "settings.json"),
      `${JSON.stringify(scenarioSettings(home), null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    if (setup !== "none") {
      const standIn = join(folder, "stand-in");
      mkdirSync(standIn);
      const state: StandIn = { ...setup, updatesTo: claudeCodeMinVersion };
      writeFileSync(join(standIn, "state.json"), JSON.stringify(state));
      writeFileSync(
        join(bin, "claude"),
        standInScript(process.execPath, join(root, "scripts/stand-in-claude.ts"), standIn),
        { mode: 0o755 },
      );
    }
  }

  const args = show
    ? ["--data", data, "--launch-file"]
    : ["--background", "--data", data, "--launch-file"];
  execFileSync("open", ["-n", ...(show ? [] : ["-g", "-j"]), ...env, copy, "--args", ...args]);

  const executable = join(copy, "Contents/MacOS/Oriel");
  const launchFile = join(data, "Shell/launch.json");
  let pid: number | null = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !(pid && existsSync(launchFile))) {
    pid ??= findPid(
      execFileSync("/bin/ps", ["-A", "-o", "pid=,command="], { encoding: "utf8" }),
      executable,
    );
    await new Promise((r) => setTimeout(r, 200));
  }
  if (pid) {
    mkdirSync(join(root, ".oriel"), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ pid, folder, executable } satisfies Running));
  }
  const log = join(data, "Logs/server.log");
  if (!pid || !existsSync(launchFile)) {
    console.error(
      pid
        ? `Oriel started, pid ${pid}, but its server didn't. Its log: ${log}`
        : "Oriel didn't start.",
    );
    if (pid) console.error("pnpm desktop:try stop stops it.");
    process.exit(1);
  }
  const { url, cookie } = JSON.parse(readFileSync(launchFile, "utf8")) as {
    url: string;
    cookie: string;
  };
  const headers = join(folder, "headers");
  writeFileSync(headers, `cookie: ${cookie}\norigin: ${new URL(url).origin}\n`, { mode: 0o600 });
  console.log(`Oriel is running ${show ? "in its window" : "in the background"}: ${scenario}`);
  console.log(`  url      ${url}`);
  console.log(`  pid      ${pid}`);
  console.log(`  cookie   ${launchFile}`);
  console.log(`  data     ${data}`);
  console.log(`  log      ${log}`);
  console.log(`  try      curl -s -H @${headers} ${url}api/setup`);
  console.log("  stop     pnpm desktop:try stop");
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      show: { type: "boolean", default: false },
      build: { type: "boolean", default: false },
    },
  });
  const [what] = positionals;
  if (process.platform !== "darwin") {
    console.error("Only the macOS app is built so far.");
    process.exit(1);
  }
  if (what === "stop") await stop();
  else if (what && Object.hasOwn(scenarios, what))
    await launch(what as Scenario, values.show, values.build);
  else {
    console.error(
      `pnpm desktop:try <${Object.keys(scenarios).join("|")}> [--show] [--build], or pnpm desktop:try stop`,
    );
    process.exit(2);
  }
}
