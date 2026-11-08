import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fixedKey,
  mayShow,
  mayUse,
  opensOutside,
  orphans,
  parseRequest,
  readyOrigin,
  refusedArguments,
  secretsInMemory,
  serverArguments,
  storageProblem,
} from "../shell/rules.ts";

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
  assert.equal(refused('{"id":14,"kind":"secret.delete","name":"anthropic-key.tmp"}'), 14);
  // No connection keeps a secret since decision 0059, nor does Jira's from
  // before connections: none of their names is taken.
  for (const name of [
    "jira",
    "connection.01JC0NNECT10NSST0RED0000AB",
    "connection.",
    "connection.01jc0nnect10nsst0red0000ab",
    "connection.01JC0NNECT10NSST0RED0000AB0",
    "connection.01JC0NNECT10NSST0RED0000A",
    "connection.01JC0NNECT10NSST0RED0000AI",
    "connection.81JC0NNECT10NSST0RED0000AB",
    "connection.01JC0NNECT10NSST0RED0000AB.tmp",
    "connection./1JC0NNECT10NSST0RED0000AB",
    "connection.01JC0NNECT10NSST0RED0000A\\u0000",
    "connections.01JC0NNECT10NSST0RED0000AB",
    "Connection.01JC0NNECT10NSST0RED0000AB",
    "slack.01JC0NNECT10NSST0RED0000AB",
  ])
    assert.equal(refused(JSON.stringify({ id: 15, kind: "secret.get", name })), 15, name);
  assert.equal(refused(`{"id":9,"kind":"secret.get","name":"${"a".repeat(65)}"}`), 9);
  assert.equal(
    refused(
      `{"id":10,"kind":"secret.set","name":"anthropic-key","secret":"${"x".repeat(16_385)}"}`,
    ),
    10,
  );
  assert.equal(refused('{"id":11,"kind":"secret.set","name":"anthropic-key"}'), 11);
  assert.equal(refused('{"id":12,"kind":"folder.pick"}'), 12);
  assert.equal(refused('{"id":13,"kind":"notify","title":"x"}'), 13);
  for (const threads of [-1, 1.5, "2", null])
    assert.equal(refused(JSON.stringify({ id: 16, kind: "working", threads })), 16);
  // A click opens only a path on the server's own origin.
  for (const open of ["https://evil.example/", "//evil.example/", "/\\\\evil", "threads/1", "/a b"])
    assert.equal(
      refused(JSON.stringify({ id: 15, kind: "notify", title: "x", body: "", open })),
      15,
      open,
    );
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
  assert.notEqual(storageProblem("darwin", false, null), null);
  // On Linux with no keyring, safe storage would encrypt with a fixed key.
  assert.notEqual(storageProblem("linux", true, "basic_text"), null);
  assert.notEqual(storageProblem("linux", true, "unknown"), null);
  assert.notEqual(storageProblem("linux", true, null), null);
  // A keyring that fails falls back to the fixed key, which its prefix shows.
  assert.equal(fixedKey("linux", Buffer.from("v10abc")), true);
  assert.equal(fixedKey("linux", Buffer.from("v11abc")), false);
  assert.equal(fixedKey("darwin", Buffer.from("v10abc")), false);
});

test("what a server that died left in the shell's group is swept, only if the shell leads it", () => {
  const table = (shellGroup: number) =>
    [
      // The shell, its helpers, and what the dead server started: a Deno
      // and a tsc, now launchd's, and a child of the Deno.
      `  400     1 ${shellGroup}`,
      `  401   400 ${shellGroup}`,
      `  402   400 ${shellGroup}`,
      `  610     1 ${shellGroup}`,
      `  611     1 ${shellGroup}`,
      `  612   610 ${shellGroup}`,
      // A CLI's own group, and another app's orphan.
      "  700     1   700",
      "  800     1   800",
      "",
      "junk",
    ].join("\n");
  assert.deepEqual(orphans(table(400), 400), [610, 612, 611]);
  // From a terminal, the group is the terminal's: nothing is swept.
  assert.deepEqual(orphans(table(399), 400), []);
  assert.deepEqual(orphans("", 400), []);
});

test("in the background, or with a launch file, secrets stay in memory, away from the OS's store", () => {
  assert.equal(secretsInMemory(["Oriel", "--background", "--data", "/tmp/o"]), true);
  // Whoever reads the launch file's cookie reaches none of the person's secrets.
  assert.equal(secretsInMemory(["Oriel", "--launch-file", "--data", "/tmp/o"]), true);
  assert.equal(secretsInMemory(["Oriel", "--data", "/tmp/o"]), false);
  assert.equal(secretsInMemory(["Oriel"]), false);
});

test("a launch a script made shows a placeholder account; the person's own launch never does", () => {
  for (const by of ["--background", "--launch-file"])
    assert.deepEqual(serverArguments(["Oriel", by, "--data", "/tmp/o"], "/tmp/o"), [
      "--desktop",
      "--data",
      "/tmp/o",
      "--placeholder-account",
    ]);
  assert.deepEqual(serverArguments(["Oriel"], "/d"), ["--desktop", "--data", "/d"]);
  assert.deepEqual(serverArguments(["Oriel", "-psn_0_1234"], "/d"), ["--desktop", "--data", "/d"]);
});

test("a launch takes only the shell's own switches, each value where one belongs", () => {
  assert.deepEqual(refusedArguments([]), []);
  assert.deepEqual(
    refusedArguments(["--background", "--data", "/tmp/d", "--launch-file", "--measure", "/tmp/m"]),
    [],
  );
  for (const args of [
    ["--remote-debugging-port=9222"],
    ["-remote-debugging-port=9222"],
    ["--remote-debugging-pipe"],
    ["--inspect"],
    ["--log-net-log=/tmp/n", "--net-log-capture-mode=IncludeSensitive"],
    ["--proxy-server=127.0.0.1:1", "--proxy-bypass-list=<-loopback>"],
    ["--data=/tmp/d"],
    ["--", "--remote-debugging-port=9222"],
    ["stray"],
  ])
    assert.deepEqual(refusedArguments(["--background", ...args]), args);
  // A value that is missing, or is another switch, isn't a value.
  assert.deepEqual(refusedArguments(["--data"]), ["--data"]);
  // Finder's first open of a downloaded app can add a process serial number.
  assert.deepEqual(refusedArguments(["-psn_0_1234567"]), []);
  assert.deepEqual(refusedArguments(["--background", "-psn_0_1234567"]), []);
  for (const args of [["-psn_0_1=x"], ["-psn_"], ["--psn_0_1"], ["-psn_0_1", "--inspect"]])
    assert.deepEqual(
      refusedArguments(args),
      args.filter((arg) => arg !== "-psn_0_1"),
    );
  assert.deepEqual(refusedArguments(["--data", "--inspect"]), ["--data", "--inspect"]);
});
