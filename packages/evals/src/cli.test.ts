import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ulid } from "@oriel/core";
import type { Fetch } from "./anthropic.ts";
import { defaults, type Io, main, modelKey, parseCommand, usage } from "./cli.ts";
import { streamed, tempDir } from "./testing.ts";

// A temp directory by its real path: on macOS the temp root is under a link
// (/var), and a .env is read only with no link on the way to it.
const realDir = (t: TestContext) => pathToFileURL(`${realpathSync(fileURLToPath(tempDir(t)))}/`);

const a = ulid(Date.UTC(2026, 9, 28), new Uint8Array(10));
const b = ulid(Date.UTC(2026, 9, 29), new Uint8Array(10));

test("no verb runs live, with default models and an optional baseline", () => {
  assert.deepEqual(parseCommand([]), {
    command: "live",
    model: defaults.model,
    judge: defaults.judge,
    baseline: null,
  });
  assert.deepEqual(
    parseCommand(["--model", "claude-sonnet-5-5", "--judge", "claude-opus-5-5", "--baseline", a]),
    {
      command: "live",
      model: "claude-sonnet-5-5",
      judge: "claude-opus-5-5",
      baseline: a,
    },
  );
});

test("replay and compare take what they need and nothing else", () => {
  assert.deepEqual(parseCommand(["replay"]), {
    command: "replay",
    model: defaults.model,
    judge: defaults.judge,
  });
  assert.deepEqual(parseCommand(["compare", a, b]), {
    command: "compare",
    baseline: a,
    candidate: b,
  });
  for (const args of [
    ["replay", "--baseline", a],
    ["compare", a],
    ["compare", a, "../../etc"],
    ["compare", a, b, "--model", "claude-opus-5-5"],
    ["--baseline", "last-week"],
    ["--verbose"],
    ["record"],
  ]) {
    assert.deepEqual(parseCommand(args), { error: usage }, args.join(" "));
  }
});

test("the judge can't be the model under test, by any of its names", () => {
  for (const judge of [defaults.model, `${defaults.model}-20261001`]) {
    assert.deepEqual(parseCommand(["--judge", judge]), {
      error: "the judge model must differ from the model under test",
    });
  }
});

test("--env names a .env for a live round only, and can't be empty", () => {
  assert.deepEqual(parseCommand(["--env", "/elsewhere/.env"]), {
    command: "live",
    model: defaults.model,
    judge: defaults.judge,
    baseline: null,
    env: "/elsewhere/.env",
  });
  for (const args of [
    ["--env", ""],
    ["--env", " "],
    ["--env"],
    ["replay", "--env", "/elsewhere/.env"],
    ["compare", a, b, "--env", "/elsewhere/.env"],
  ]) {
    assert.deepEqual(parseCommand(args), { error: usage }, args.join(" "));
  }
});

// A fake key, and a fake token beside it that must never be read.
const fakeKey = "sk-ant-fake-0123456789abcdef";
const fakeToken = "github_pat_fake0123456789abcdef";
const envText = `GH_TOKEN=${fakeToken}\nANTHROPIC_API_KEY=${fakeKey}\n`;

function writeEnv(dir: URL, text = envText): string {
  const path = fileURLToPath(new URL(".env", dir));
  writeFileSync(path, text);
  return path;
}

test("the model key comes from the named .env, which must be a regular file with one link", async (t) => {
  const dir = realDir(t);
  const path = writeEnv(dir);
  const root = new URL("missing/.env", dir);
  assert.deepEqual(await modelKey(path, root), { key: fakeKey });
  const link = fileURLToPath(new URL("link.env", dir));
  symlinkSync(path, link);
  const linkedDir = fileURLToPath(new URL("linked", dir));
  symlinkSync(fileURLToPath(dir), linkedDir);
  // A link above the file is refused too: at the open on macOS, after it elsewhere.
  assert.ok("problem" in (await modelKey(join(linkedDir, ".env"), root)));
  for (const env of [link, fileURLToPath(dir), "/dev/null"])
    assert.deepEqual(await modelKey(env, root), {
      problem: `${env} is not a regular file with one link; it is refused`,
    });
  // A second, hard link to the .env is refused too, the original with it.
  linkSync(path, fileURLToPath(new URL("hard.env", dir)));
  assert.ok("problem" in (await modelKey(path, root)));
  const none = fileURLToPath(new URL("none", dir));
  assert.deepEqual(await modelKey(none, root), { problem: `no file at ${none}` });
});

test("without --env the key comes from the root .env, as before", async (t) => {
  const dir = realDir(t);
  assert.deepEqual(await modelKey(undefined, new URL("missing/.env", dir)), {
    problem: "ANTHROPIC_API_KEY must be set in .env; env.example lists it.",
  });
  writeEnv(dir);
  assert.deepEqual(await modelKey(undefined, new URL(".env", dir)), { key: fakeKey });
});

test("a key a header can't hold is refused, so no error quotes it", async (t) => {
  const root = new URL("missing/.env", realDir(t));
  for (const text of [
    `GH_TOKEN=${fakeToken}\n`,
    `ANTHROPIC_API_KEY="${fakeKey}\nsecond line"\n`,
    `ANTHROPIC_API_KEY="${fakeKey} "\n`,
  ]) {
    const path = writeEnv(realDir(t), text);
    assert.deepEqual(await modelKey(path, root), {
      problem: `ANTHROPIC_API_KEY must be set in ${path}`,
    });
  }
});

// One case, graded without a judge.
function writeCase(dir: URL): URL {
  const cases = new URL("cases/", dir);
  mkdirSync(cases);
  writeFileSync(
    new URL("revert-mentioned.json", cases),
    JSON.stringify({
      id: "revert-mentioned",
      split: "train",
      kind: 2,
      region: "checkout-epic",
      prompt: "How do I undo a change here?",
      expect: [{ grader: "mentions", text: ["Revert"] }],
    }),
  );
  return cases;
}

test("a live round with --env sends the key to the model alone: no output or file holds it", async (t) => {
  const dir = realDir(t);
  const env = writeEnv(dir);
  const cases = writeCase(dir);
  const sent: { key: string | null; request: string }[] = [];
  const network: Fetch = async (input, init) => {
    const request = new Request(input, init);
    sent.push({
      key: request.headers.get("x-api-key"),
      request: JSON.stringify([...request.headers]) + (await request.text()),
    });
    return streamed({ text: "Approve it, then Revert it from the thread." });
  };
  const lines: string[] = [];
  let tick = 0;
  const io: Io = {
    cases,
    cassettes: new URL("cassettes/", dir),
    rounds: new URL("rounds/", dir),
    envFile: new URL("missing/.env", dir),
    network,
    now: () => Date.UTC(2026, 10, 1),
    clock: () => tick++,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  const command = parseCommand(["--env", env]);
  assert.ok(!("error" in command));
  assert.equal(await main(command, io), 0, lines.join("\n"));
  assert.match(lines.join("\n"), /^train {2}1\/1 100%/m);

  assert.ok(sent.length > 0);
  for (const { key, request } of sent) {
    assert.equal(key, fakeKey);
    assert.ok(!request.includes(fakeToken));
  }
  const written = [io.cassettes, io.rounds].flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name)),
  );
  assert.ok(written.some((path) => path.startsWith(fileURLToPath(io.cassettes))));
  for (const text of [...lines, ...written.map((path) => readFileSync(path, "utf8"))])
    for (const secret of [fakeKey, fakeToken]) assert.ok(!text.includes(secret));
});

test("a live round whose --env isn't a regular file stops before any model call", async (t) => {
  const dir = realDir(t);
  const lines: string[] = [];
  const io: Io = {
    cases: writeCase(dir),
    cassettes: new URL("cassettes/", dir),
    rounds: new URL("rounds/", dir),
    envFile: new URL("missing/.env", dir),
    network: async () => assert.fail("no model call"),
    now: () => Date.UTC(2026, 10, 1),
    clock: () => 0,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  const command = parseCommand(["--env", fileURLToPath(dir)]);
  assert.ok(!("error" in command));
  assert.equal(await main(command, io), 1);
  assert.deepEqual(lines, [
    `${fileURLToPath(dir)} is not a regular file with one link; it is refused`,
  ]);
});
