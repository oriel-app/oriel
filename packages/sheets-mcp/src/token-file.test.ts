import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { clientFile, tokenFile } from "./token-file.ts";

const fresh = () => mkdtempSync(join(tmpdir(), "sheets-mcp-token-"));
const mode = (path: string) => statSync(path).mode & 0o777;

test("only its owner may read the folder (0700) and the file (0600), whatever the umask", () => {
  const folder = join(fresh(), "nested", "oriel-sheets-mcp");
  const file = tokenFile(folder);
  const before = process.umask(0);
  try {
    file.write("1//refresh-one");
  } finally {
    process.umask(before);
  }
  assert.equal(mode(folder), 0o700);
  assert.equal(mode(file.path), 0o600);
  assert.equal(file.read(), "1//refresh-one");
  assert.deepEqual(JSON.parse(readFileSync(file.path, "utf8")), {
    refresh_token: "1//refresh-one",
  });
});

test("a folder that was open is closed, and a write replaces the token whole", () => {
  const folder = join(fresh(), "oriel-sheets-mcp");
  mkdirSync(folder, { mode: 0o755 });
  chmodSync(folder, 0o755);
  const file = tokenFile(folder);
  file.write("first");
  file.write("second");
  assert.equal(mode(folder), 0o700);
  assert.equal(mode(file.path), 0o600);
  assert.equal(file.read(), "second");
});

test("the client is kept beside the token, 0600, with no secret when it has none", () => {
  const folder = join(fresh(), "oriel-sheets-mcp");
  const client = clientFile(folder);
  assert.equal(client.read(), null);
  client.write({ id: "123456789012-fake.apps.googleusercontent.com", secret: null });
  assert.equal(mode(folder), 0o700);
  assert.equal(mode(client.path), 0o600);
  assert.deepEqual(JSON.parse(readFileSync(client.path, "utf8")), {
    client_id: "123456789012-fake.apps.googleusercontent.com",
  });
  client.write({ id: "123456789012-fake.apps.googleusercontent.com", secret: "GOCSPX-fake" });
  assert.deepEqual(client.read(), {
    id: "123456789012-fake.apps.googleusercontent.com",
    secret: "GOCSPX-fake",
  });
  // One this didn't write is none.
  writeFileSync(client.path, JSON.stringify({ client_id: 7 }));
  assert.equal(client.read(), null);
  assert.equal(client.remove(), true);
  assert.equal(client.remove(), false);
});
