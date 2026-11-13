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
import type { Fetch } from "./anthropic.ts";
import { type Io, main, modelKey, parseCommand } from "./cli.ts";
import { streamed, tempDir } from "./testing.ts";

// On macOS the temp root is under a link (/var), and a .env is read only with no link
// on the way to it.
const realDir = (t: TestContext) => pathToFileURL(`${realpathSync(fileURLToPath(tempDir(t)))}/`);

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
  assert.ok("problem" in (await modelKey(join(linkedDir, ".env"), root)));
  for (const env of [link, fileURLToPath(dir), "/dev/null"])
    assert.ok("problem" in (await modelKey(env, root)), env);
  linkSync(path, fileURLToPath(new URL("hard.env", dir)));
  assert.ok("problem" in (await modelKey(path, root)));
  const none = fileURLToPath(new URL("none", dir));
  assert.ok("problem" in (await modelKey(none, root)));
});

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
