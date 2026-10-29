// What Deno itself does with imports under decision 0006's flags alone: no
// import map, no host. These pin down why the script is sent as data, never as
// module source. If one starts failing after a Deno upgrade, Deno's behavior
// changed: re-read deno.ts, compiler.ts and start.ts before changing anything.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { denoArgs, denoEnv, denyAll, findDeno, importMap } from "./deno.ts";

const deno = findDeno();
const canary = "canary-41c2e8";
const root = realpathSync(mkdtempSync(join(tmpdir(), "oriel-deno-")));
const secretTs = join(root, "secret.ts");
const secretJson = join(root, "secret.json");
writeFileSync(secretTs, `export const canary = "${canary}";\n`);
writeFileSync(secretJson, JSON.stringify({ canary }));
after(() => rmSync(root, { recursive: true, force: true }));

let runs = 0;

// Runs `source` as the entry module, with the flags from decision 0006 and
// nothing else unless `withImportMap`.
function entry(source: string, withImportMap = false) {
  const dir = join(root, `run-${++runs}`);
  const work = join(dir, "work");
  mkdirSync(work, { recursive: true });
  const path = join(dir, "entry.ts");
  writeFileSync(path, source);
  const map = join(dir, "imports.json");
  writeFileSync(map, importMap(pathToFileURL(path).href));
  const args = withImportMap
    ? denoArgs({ entry: path, importMap: map, heapMb: 64 })
    : ["run", ...denyAll, path];
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(deno, args, { cwd: work, env: denoEnv(join(dir, "deno")) });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("--deny-read doesn't stop a static import of a local file", async () => {
  const { out } = await entry(
    `import { canary } from ${JSON.stringify(secretTs)};\nconsole.log(canary);\n`,
  );
  assert.match(out, new RegExp(canary));
});

test("--deny-read doesn't stop a static JSON import", async () => {
  const { out } = await entry(
    `import secret from ${JSON.stringify(secretJson)} with { type: "json" };\nconsole.log(JSON.stringify(secret));\n`,
  );
  assert.match(out, new RegExp(canary));
});

test("--deny-read doesn't stop a literal import() in module source", async () => {
  const { out } = await entry(
    `const secret = await import(${JSON.stringify(pathToFileURL(secretTs).href)});\nconsole.log(secret.canary);\n`,
  );
  assert.match(out, new RegExp(canary));
});

test("--deny-read stops import() of a file: URL inside an AsyncFunction body", async () => {
  const body = `return (await import(${JSON.stringify(pathToFileURL(secretTs).href)})).canary;`;
  const { out } = await entry(
    `const AsyncFunction = (async () => {}).constructor;\ntry {\n  console.log(await new AsyncFunction(${JSON.stringify(body)})());\n} catch (error) {\n  console.log(String(error));\n}\n`,
  );
  assert.doesNotMatch(out, new RegExp(canary));
  assert.match(out, /Requires read access/);
});

test("--deny-read stops a JSON import inside an AsyncFunction body", async () => {
  const body = `return JSON.stringify((await import(${JSON.stringify(secretJson)}, { with: { type: "json" } })).default);`;
  const { out } = await entry(
    `const AsyncFunction = (async () => {}).constructor;\ntry {\n  console.log(await new AsyncFunction(${JSON.stringify(body)})());\n} catch (error) {\n  console.log(String(error));\n}\n`,
  );
  assert.doesNotMatch(out, new RegExp(canary));
  assert.match(out, /Requires read access/);
});

test("the import map refuses the static import that --deny-read lets through", async () => {
  const { code, out } = await entry(
    `import { canary } from ${JSON.stringify(secretTs)};\nconsole.log(canary);\n`,
    true,
  );
  assert.notEqual(code, 0);
  assert.doesNotMatch(out, new RegExp(canary));
  assert.match(out, /Unsupported scheme "no-imports"/);
});
