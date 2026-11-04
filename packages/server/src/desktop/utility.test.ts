// The server on the shell's own Node (decision 0047): the channel over the
// parent port, what the server kills as it exits, and what its watcher kills
// once it's gone. The port is a stand-in; the exit test starts a stand-in
// server, which starts two sleeps, and the watcher's test runs the watcher.
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { findDeno } from "@oriel/sandbox";
import { channel } from "./channel.ts";
import { descendants, type ParentPort, portPipes, watchChildren } from "./utility.ts";

const secret = "ab".repeat(32);

function port() {
  const events = new EventEmitter();
  const posted: unknown[] = [];
  const parent: ParentPort = {
    on: (event, listener) => events.on(event, listener),
    postMessage: (message) => posted.push(message),
  };
  return { parent, posted, send: (data: unknown) => events.emit("message", { data }) };
}

test("the channel runs over the parent port as it does over stdin and stdout", async () => {
  const { parent, posted, send } = port();
  const pipes = portPipes(parent);
  const lines = channel(pipes.input, pipes.write, () => {});
  // Text arrives in pieces, as a pipe's would.
  send(secret.slice(0, 10));
  send(`${secret.slice(10)}\n`);
  assert.equal(await lines.secret, secret);
  const got = lines.shell.ask({ kind: "secret.get", name: "jira" });
  lines.ready("http://127.0.0.1:4320/");
  assert.deepEqual(posted, [
    '{"kind":"ready","url":"http://127.0.0.1:4320/"}\n',
    '{"id":1,"kind":"secret.get","name":"jira"}\n',
  ]);
  send('{"id":1,"ok":true,"value":"kept"}\n');
  assert.equal(await got, "kept");
});

test("null from the shell is stdin's end, and anything after it is dropped", async () => {
  const { parent, send } = port();
  const pipes = portPipes(parent);
  const lines = channel(pipes.input, pipes.write, () => {});
  send(`${secret}\n`);
  await lines.secret;
  send(null);
  await lines.ended;
  send("more\n");
  send(null);
  await assert.rejects(lines.shell.ask({ kind: "window.focus" }), /the shell is gone/);
});

test("a message that is neither text nor null is dropped", async () => {
  const { parent, send } = port();
  const pipes = portPipes(parent);
  const lines = channel(pipes.input, pipes.write, () => {});
  for (const data of [{ end: true }, 42, undefined, ["x"]]) send(data);
  send(`${secret}\n`);
  assert.equal(await lines.secret, secret);
});

test("what the server started is found by the process table, parents first", () => {
  const table = [
    "    1     0",
    "  500     1",
    "  600   500",
    // A Deno and a tsc, a CLI's group under the server, and its child.
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
});

// One field of `ps` for a process, or "" once it's gone.
const ps = (pid: number, field: "pgid" | "stat") =>
  spawnSync("/bin/ps", ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8" }).stdout.trim();

test(
  "as it exits, the server kills what it started, in its own group or a CLI's",
  {
    skip: process.platform === "win32",
  },
  async () => {
    // A child Node process is the server: it starts a sleep as a sandbox run
    // would and one in its own group as the first run's CLI would, prints both
    // pids, and exits when told to.
    const server = `
    import { spawn } from "node:child_process";
    import { killDescendants } from ${JSON.stringify(new URL("./utility.ts", import.meta.url).href)};
    process.on("exit", killDescendants);
    const plain = spawn("/bin/sleep", ["600"], { stdio: "ignore" });
    const group = spawn("/bin/sleep", ["600"], { stdio: "ignore", detached: true });
    process.stdout.write(plain.pid + " " + group.pid + "\\n");
    process.stdin.once("data", () => process.exit(0));
  `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", server], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    const closed = new Promise((resolve) => child.on("close", resolve));
    child.stdout.setEncoding("utf8");
    const pids = await new Promise<number[]>((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (chunk: string) => {
        out += chunk;
        if (out.includes("\n")) resolve(out.trim().split(" ").map(Number));
      });
      child.once("close", () => reject(new Error("the server exited before it started both")));
    });
    const [plain = 0, group = 0] = pids;
    assert.equal(Number(ps(group, "pgid")), group);
    assert.notEqual(Number(ps(plain, "pgid")), plain);
    child.stdin.end("exit\n");
    await closed;
    for (const pid of pids) {
      const stat = ps(pid, "stat");
      assert.ok(stat === "" || stat.startsWith("Z"), `${pid} outlived the server: ${stat}`);
    }
  },
);

test(
  "once the server is gone, its watcher kills what the server started, and nothing else",
  { skip: process.platform === "win32" },
  async () => {
    // Started before the watching begins, so not one to kill.
    const other = spawn("/bin/sleep", ["600"], { stdio: "ignore" });
    const watching = watchChildren(findDeno(), () => {});
    assert.ok(watching);
    const exited = (child: ChildProcess) =>
      new Promise((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
    const watcher = exited(watching.watcher);
    // A sandbox run, and a first-run command in its own group whose script
    // has left a child to launchd, as an installer might.
    const run = spawn("/bin/sleep", ["600"], { stdio: "ignore" });
    const command = spawn(
      "/bin/sh",
      ["-c", '/bin/sh -c "/bin/sleep 600 & echo \\$!"; exec /bin/sleep 600'],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    const killed = [exited(run), exited(command)];
    const [line] = (await once(createInterface({ input: command.stdout! }), "line")) as [string];
    const left = Number(line);
    assert.equal(Number(ps(left, "pgid")), command.pid);
    // As the server's death would end the watcher's stdin.
    watching.stop();
    assert.deepEqual(await Promise.all(killed), ["SIGKILL", "SIGKILL"]);
    await watcher;
    const stat = ps(left, "stat");
    assert.ok(stat === "" || stat.startsWith("Z"), `${left} outlived the server: ${stat}`);
    assert.match(ps(other.pid!, "stat"), /^[^Z]/);
    other.kill("SIGKILL");
  },
);
