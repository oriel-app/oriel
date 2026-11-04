import assert from "node:assert/strict";
import { test } from "node:test";
import {
  descendants,
  fixedKey,
  folders,
  lang,
  Lines,
  mayShow,
  mayUse,
  notificationText,
  opensOutside,
  orphans,
  parseRequest,
  printedPath,
  quitQuestion,
  type Raise,
  raises,
  readyOrigin,
  secretsInMemory,
  serverPath,
  storageProblem,
  refusedArguments,
  switchName,
} from "../shell/rules.ts";
import { descendants as serverDescendants } from "@oriel/server/desktop/utility";

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
  assert.deepEqual(
    parseRequest('{"id":5,"kind":"secret.get","name":"connection.01JC0NNECT10NSST0RED0000AB"}'),
    {
      id: 5,
      request: { kind: "secret.get", name: "connection.01JC0NNECT10NSST0RED0000AB" },
    },
  );
  assert.deepEqual(parseRequest('{"id":4,"kind":"secret.delete","name":"jira"}'), {
    id: 4,
    request: { kind: "secret.delete", name: "jira" },
  });
  assert.deepEqual(
    parseRequest('{"id":5,"kind":"notify","title":"Done","body":"","open":"/threads/01J"}'),
    { id: 5, request: { kind: "notify", title: "Done", body: "", open: "/threads/01J" } },
  );
  // The first run brings the window to the front once a sign-in ends.
  assert.deepEqual(parseRequest('{"id":6,"kind":"window.focus"}'), {
    id: 6,
    request: { kind: "window.focus" },
  });
  // How many threads Oriel is working on, for asking before quitting.
  assert.deepEqual(parseRequest('{"id":7,"kind":"working","threads":2}'), {
    id: 7,
    request: { kind: "working", threads: 2 },
  });
  assert.deepEqual(parseRequest('{"id":8,"kind":"working","threads":0}'), {
    id: 8,
    request: { kind: "working", threads: 0 },
  });
});

test("before quitting while Oriel works, the shell asks, with Quit first and Cancel on Escape", () => {
  assert.deepEqual(quitQuestion(2), {
    message: "Oriel is still working on 2 threads. Quit anyway?",
    buttons: ["Quit", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  assert.equal(quitQuestion(1).message, "Oriel is still working on 1 thread. Quit anyway?");
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
  // A connection's secret, by its ULID alone: exactly 26 upper-case Crockford
  // characters, the first of which a ULID keeps to 0-7.
  for (const name of [
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
    refused(`{"id":10,"kind":"secret.set","name":"jira","secret":"${"x".repeat(16_385)}"}`),
    10,
  );
  assert.equal(refused('{"id":11,"kind":"secret.set","name":"jira"}'), 11);
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

test("a long title or body is cut, not refused", () => {
  const parsed = parseRequest(
    JSON.stringify({
      id: 1,
      kind: "notify",
      title: "t".repeat(300),
      body: "b".repeat(2000),
      open: "/",
    }),
  );
  assert.ok("request" in parsed && parsed.request.kind === "notify");
  assert.equal(parsed.request.title.length, 256);
  assert.equal(parsed.request.body.length, 1024);
});

test("a notification's text is one plain line, and markup on Linux is only text", () => {
  const title = 'Fix <b>login</b> & "SSO"\n\u0007now';
  assert.equal(notificationText("darwin", title), 'Fix <b>login</b> & "SSO" now');
  assert.equal(notificationText("linux", title), 'Fix &lt;b&gt;login&lt;/b&gt; &amp; "SSO" now');
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

test("a server that won't quit is killed with all it started, found by the process table", () => {
  const table = [
    "    1     0",
    "  500     1",
    // The server, a Deno and a tsc under it, the first run's CLI and its child.
    "  600   500",
    "  601   600",
    "  602   600",
    "  700   600",
    "  701   700",
    // Another app's, and one that names itself its parent.
    "  800     1",
    "  801   800",
    "  900   900",
    "",
    "junk",
  ].join("\n");
  assert.deepEqual(descendants(table, 600), [601, 602, 700, 701]);
  assert.deepEqual(descendants(table, 701), []);
  assert.deepEqual(descendants(table, 4242), []);
  // The server's own sweep reads the table the same way.
  for (const root of [1, 500, 600, 700, 701, 800, 900, 4242])
    assert.deepEqual(serverDescendants(table, root), descendants(table, root), String(root));
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

test("in the background only the person's own click brings the window forward", () => {
  const own: Raise[] = ["dock", "notification"];
  const unasked: Raise[] = [
    "launch",
    "second-launch",
    "focus-request",
    "folder-pick",
    "quit-question",
  ];
  for (const why of [...own, ...unasked]) assert.equal(raises(why, false), true, why);
  for (const why of own) assert.equal(raises(why, true), true, why);
  for (const why of unasked) assert.equal(raises(why, true), false, why);
});

test("in the background, or with a launch file, secrets stay in memory, away from the OS's store", () => {
  assert.equal(secretsInMemory(["Oriel", "--background", "--data", "/tmp/o"]), true);
  // Whoever reads the launch file's cookie reaches none of the person's secrets.
  assert.equal(secretsInMemory(["Oriel", "--launch-file", "--data", "/tmp/o"]), true);
  assert.equal(secretsInMemory(["Oriel", "--data", "/tmp/o"]), false);
  assert.equal(secretsInMemory(["Oriel"]), false);
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

test("a refused switch's name is Chromium's, either prefix, without its value", () => {
  assert.equal(switchName("--remote-debugging-port=9222"), "remote-debugging-port");
  assert.equal(switchName("-remote-debugging-pipe"), "remote-debugging-pipe");
  assert.equal(switchName("stray"), null);
});
