import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fixedKey,
  folders,
  lang,
  Lines,
  mayShow,
  mayUse,
  opensOutside,
  parseRequest,
  printedPath,
  readyOrigin,
  serverPath,
  storageProblem,
} from "../shell/rules.ts";

test("the shell answers the protocol's requests, as the server writes them", () => {
  assert.deepEqual(parseRequest('{"id":1,"kind":"folder.pick","prompt":"Connect a folder"}'), {
    id: 1,
    request: { kind: "folder.pick", prompt: "Connect a folder" },
  });
  assert.deepEqual(parseRequest('{"id":2,"kind":"secret.get","name":"jira"}'), {
    id: 2,
    request: { kind: "secret.get", name: "jira" },
  });
  assert.deepEqual(
    parseRequest('{"id":3,"kind":"secret.set","name":"anthropic-key","secret":"s3"}'),
    {
      id: 3,
      request: { kind: "secret.set", name: "anthropic-key", secret: "s3" },
    },
  );
  assert.deepEqual(parseRequest('{"id":4,"kind":"secret.delete","name":"jira"}'), {
    id: 4,
    request: { kind: "secret.delete", name: "jira" },
  });
  assert.deepEqual(parseRequest('{"id":5,"kind":"notify","title":"Done","body":""}'), {
    id: 5,
    request: { kind: "notify", title: "Done", body: "" },
  });
});

test("anything else is refused, with an answer when it has an id", () => {
  const refused = (line: string) => {
    const parsed = parseRequest(line);
    assert.ok("refused" in parsed, line);
    return parsed.id;
  };
  assert.equal(refused('{"id":6,"kind":"shell.run","command":"rm"}'), 6);
  assert.equal(refused('{"id":7,"kind":"secret.get","name":"../../login"}'), 7);
  assert.equal(refused('{"id":8,"kind":"secret.get","name":"Jira"}'), 8);
  // Only the names the server uses, though others are well formed.
  assert.equal(refused('{"id":12,"kind":"secret.get","name":"slack.token"}'), 12);
  assert.equal(refused('{"id":13,"kind":"secret.set","name":"login","secret":"s"}'), 13);
  assert.equal(refused('{"id":14,"kind":"secret.delete","name":"jira.tmp"}'), 14);
  assert.equal(refused(`{"id":9,"kind":"secret.get","name":"${"a".repeat(65)}"}`), 9);
  assert.equal(
    refused(`{"id":10,"kind":"secret.set","name":"jira","secret":"${"x".repeat(16_385)}"}`),
    10,
  );
  assert.equal(refused('{"id":11,"kind":"secret.set","name":"jira"}'), 11);
  assert.equal(refused('{"id":12,"kind":"folder.pick"}'), 12);
  assert.equal(refused('{"id":13,"kind":"notify","title":"x"}'), 13);
  assert.equal(refused('{"id":14,"kind":"toString"}'), 14);
  for (const line of [
    '{"kind":"notify","title":"","body":""}',
    '{"id":0,"kind":"folder.pick","prompt":""}',
    '{"id":1.5}',
    '{"id":"1"}',
    '{"id":true}',
    "[1]",
    "null",
    "not json",
  ])
    assert.equal(refused(line), null, line);
});

test("a long title or body is cut, not refused", () => {
  const parsed = parseRequest(
    JSON.stringify({ id: 1, kind: "notify", title: "t".repeat(300), body: "b".repeat(2000) }),
  );
  assert.ok("request" in parsed && parsed.request.kind === "notify");
  assert.equal(parsed.request.title.length, 256);
  assert.equal(parsed.request.body.length, 1024);
});

test("the first line is the server's loopback URL, and nothing else", () => {
  assert.equal(
    readyOrigin('{"kind":"ready","url":"http://127.0.0.1:4320/"}'),
    "http://127.0.0.1:4320",
  );
  for (const line of [
    '{"kind":"ready","url":"http://localhost:4320/"}',
    '{"kind":"ready","url":"https://127.0.0.1:4320/"}',
    '{"kind":"ready","url":"http://127.0.0.1/"}',
    '{"kind":"ready","url":"http://127.0.0.1.evil.example:4320/"}',
    '{"kind":"other","url":"http://127.0.0.1:4320/"}',
    "http://127.0.0.1:4320/",
  ])
    assert.equal(readyOrigin(line), null, line);
});

test("the window stays on the server's origin; http(s) links elsewhere open outside", () => {
  const origin = "http://127.0.0.1:4320";
  assert.equal(mayShow("http://127.0.0.1:4320/review/abc", origin, true), true);
  assert.equal(mayShow("http://127.0.0.1:4321/", origin, true), false);
  assert.equal(mayShow("http://localhost:4320/", origin, true), false);
  assert.equal(mayShow("https://oriel.atlassian.net/browse/SYN-1", origin, true), false);
  assert.equal(mayShow("about:blank", origin, true), false);
  assert.equal(mayShow("about:srcdoc", origin, false), true);
  assert.equal(mayShow("data:text/html,hi", origin, false), false);
  assert.equal(mayShow("http://127.0.0.1:4320/", null, true), false);
  assert.equal(opensOutside("https://oriel.atlassian.net/browse/SYN-1"), true);
  assert.equal(opensOutside("http://example.com/"), true);
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "mailto:a@b.c",
    "smb://host/share",
    "x-apple.systempreferences:",
  ])
    assert.equal(opensOutside(url), false, url);
});

test("lines split on newlines, a carriage return is dropped, and an overlong line is skipped whole", () => {
  let dropped = 0;
  const lines = new Lines(10, () => dropped++);
  assert.deepEqual(lines.push("ab"), []);
  assert.deepEqual(lines.push("c\r\nde\n"), ["abc", "de"]);
  assert.deepEqual(lines.push("x".repeat(11)), []);
  assert.deepEqual(lines.push("yyy\nok\n"), ["ok"]);
  assert.deepEqual(lines.push(`${"z".repeat(11)}\nfine\n`), ["fine"]);
  assert.equal(dropped, 2);
});

test("the server's PATH comes from the login shell's markers, after the bundle's Deno", () => {
  const printed =
    "Welcome!\n__ORIEL_PATH_START__\n/opt/homebrew/bin:/Users/p/.local/bin:/usr/bin\n__ORIEL_PATH_END__\n";
  assert.equal(printedPath(printed), "/opt/homebrew/bin:/Users/p/.local/bin:/usr/bin");
  assert.equal(printedPath("no markers"), null);
  assert.equal(printedPath("__ORIEL_PATH_START__\n\n__ORIEL_PATH_END__\n"), null);
  assert.equal(
    serverPath("/App/deno", "/opt/homebrew/bin:relative:/usr/bin", "/Users/p"),
    "/App/deno:/opt/homebrew/bin:/usr/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/p/.local/bin:/bin:/usr/sbin:/sbin",
  );
  assert.equal(serverPath("/App/deno", null, "/Users/p").split(":")[0], "/App/deno");
});

test("LANG is the shell's own, or made from the system's locale", () => {
  assert.equal(lang("fr_FR.UTF-8", "en-GB"), "fr_FR.UTF-8");
  assert.equal(lang(undefined, "en-GB"), "en_GB.UTF-8");
  assert.equal(lang("", "pt"), "pt.UTF-8");
  assert.equal(lang(undefined, "zh-Hans-CN"), "zh.UTF-8");
  assert.equal(lang(undefined, ""), "en_US.UTF-8");
});

test("the data folder, logs and the shell's own folder, moved together by --data", () => {
  assert.deepEqual(folders(["Oriel"], "/Users/p"), {
    data: "/Users/p/Library/Application Support/Oriel",
    logs: "/Users/p/Library/Logs/Oriel",
    shell: "/Users/p/Library/Application Support/Oriel/Shell",
  });
  assert.deepEqual(folders(["Oriel", "--data", "/tmp/o"], "/Users/p"), {
    data: "/tmp/o",
    logs: "/tmp/o/Logs",
    shell: "/tmp/o/Shell",
  });
});

test("a page may write text to the clipboard from the server's origin, and nothing else", () => {
  const origin = "http://127.0.0.1:4320";
  assert.equal(
    mayUse("clipboard-sanitized-write", "http://127.0.0.1:4320/review/abc", origin),
    true,
  );
  assert.equal(mayUse("clipboard-sanitized-write", "http://127.0.0.1:4321/", origin), false);
  assert.equal(mayUse("clipboard-sanitized-write", "data:text/html,x", origin), false);
  assert.equal(mayUse("clipboard-sanitized-write", "http://127.0.0.1:4320/", null), false);
  for (const permission of [
    "clipboard-read",
    "notifications",
    "media",
    "geolocation",
    "openExternal",
    "fileSystem",
  ])
    assert.equal(mayUse(permission, "http://127.0.0.1:4320/", origin), false, permission);
});

test("a secret is kept only where the OS gives safe storage a key of its own", () => {
  assert.equal(storageProblem("darwin", true, null), null);
  assert.equal(storageProblem("win32", true, null), null);
  assert.equal(storageProblem("linux", true, "gnome_libsecret"), null);
  assert.equal(storageProblem("linux", true, "kwallet6"), null);
  assert.match(storageProblem("darwin", false, null) ?? "", /isn't available/);
  // On Linux with no keyring, safe storage would encrypt with a fixed key.
  assert.match(storageProblem("linux", true, "basic_text") ?? "", /fixed key/);
  assert.match(storageProblem("linux", true, "unknown") ?? "", /fixed key/);
  assert.match(storageProblem("linux", true, null) ?? "", /fixed key/);
  // A keyring that fails falls back to the fixed key, which its prefix shows.
  assert.equal(fixedKey("linux", Buffer.from("v10abc")), true);
  assert.equal(fixedKey("linux", Buffer.from("v11abc")), false);
  assert.equal(fixedKey("darwin", Buffer.from("v10abc")), false);
});
