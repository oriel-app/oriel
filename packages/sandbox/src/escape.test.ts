// Escape tests (decision 0006): each tries a way out of the guest and must
// fail. Never weaken one in the PR that changes the sandbox.
//
// They run the production shim and typecheck. The typecheck isn't a
// boundary, so each script gets past it the way a hostile one would: Deno's
// own APIs untyped, through globalThis, and `// @ts-ignore` above a literal
// import. What stops them is Deno's permissions and the import map.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { RunLimits, TranscriptEntry } from "@oriel/core";
import { regionBindings } from "./real-bindings.ts";
import { createSandbox, type SandboxOptions, type SandboxRunResult } from "./sandbox.ts";

const untyped =
  "const { Deno, fetch, Worker, URL, Blob, Response, caches, TextEncoder } = globalThis as any;\n";

// Files the guest must never see. The canary is only ever in their contents.
const canary = "canary-7f3a9c";
const dir = realpathSync(mkdtempSync(join(tmpdir(), "oriel-escape-")));
const secretJson = join(dir, "secret.json");
const secretTs = join(dir, "secret.ts");
const secretTxt = join(dir, "secret.txt");
const written = join(dir, "written.txt");
writeFileSync(secretJson, JSON.stringify({ canary }));
writeFileSync(secretTs, `export const canary = "${canary}";\n`);
writeFileSync(secretTxt, `${canary}\n`);
after(() => rmSync(dir, { recursive: true, force: true }));

const limits: RunLimits = {
  wallMs: 60_000,
  maxScriptBytes: 16_384,
  maxReads: 20,
  maxMutations: 20,
  maxResultBytes: 65_536,
  maxConsoleBytes: 16_384,
};

const sandbox = createSandbox({ now: () => 0 });

async function run(
  script: string,
  caps: Partial<RunLimits> = {},
  box = sandbox,
): Promise<SandboxRunResult> {
  return box.run(untyped + script, regionBindings(), {
    limits: { ...limits, ...caps },
    signal: new AbortController().signal,
    log: () => {},
  });
}

// Runs `attempt` (a function body) inside the guest and checks that it threw
// there, and that nothing secret came back anywhere in the result.
async function mustFail(attempt: string, thrown: RegExp) {
  const result = await run(`
    try {
      const value = await (async () => {
        ${attempt}
      })();
      return { escaped: true, value: String(value) };
    } catch (error) {
      return { escaped: false, error: String(error) };
    }
  `);
  assert.ok(!JSON.stringify(result).includes(canary), "the canary got out");
  assert.equal(result.outcome, "ok", JSON.stringify(result.transcript));
  const last = result.transcript.at(-1);
  assert.equal(last?.kind, "return");
  const value = last.value as { escaped: boolean; error?: string };
  assert.equal(value.escaped, false, `escaped: ${JSON.stringify(value)}`);
  assert.match(String(value.error), thrown);
}

function errorOf(entry: TranscriptEntry | undefined) {
  assert.equal(entry?.kind, "error", JSON.stringify(entry));
  return entry.error;
}

const notCapable = /NotCapable|Requires \w+ access/;
const noImports = /Unsupported scheme "no-imports"/;
const noRemote = /--no-remote is specified|A remote specifier was requested/;

test("network: fetch", () => mustFail(`return await fetch("https://example.com/");`, notCapable));

test("network: fetch to localhost", () =>
  mustFail(`return await fetch("http://127.0.0.1:8787/");`, notCapable));

test("network: a raw socket", () =>
  mustFail(`return await Deno.connect({ hostname: "127.0.0.1", port: 8787 });`, notCapable));

test("network: listening", () => mustFail(`return Deno.listen({ port: 0 });`, notCapable));

test("network: node:net", () =>
  mustFail(
    `// @ts-ignore
     const net = await import("node:net");
     return await new Promise((resolve, reject) => {
       const socket = net.connect(8787, "127.0.0.1", () => resolve("connected"));
       socket.on("error", reject);
     });`,
    notCapable,
  ));

test("files: Deno read", () =>
  mustFail(`return Deno.readTextFileSync(${JSON.stringify(secretTxt)});`, notCapable));

test("files: node:fs read", () =>
  mustFail(
    `// @ts-ignore
     const fs = await import("node:fs");
     return fs.readFileSync(${JSON.stringify(secretTxt)}, "utf8");`,
    notCapable,
  ));

test("files: listing a directory", () =>
  mustFail(`return [...Deno.readDirSync(${JSON.stringify(dir)})].length;`, notCapable));

test("files: write", async () => {
  await mustFail(`return Deno.writeTextFileSync(${JSON.stringify(written)}, "x");`, notCapable);
  assert.equal(existsSync(written), false);
});

test("files: node:module require", () =>
  mustFail(
    `// @ts-ignore
     const { createRequire } = await import("node:module");
     return JSON.stringify(createRequire("file:///require-base.js")(${JSON.stringify(secretJson)}));`,
    notCapable,
  ));

test("env: one variable", () => mustFail(`return Deno.env.get("HOME");`, notCapable));

test("env: all of it", () => mustFail(`return JSON.stringify(Deno.env.toObject());`, notCapable));

test("env: node:process", () =>
  mustFail(`// @ts-ignore\nreturn (await import("node:process")).default.env.HOME;`, notCapable));

test("os information", () => mustFail(`return Deno.hostname();`, notCapable));

test("subprocess: Deno.Command", () =>
  mustFail(
    `return new Deno.Command("/bin/echo", { args: ["hi"] }).outputSync().code;`,
    notCapable,
  ));

test("subprocess: node:child_process", () =>
  mustFail(
    `// @ts-ignore
     const { execSync } = await import("node:child_process");
     return String(execSync("echo hi"));`,
    notCapable,
  ));

test("FFI", () => mustFail(`return Deno.dlopen("libc.so.6", {});`, notCapable));

// The script becomes a function at run time, so even a literal specifier in it
// is a run-time import: the import map refuses `file:`, and read permission
// would too (deno.test.ts shows Deno's own behavior).
test("import(): a literal file path, as JSON", () =>
  mustFail(
    `// @ts-ignore\nreturn JSON.stringify(await import(${JSON.stringify(secretJson)}, { with: { type: "json" } }));`,
    noImports,
  ));

test("import(): a literal file: URL", () =>
  mustFail(`// @ts-ignore\nreturn JSON.stringify(await import("file://${secretTs}"));`, noImports));

test("import(): a literal relative path", () =>
  mustFail(
    `// @ts-ignore\nreturn JSON.stringify(await import("${"../".repeat(24)}${secretTs.slice(1)}"));`,
    noImports,
  ));

test("import(): a computed file: URL", () =>
  mustFail(
    `const url = ["file:/", ${JSON.stringify(secretTs)}].join("/");
     return JSON.stringify(await import(url));`,
    /no-imports|NotCapable|Requires read access/,
  ));

// A static import would be loaded before anything runs, outside
// `--deny-read`. The script can't hold one: it is compiled on the host as a
// function body and refused before Deno starts.
async function refusedBeforeDeno(script: string) {
  const result = await run(script);
  assert.ok(!JSON.stringify(result).includes(canary), "the canary got out");
  assert.equal(result.outcome, "threw");
  assert.equal(errorOf(result.transcript.at(-1)).phase, "typecheck");
  assert.equal(result.coldStartMs, null);
}

test("import: a static import at the top of the script", () =>
  refusedBeforeDeno(
    `import secret from ${JSON.stringify(secretJson)} with { type: "json" };\nreturn secret;`,
  ));

test("import: a static import that closes the script's function first", () =>
  refusedBeforeDeno(
    `});\nimport secret from ${JSON.stringify(secretJson)} with { type: "json" };\nconsole.log(JSON.stringify(secret));\n(async () => {`,
  ));

test("import: an export that closes the script's function first", () =>
  refusedBeforeDeno(`});\nexport * from ${JSON.stringify(secretTs)};\n(async () => {`));

test("import(): a literal https: URL", () =>
  mustFail(`// @ts-ignore\nreturn await import("https://deno.land/std/version.ts");`, noRemote));

test("import(): a computed https: URL", () =>
  mustFail(
    `const host = "deno.land"; return await import("https://" + host + "/x.ts");`,
    noRemote,
  ));

test("import(): jsr: and npm: packages", async () => {
  await mustFail(`// @ts-ignore\nreturn await import("jsr:@std/path");`, noRemote);
  await mustFail(`// @ts-ignore\nreturn await import("npm:left-pad");`, /--no-npm/);
});

test("Function constructor: reading a file", () =>
  mustFail(
    `return new Function("return Deno.readTextFileSync(" + ${JSON.stringify(JSON.stringify(secretTxt))} + ")")();`,
    notCapable,
  ));

test("Function constructor: through a prototype chain", () =>
  mustFail(
    `return [].constructor.constructor("return globalThis.Deno.env.toObject()")();`,
    notCapable,
  ));

test("Function constructor: an import the static scan can't see", () =>
  mustFail(
    `return JSON.stringify(await new Function("return import('file://${secretTs}')")());`,
    /no-imports|NotCapable|Requires read access/,
  ));

test("indirect eval: an import", () =>
  mustFail(
    `const indirect = eval;
     return JSON.stringify(await indirect("import(" + ${JSON.stringify(JSON.stringify(secretJson))} + ", { with: { type: 'json' } })"));`,
    /no-imports|NotCapable|Requires read access/,
  ));

test("a worker inherits the denials", () =>
  mustFail(
    `const source = "postMessage(Deno.readTextFileSync(" + ${JSON.stringify(JSON.stringify(secretTxt))} + "))";
     const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })), { type: "module" });
     try {
       return await new Promise((resolve, reject) => {
         worker.onmessage = (event: any) => resolve(event.data);
         worker.onerror = (event: any) => {
           event.preventDefault();
           reject(new Error(event.message));
         };
       });
     } finally {
       worker.terminate();
     }`,
    notCapable,
  ));

test("an infinite loop is killed at the wall time", async () => {
  const result = await run(`for (;;) {}`, { wallMs: 1_000 });
  assert.equal(result.outcome, "timeout");
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "limit");
  assert.match(error.message, /wall time of 1000 ms/);
});

test("a promise that never settles ends at the wall time", async () => {
  const result = await run(`await new Promise(() => {});`, { wallMs: 1_000 });
  assert.equal(result.outcome, "timeout");
  assert.match(errorOf(result.transcript.at(-1)).message, /wall time of 1000 ms/);
});

test("an output flood through console.log", async () => {
  const result = await run(`for (;;) console.log("x".repeat(1_000));`, {
    maxConsoleBytes: 100_000,
  });
  assert.equal(result.outcome, "limit");
  assert.match(errorOf(result.transcript.at(-1)).message, /console output passed 100000 bytes/);
});

test("an output flood straight to stdout, with no newline", async () => {
  const result = await run(`for (;;) Deno.stdout.writeSync(new Uint8Array(1 << 20).fill(120));`);
  assert.equal(result.outcome, "limit");
  assert.match(
    errorOf(result.transcript.at(-1)).message,
    /a line from the script was over \d+ bytes/,
  );
});

test("an output flood to stderr", async () => {
  const result = await run(`for (;;) Deno.stderr.writeSync(new Uint8Array(1 << 16).fill(120));`);
  assert.equal(result.outcome, "limit");
  assert.match(errorOf(result.transcript.at(-1)).message, /more than \d+ bytes to stderr/);
});

test("an output flood of empty log lines", async () => {
  const result = await run(`for (;;) console.log();`, { maxConsoleBytes: 10_000 });
  assert.equal(result.outcome, "limit");
  // Each empty line costs its newline: 10,000 fit, then the cap.
  assert.equal(result.transcript.length, 10_001);
});

test("an output flood of empty log lines written straight to stdout", async () => {
  const result = await run(
    `const lines = new TextEncoder().encode('{"kind":"log","text":""}\\n'.repeat(1_000));\nfor (;;) Deno.stdout.writeSync(lines);`,
    { maxConsoleBytes: 10_000 },
  );
  assert.equal(result.outcome, "limit");
  assert.match(errorOf(result.transcript.at(-1)).message, /console output passed 10000 bytes/);
});

test("disk: the Cache API can't fill the disk", () =>
  mustFail(
    `const cache = await caches.open("flood");
     for (let i = 0; i < 64; i++) await cache.put("http://x/" + i, new Response(new Uint8Array(16 << 20)));
     return "wrote 1 GB";`,
    /cache storage directory/,
  ));

// The host's own JSON.stringify is recursive; a value this deep would
// overflow it in the host process.
const deepLine = (prefix: string, suffix: string) =>
  `const deep = "[".repeat(100_000) + "]".repeat(100_000);\nDeno.stdout.writeSync(new TextEncoder().encode('${prefix}' + deep + '${suffix}\\n'));\nawait new Promise(() => {});`;

test("a deeply nested return value", async () => {
  const result = await run(deepLine('{"kind":"done","value":', "}"));
  assert.equal(result.outcome, "threw");
  assert.match(errorOf(result.transcript.at(-1)).message, /nests deeper than 64 levels/);
});

test("deeply nested write arguments", async () => {
  const result = await run(
    deepLine('{"kind":"write","fn":"jira.setEstimate","args":', ',"ref":null}'),
  );
  assert.equal(result.outcome, "threw");
  assert.equal(result.mutations.length, 0);
  assert.match(errorOf(result.transcript.at(-1)).message, /nests deeper than 64 levels/);
});

// Error text is the guest's. A pattern that backtracks on it would hold the
// host's event loop, and with it the wall-time kill and the memory watchdog.
test("an error message shaped to make the host's error cleanup slow", async () => {
  const result = await run(`throw "eval at ".repeat(120_000);`);
  assert.equal(result.outcome, "threw");
  assert.ok(errorOf(result.transcript.at(-1)).message.length <= 4_001);
});

// Node's type stripper is SWC built as WebAssembly. A deep enough script
// overflows its stack and can break it for the rest of its thread. Deep
// brackets are refused before it runs; other deep shapes reach it, so it runs
// in a worker that is replaced after any refusal.
async function strippingSurvives(deep: string) {
  for (let i = 0; i < 3; i++) {
    const result = await run(deep);
    assert.equal(result.outcome, "threw");
    assert.equal(errorOf(result.transcript.at(-1)).phase, "typecheck");
  }
  const result = await run(`const n: number = 2;\nreturn n;`);
  assert.deepEqual(result.transcript, [{ kind: "return", value: 2 }]);
  // The host's own stripper, which loads its `.ts` files, is untouched.
  assert.doesNotThrow(() => stripTypeScriptTypes("const n: number = 2;", { mode: "strip" }));
}

test("deeply nested brackets can't break the type stripper", () =>
  strippingSurvives(`return ${"(".repeat(8_000)}1${")".repeat(8_000)};`));

test("chained arrows that overflow the type stripper can't break later runs", () =>
  strippingSurvives(`return ${"a=>".repeat(1_500)}1;`));

test("a memory flood on the V8 heap", async () => {
  const result = await run(
    `const keep: unknown[] = [];\nfor (;;) keep.push(new Array(100_000).fill({ n: keep.length }));`,
    {},
    createSandbox({ now: () => 0, heapMb: 64 }),
  );
  assert.equal(result.outcome, "limit");
  assert.match(
    errorOf(result.transcript.at(-1)).message,
    /ran out of memory \(the heap limit is 64 MB\)/,
  );
});

test("a memory flood outside the heap, in array buffers", async () => {
  const result = await run(
    `const keep: Uint8Array[] = [];\nfor (;;) keep.push(new Uint8Array(16 << 20).fill(1));`,
    {},
    createSandbox({ now: () => 0, heapMb: 64, maxRssMb: 256, memoryPollMs: 10 }),
  );
  assert.equal(result.outcome, "limit");
  assert.match(errorOf(result.transcript.at(-1)).message, /MB of memory; the limit is 256 MB/);
});

const sendRaw = (line: string) =>
  `Deno.stdout.writeSync(new TextEncoder().encode(${JSON.stringify(line)} + "\\n"));\nawait new Promise(() => {});`;

test("a guest line that isn't JSON", async () => {
  const result = await run(sendRaw("rm -rf /"));
  assert.equal(result.outcome, "threw");
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "runtime");
  assert.match(error.message, /isn't a sandbox message: it isn't JSON/);
});

test("a guest line with an unknown kind", async () => {
  const result = await run(sendRaw(JSON.stringify({ kind: "exec", command: "rm -rf /" })));
  assert.equal(result.outcome, "threw");
  assert.match(errorOf(result.transcript.at(-1)).message, /"exec" message with the wrong shape/);
});

test("a guest line with a known kind and the wrong shape", async () => {
  const result = await run(sendRaw(JSON.stringify({ kind: "read", id: "1", fn: "x", args: [] })));
  assert.equal(result.outcome, "threw");
  assert.match(errorOf(result.transcript.at(-1)).message, /"read" message with the wrong shape/);
});

test("an oversized guest line", async () => {
  const options: SandboxOptions = { now: () => 0, maxLineBytes: 1_000 };
  const result = await run(
    `console.log("x".repeat(2_000));\nreturn 1;`,
    { maxResultBytes: 10 },
    createSandbox(options),
  );
  assert.equal(result.outcome, "limit");
  assert.match(errorOf(result.transcript.at(-1)).message, /over 1034 bytes/);
});
