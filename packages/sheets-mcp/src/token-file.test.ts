import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { clientFile, configFolder, tokenFile } from "./token-file.ts";

const fresh = () => mkdtempSync(join(tmpdir(), "sheets-mcp-token-"));
const mode = (path: string) => statSync(path).mode & 0o777;

test("the folder is under $XDG_CONFIG_HOME when it is absolute, or else ~/.config", () => {
  assert.equal(
    configFolder({ XDG_CONFIG_HOME: "/x/config" }, "/home/p"),
    "/x/config/oriel-sheets-mcp",
  );
  assert.equal(configFolder({}, "/home/p"), "/home/p/.config/oriel-sheets-mcp");
  assert.equal(
    configFolder({ XDG_CONFIG_HOME: "relative" }, "/home/p"),
    "/home/p/.config/oriel-sheets-mcp",
  );
  assert.equal(
    configFolder({ XDG_CONFIG_HOME: " " }, "/home/p"),
    "/home/p/.config/oriel-sheets-mcp",
  );
});

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

test("no file, a file this didn't write, or a link is no sign-in", () => {
  const folder = fresh();
  const file = tokenFile(folder);
  assert.equal(file.read(), null);
  writeFileSync(file.path, "not json");
  assert.equal(file.read(), null);
  writeFileSync(file.path, JSON.stringify({ refresh_token: 7 }));
  assert.equal(file.read(), null);
  const elsewhere = join(fresh(), "token.json");
  writeFileSync(elsewhere, JSON.stringify({ refresh_token: "theirs" }));
  const linked = fresh();
  symlinkSync(elsewhere, join(linked, "token.json"));
  assert.equal(tokenFile(linked).read(), null);
});

test("remove deletes the file, and says whether there was one", () => {
  const file = tokenFile(fresh());
  assert.equal(file.remove(), false);
  file.write("gone soon");
  assert.equal(file.remove(), true);
  assert.equal(file.read(), null);
  assert.equal(file.remove(), false);
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
