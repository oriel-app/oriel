// The server on the shell's own Node (decision 0047): the channel over the
// parent port, and what the server kills as it exits. The port is a stand-in;
// the last test starts a stand-in server, which starts two sleeps.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { channel } from "./channel.ts";
import { descendants, type ParentPort, portPipes } from "./utility.ts";

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
