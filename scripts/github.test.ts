import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentToken,
  type CheckRun,
  enqueue,
  headRefusal,
  leaksSecret,
  parse,
  published,
} from "./github.ts";

test("only the agent token from .env is accepted", () => {
  assert.equal(agentToken("JIRA_API_TOKEN=secret\nGH_TOKEN=github_pat_abc\n"), "github_pat_abc");
  for (const file of [null, "", "GH_TOKEN=gho_classic\n", "JIRA_API_TOKEN=github_pat_x\n"]) {
    assert.equal(agentToken(file), null, JSON.stringify(file));
  }
});

test("anything else is refused, flags and gh commands included", () => {
  const refused = [
    [],
    ["auth", "token"],
    ["--user", "vibdev", "auth", "token"],
    ["ext", "install", "o/gh-x"],
    ["api", "-F", "b=@.env", "/x"],
    ["pr-view", "7", "--hostname", "evil.example"],
    ["pr-view", "0"],
    ["pr-view", "7; rm -rf /"],
    ["pr-create", "feature/x", "t", "b"],
    ["pr-create", "one-two-three-four", "t", "b"],
    ["pr-create", "ok-branch", "  ", "b"],
    ["pr-create", "ok-branch", "t"],
    ["repo", "clone", "o/r", "--", "-c", "x=y"],
    ["runs", "a", "b"],
    ["pr-edit", "11"],
    ["pr-edit", "11", "   "],
    ["pr-edit", "0", "body"],
    ["pr-edit", "11", "body", "--title", "x"],
    ["pr-enqueue", "12", "--despite"],
    ["pr-enqueue", "12", "--despite", "--despite"],
    ["pr-enqueue", "12", "--force", "ui"],
    ["pr-enqueue", "12", "ui"],
  ];
  for (const args of refused) assert.ok("error" in parse(args), JSON.stringify(args));
});

test("a token with whitespace or junk is refused, so it can't leak into a header error", () => {
  assert.equal(agentToken('GH_TOKEN="github_pat_abc\nmore"\n'), null);
  assert.equal(agentToken("GH_TOKEN=github_pat_abc def\n"), null);
});

test("only this repo's own branches may be enqueued or edited", () => {
  const own = { isCrossRepository: false, headRepository: { nameWithOwner: "oriel-app/oriel" } };
  for (const action of ["enqueue", "edit"] as const) {
    assert.equal(headRefusal(own, action), null);
    assert.notEqual(headRefusal({ ...own, isCrossRepository: true }, action), null);
    const fork = { isCrossRepository: false, headRepository: { nameWithOwner: "evil/oriel" } };
    assert.notEqual(headRefusal(fork, action), null);
    assert.notEqual(headRefusal({ isCrossRepository: false, headRepository: null }, action), null);
  }
});

test("a title or body carrying a value from .env is caught", () => {
  const env =
    "JIRA_API_TOKEN=ATATT3xFfGF0secretvalue\nJIRA_SITE=https://oriel.atlassian.net\nSHORT=abc\n";
  assert.equal(leaksSecret(["fix: x", "token ATATT3xFfGF0secretvalue here"], env), true);
  assert.equal(leaksSecret(["fix: x", "see https://oriel.atlassian.net/browse/SYN-1"], env), false);
  assert.equal(leaksSecret(["fix: abc", "plain body"], env), false);
  assert.equal(leaksSecret(["anything"], null), false);
});

test("an edit's new title is checked for values from .env, as a new PR's is", () => {
  const env = "ANTHROPIC_API_KEY=sk-ant-fakefakefake\nJIRA_SITE=https://oriel.atlassian.net\n";
  const leaks = (args: string[]) => {
    const operation = parse(args);
    assert.ok(!("error" in operation), JSON.stringify(args));
    return leaksSecret(published(operation), env);
  };
  assert.equal(leaks(["pr-edit", "11", "body", "fix: sk-ant-fakefakefake"]), true);
  assert.equal(leaks(["pr-edit", "11", "sk-ant-fakefakefake", "fix: x"]), true);
  assert.equal(leaks(["pr-create", "ok-branch", "fix: sk-ant-fakefakefake", "b"]), true);
  assert.equal(leaks(["pr-edit", "11", "body", "fix: https://oriel.atlassian.net"]), false);
  assert.equal(leaks(["pr-edit", "11", "body"]), false);
  assert.deepEqual(published({ op: "pr-view", number: 1 }), []);
});

// pr-enqueue on a red head: #228 was queued with ui failing, and ui isn't
// required, so the queue merged it (fixed by #229).
const pr = { id: "PR_x", number: 7, headRefOid: "fa66b697774d37ce99f89348c82cc44a5d19a4c7" };
const noPause = async () => assert.fail("paused");
const again = async () => assert.fail("read the PR again");
const run = (name: string, status: string, conclusion: string | null = null): CheckRun => ({
  id: name === "check" ? 128464314008 : 128464313913,
  name,
  status,
  conclusion,
});
const checksOf = (runs: CheckRun[], despite: string[] = []) => ({
  runs: async () => runs,
  required: async () => ["check"],
  despite,
});

// A stand-in for GitHub that answers each mutation from a script and records
// what it was sent.
type Answer = { data?: unknown; errors?: { message?: string }[] };
function standIn(answers: Record<string, Answer>) {
  const sent: string[] = [];
  const send = async (query: string) => {
    const mutation = /\b(enqueuePullRequest|enablePullRequestAutoMerge)\b/.exec(query)?.[1] ?? "";
    sent.push(mutation);
    const answer = answers[mutation];
    assert.ok(answer, `unexpected ${mutation || query}`);
    return answer;
  };
  return { send, sent };
}
const entry = { enqueuePullRequest: { mergeQueueEntry: { state: "QUEUED", position: 1 } } };

test("a red check on the head refuses the enqueue, unless --despite names it", async () => {
  const red = [run("check", "completed", "success"), run("ui", "completed", "failure")];
  const refusing = standIn({});
  await assert.rejects(
    enqueue(refusing.send, pr, noPause, again, checksOf(red)),
    /^Error: not enqueued: PR head fa66b69 has ui \(failure\)\..*--despite <check>/s,
  );
  assert.deepEqual(refusing.sent, []);

  const through = standIn({ enqueuePullRequest: { data: entry } });
  const result = String(await enqueue(through.send, pr, noPause, again, checksOf(red, ["ui"])));
  assert.match(result, /^despite ui: ui \(failure\)/);
  assert.deepEqual(through.sent, ["enqueuePullRequest"]);
});

test("a running check the queue won't wait for refuses; a required one arms auto-merge", async () => {
  const notRequired = standIn({});
  await assert.rejects(
    enqueue(
      notRequired.send,
      pr,
      noPause,
      again,
      checksOf([run("check", "completed", "success"), run("ui", "in_progress")]),
    ),
    /has ui \(in_progress, .*won't wait for it\)/,
  );
  assert.deepEqual(notRequired.sent, []);

  const required = standIn({
    enqueuePullRequest: {
      errors: [{ message: 'Pull request Required status check "check" is in progress.' }],
    },
    enablePullRequestAutoMerge: { data: { enablePullRequestAutoMerge: {} } },
  });
  const running = checksOf([run("check", "in_progress"), run("ui", "completed", "success")]);
  assert.match(
    String(await enqueue(required.send, pr, noPause, again, running)),
    /^auto-merge armed: PR #7 at fa66b69 /,
  );
});
