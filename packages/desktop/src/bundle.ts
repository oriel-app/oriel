// `pnpm desktop`: builds the desktop app, unsigned, under the gitignored
// `packages/desktop/build/` (decisions 0036 and 0039). Only macOS's
// `Oriel.app` so far; the target is a parameter so Windows and Linux can follow.
//
// The shell is Electron, from its pinned release zip, never npm: the zip is
// checked against the hash in electron.ts, renamed to Oriel, its fuses set,
// given Oriel's icon, drawn from `icon.svg` by sips and packed by iconutil,
// and given the shell's code, compiled from `shell/`. Beside it go the Node
// and Deno that mise.toml pins, copied from mise's installs, which the server
// runs on; the server's source, laid out as in the repo, with the packages it
// reaches, the fixtures it imports and the built web app; and the third-party
// packages those declare, the native TypeScript compiler among them. On macOS
// the whole app then gets an ad-hoc signature, which Apple silicon requires.
// A new build replaces the old one; the zip stays cached beside it.
//
// `--measure` marks the build so that `--measure <file>` at launch writes when
// the overview first rendered, for timing a start.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { electronZips, type Target, target, zipName, zipUrl } from "./electron.ts";
import { readFuses, setFuses } from "./fuses.ts";

export type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

// The workspace packages `from` reaches through its dependencies, itself
// included, by name.
export function workspaceClosure(from: string, manifests: ReadonlyMap<string, Manifest>): string[] {
  const found = new Set<string>();
  const visit = (name: string) => {
    if (found.has(name)) return;
    const manifest = manifests.get(name);
    if (!manifest) throw new Error(`${name} isn't a workspace package`);
    found.add(name);
    for (const [dep, range] of Object.entries(manifest.dependencies ?? {}))
      if (range.startsWith("workspace:")) visit(dep);
  };
  visit(from);
  return [...found].sort();
}

// What a server package keeps in the app: everything but tests, their
// support files and build state.
export function shipped(path: string): boolean {
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  if (parts.includes("node_modules") || parts.includes("test")) return false;
  if (/\.test\.tsx?$/.test(name) || /^testing\.tsx?$/.test(name)) return false;
  return !name.endsWith(".tsbuildinfo");
}

// The total size of the files under `dir`, not following links.
function size(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += size(path);
    else if (entry.isFile()) total += lstatSync(path).size;
  }
  return total;
}

// A package's folder as Node would find it from `from`: the nearest
// `node_modules/<name>` up the tree, through pnpm's links.
function findPackage(from: string, name: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}

function manifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
}

function mise(root: string, tool: string): string {
  return execFileSync("mise", ["where", tool], { cwd: root, encoding: "utf8" }).trim();
}

function clone(from: string, to: string, filter: (path: string) => boolean = () => true) {
  cpSync(from, to, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => filter(relative(from, source).split("\\").join("/")),
  });
}

// The fuses the shell turns off: Electron as plain Node, NODE_OPTIONS, the
// inspector's arguments, and file:// pages' extra privileges.
export const fusesOff = {
  runAsNode: false,
  nodeOptions: false,
  inspectArguments: false,
  fileProtocolPrivileges: false,
} as const;

// The helper apps inside Electron.app, by the suffix after "Electron Helper".
export const helperSuffixes = ["", " (GPU)", " (Plugin)", " (Renderer)"];

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

// The pinned zip, from the cache if its hash still matches.
async function electronZip(cache: string, on: Target): Promise<string> {
  const path = join(cache, zipName(on));
  const expected = electronZips[on];
  if (existsSync(path) && sha256(path) === expected) return path;
  console.log(`Downloading ${zipUrl(on)}…`);
  const response = await fetch(zipUrl(on));
  if (!response.ok) throw new Error(`${zipUrl(on)}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== expected)
    throw new Error(`${zipName(on)} has SHA-256 ${got}, not the pinned ${expected}`);
  mkdirSync(cache, { recursive: true });
  writeFileSync(`${path}.part`, bytes);
  renameSync(`${path}.part`, path);
  return path;
}

function plist(file: string, values: Record<string, string>, remove: string[] = []) {
  for (const [key, value] of Object.entries(values))
    execFileSync("plutil", ["-replace", key, "-string", value, file]);
  for (const key of remove) execFileSync("plutil", ["-remove", key, file]);
}

// The images a macOS .iconset holds, by the names iconutil reads: each size
// at 1x and 2x, 16 to 1024 pixels.
export function iconset(): { name: string; pixels: number }[] {
  return [16, 32, 128, 256, 512].flatMap((size) => [
    { name: `icon_${size}x${size}.png`, pixels: size },
    { name: `icon_${size}x${size}@2x.png`, pixels: size * 2 },
  ]);
}

// Oriel's icon, as `Oriel.icns` in place of Electron's, from the one SVG the
// maintainer can replace. Only macOS's own tools: sips draws, iconutil packs.
function macIcon(svg: string, resources: string, scratch: string) {
  const set = join(scratch, "Oriel.iconset");
  mkdirSync(set, { recursive: true });
  const drawn = join(scratch, "icon.png");
  execFileSync("sips", ["-s", "format", "png", svg, "--out", drawn], { stdio: "ignore" });
  for (const { name, pixels } of iconset())
    execFileSync("sips", ["-z", String(pixels), String(pixels), drawn, "--out", join(set, name)], {
      stdio: "ignore",
    });
  execFileSync("iconutil", ["-c", "icns", set, "-o", join(resources, "Oriel.icns")]);
  rmSync(join(resources, "electron.icns"));
  rmSync(scratch, { recursive: true });
}

// Electron.app from the zip, as Oriel.app: renamed, its default app gone,
// its icon Oriel's, its fuses set.
function macShell(zip: string, build: string, icon: string): string {
  const unpacked = join(build, "unpacked");
  rmSync(unpacked, { recursive: true, force: true });
  execFileSync("ditto", ["-x", "-k", zip, unpacked]);
  const app = join(build, "Oriel.app");
  renameSync(join(unpacked, "Electron.app"), app);
  const contents = join(app, "Contents");
  const resources = join(contents, "Resources");
  for (const license of ["LICENSE", "LICENSES.chromium.html"])
    renameSync(join(unpacked, license), join(resources, `electron-${license}`));
  rmSync(unpacked, { recursive: true });
  rmSync(join(resources, "default_app.asar"));
  macIcon(icon, resources, join(build, "icon"));

  renameSync(join(contents, "MacOS/Electron"), join(contents, "MacOS/Oriel"));
  plist(
    join(contents, "Info.plist"),
    {
      CFBundleIdentifier: "app.oriel.desktop",
      CFBundleName: "Oriel",
      CFBundleDisplayName: "Oriel",
      CFBundleExecutable: "Oriel",
      CFBundleIconFile: "Oriel.icns",
      CFBundleShortVersionString: "0.0.0",
      CFBundleVersion: "0",
    },
    ["ElectronAsarIntegrity"],
  );
  for (const suffix of helperSuffixes) {
    const from = join(contents, "Frameworks", `Electron Helper${suffix}.app`);
    const to = join(contents, "Frameworks", `Oriel Helper${suffix}.app`);
    renameSync(from, to);
    renameSync(
      join(to, "Contents/MacOS", `Electron Helper${suffix}`),
      join(to, "Contents/MacOS", `Oriel Helper${suffix}`),
    );
    plist(join(to, "Contents/Info.plist"), {
      CFBundleIdentifier: "app.oriel.desktop.helper",
      CFBundleName: `Oriel Helper${suffix}`,
      CFBundleDisplayName: `Oriel Helper${suffix}`,
      CFBundleExecutable: `Oriel Helper${suffix}`,
    });
  }

  const framework = join(contents, "Frameworks/Electron Framework.framework/Electron Framework");
  const binary = readFileSync(framework);
  setFuses(binary, fusesOff);
  writeFileSync(framework, binary);
  return app;
}

// The server and what it runs on, under `resources`.
function addServer(root: string, resources: string) {
  // The runtimes mise.toml pins, as mise installed them.
  const node = mise(root, "node");
  const deno = mise(root, "deno");
  mkdirSync(join(resources, "node/bin"), { recursive: true });
  cpSync(join(node, "bin/node"), join(resources, "node/bin/node"));
  cpSync(join(node, "LICENSE"), join(resources, "node/LICENSE"));
  mkdirSync(join(resources, "deno"), { recursive: true });
  cpSync(join(deno, "bin/deno"), join(resources, "deno/deno"));

  // The server's packages, laid out as in the repo, so every path between
  // them resolves as it does under `pnpm dev`.
  const server = join(resources, "server");
  mkdirSync(server, { recursive: true });
  const manifests = new Map(
    readdirSync(join(root, "packages"))
      .filter((dir) => existsSync(join(root, "packages", dir, "package.json")))
      .map((dir) => {
        const found = manifest(join(root, "packages", dir));
        return [found.name, { ...found, dir }] as const;
      }),
  );
  const packages = workspaceClosure("@oriel/server", manifests);
  writeFileSync(
    join(server, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  for (const name of packages) {
    const { dir } = manifests.get(name)!;
    clone(join(root, "packages", dir), join(server, "packages", dir), shipped);
    const link = join(server, "node_modules", name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(relative(dirname(link), join(server, "packages", dir)), link);
  }
  // The server imports the fixture loaders, which read the fixtures.
  clone(join(root, "scripts/fixtures"), join(server, "scripts/fixtures"), shipped);
  clone(join(root, "fixtures"), join(server, "fixtures"));

  // Third-party packages the server's packages declare, and theirs, each
  // where Node finds it, flat under the server's node_modules.
  const copied = new Set<string>();
  const pending = packages.flatMap((name) => {
    const { dir, dependencies = {} } = manifests.get(name)!;
    return Object.entries(dependencies)
      .filter(([, range]) => !range.startsWith("workspace:"))
      .map(([dep]) => ({ dep, from: join(root, "packages", dir), optional: false }));
  });
  for (let next = pending.pop(); next; next = pending.pop()) {
    if (copied.has(next.dep)) continue;
    const found = findPackage(next.from, next.dep);
    if (!found) {
      if (next.optional) continue;
      throw new Error(`${next.dep} isn't installed; run pnpm install`);
    }
    copied.add(next.dep);
    clone(found, join(server, "node_modules", next.dep));
    const { dependencies = {}, optionalDependencies = {} } = manifest(found);
    for (const dep of Object.keys(dependencies))
      pending.push({ dep, from: found, optional: false });
    for (const dep of Object.keys(optionalDependencies))
      pending.push({ dep, from: found, optional: true });
  }

  // Every module the server loads resolves inside the app.
  const serve = pathToFileURL(join(server, "packages/server/src/serve.ts")).href;
  execFileSync(
    join(resources, "node/bin/node"),
    ["--input-type=module", "-e", `await import(${JSON.stringify(serve)})`],
    { env: {}, stdio: "inherit" },
  );
  return [...copied].sort();
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      target: { type: "string", default: `${process.platform}-${process.arch}` },
      measure: { type: "boolean", default: false },
    },
  });
  const on = target(...(values.target.split("-") as [string, string]));
  if (!on.startsWith("darwin-") || process.platform !== "darwin") {
    console.error(`Only the macOS app is built so far, on macOS; not ${on}.`);
    process.exit(1);
  }
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const desktop = join(root, "packages/desktop");
  const build = join(desktop, "build", on);
  const started = performance.now();

  console.log("Building the web app…");
  execFileSync("pnpm", ["--filter", "@oriel/web", "build"], { cwd: root, stdio: "inherit" });

  const zip = await electronZip(join(desktop, "build/cache"), on);
  rmSync(build, { recursive: true, force: true });
  mkdirSync(build, { recursive: true });
  const app = macShell(zip, build, join(desktop, "icon.svg"));
  const resources = join(app, "Contents/Resources");

  console.log("Compiling the shell…");
  const shellCode = join(resources, "app");
  execFileSync(
    "pnpm",
    ["exec", "tsc", "-p", "packages/desktop/shell", "--noEmit", "false", "--outDir", shellCode],
    { cwd: root, stdio: "inherit" },
  );
  writeFileSync(
    join(shellCode, "package.json"),
    `${JSON.stringify(
      {
        name: "oriel",
        productName: "Oriel",
        version: "0.0.0",
        private: true,
        type: "module",
        main: "main.js",
        ...(values.measure ? { measure: true } : {}),
      },
      null,
      2,
    )}\n`,
  );

  console.log("Adding the server…");
  const thirdParty = addServer(root, resources);

  console.log("Signing, ad hoc…");
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });

  const fuses = readFuses(
    readFileSync(join(app, "Contents/Frameworks/Electron Framework.framework/Electron Framework")),
  );
  const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
  console.log(
    `Built ${relative(root, app)} in ${((performance.now() - started) / 1000).toFixed(1)} s.`,
  );
  console.log(
    `  ${mb(size(app))}: Electron ${mb(size(join(app, "Contents/Frameworks")))}, Node ${mb(size(join(resources, "node")))}, Deno ${mb(size(join(resources, "deno")))}, server ${mb(size(join(resources, "server")))} (third-party ${thirdParty.join(", ")})`,
  );
  console.log(
    `  fuses: ${Object.entries(fuses)
      .map(([name, on]) => `${name} ${on ? "on" : "off"}`)
      .join(", ")}`,
  );
  console.log(`Open it with: open ${relative(root, app)}`);
}
