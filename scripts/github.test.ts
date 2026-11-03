import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentToken,
  enqueue,
  headRefusal,
  leaksSecret,
  nextDecision,
  parse,
  published,
  usage,
} from "./github.ts";

test("only the agent token from .env is accepted", () => {
  assert.equal(agentToken("JIRA_API_TOKEN=secret\nGH_TOKEN=github_pat_abc\n"), "github_pat_abc");
  for (const file of [null, "", "GH_TOKEN=gho_classic\n", "JIRA_API_TOKEN=github_pat_x\n"]) {
    assert.equal(agentToken(file), null, JSON.stringify(file));
  }
});

test("the fixed operations parse", () => {
  assert.deepEqual(parse(["pr-list"]), { op: "pr-list" });
  assert.deepEqual(parse(["pr-view", "7"]), { op: "pr-view", number: 7 });
  assert.deepEqual(parse(["pr-enqueue", "12"]), { op: "pr-enqueue", number: 12 });
  assert.deepEqual(parse(["pr-create", "readme-header", "docs: x", "body"]), {
    op: "pr-create",
    branch: "readme-header",
    title: "docs: x",
    body: "body",
  });
  assert.deepEqual(parse(["pr-edit", "11", "new body"]), {
    op: "pr-edit",
    number: 11,
    body: "new body",
  });
  assert.deepEqual(parse(["runs"]), { op: "runs", branch: null });
  assert.deepEqual(parse(["runs", "db-schema"]), { op: "runs", branch: "db-schema" });
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
    assert.match(
      headRefusal({ ...own, isCrossRepository: true }, action) ?? "",
      new RegExp(`refusing to ${action}`),
    );
    const fork = { isCrossRepository: false, headRepository: { nameWithOwner: "evil/oriel" } };
    assert.match(headRefusal(fork, action) ?? "", /evil\/oriel/);
    assert.match(
      headRefusal({ isCrossRepository: false, headRepository: null }, action) ?? "",
      /deleted/,
    );
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

test("pr-edit takes an optional title after the body, never empty", () => {
  assert.deepEqual(parse(["pr-edit", "11", "new body", "feat: x (OA-1, OA-2)"]), {
    op: "pr-edit",
    number: 11,
    body: "new body",
    title: "feat: x (OA-1, OA-2)",
  });
  for (const args of [
    ["pr-edit", "11", "body", ""],
    ["pr-edit", "11", "body", "  "],
    ["pr-edit", "11", "  ", "title"],
    ["pr-edit", "0", "body", "title"],
    ["pr-edit", "11", "body", "title", "extra"],
    ["pr-edit", "11", "body", "--draft"],
    ["pr-edit", "11", "--title", "x"],
  ])
    assert.ok("error" in parse(args), JSON.stringify(args));
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

test("a title and body given the wrong way round are refused, in either operation", () => {
  const title = "fix(scripts): retitle safely (OA-115)";
  const body = "## Summary\n\nfix: x\n";
  assert.deepEqual(parse(["pr-edit", "11", body, title]), {
    op: "pr-edit",
    number: 11,
    body,
    title,
  });
  assert.ok(!("error" in parse(["pr-create", "ok-branch", title, body])));
  for (const args of [
    ["pr-edit", "11", title, body],
    ["pr-edit", "11", title, "plain body"],
    ["pr-edit", "11", "fix: x", "fix: y"],
    // A title alone would become the body.
    ["pr-edit", "11", title],
    ["pr-create", "ok-branch", body, title],
    ["pr-create", "ok-branch", "plain title", "b"],
    ["pr-create", "ok-branch", "fix: x", "fix: y"],
  ])
    assert.ok("error" in parse(args), JSON.stringify(args));
});

test("a title is one line in SPEC §10's commit form", () => {
  for (const title of ["feat: x", "fix(jira,server): y (OA-1)", "refactor!: z"])
    assert.ok(!("error" in parse(["pr-edit", "11", "body", title])), title);
  for (const title of [
    "fix: x\nmore",
    "fix: x\r",
    "Fix: x",
    "fix:x",
    "fix: ",
    "-fix: x",
    "feat: x\u2028y",
    "fix: x\u0085y",
    "fix: x\vy",
    "fix: \u0001",
  ])
    assert.ok("error" in parse(["pr-edit", "11", "body", title]), JSON.stringify(title));
  assert.match(usage, /wrong way round/);
});

// Refusals GitHub gave builders' enqueues, as recorded in their sessions.
const refused = (message: string) => ({ errors: [{ type: "UNPROCESSABLE", message }] });
const queued = refused('Pull request Required status check "check" is queued.');
const pr = { id: "PR_x", number: 7, headRefOid: "fa66b697774d37ce99f89348c82cc44a5d19a4c7" };

// A stand-in for GitHub that answers each mutation from a script and records
// what it was sent.
function standIn(answers: Record<string, { data?: unknown; errors?: { message?: string }[] }>) {
  const sent: { mutation: string; variables: Record<string, unknown> }[] = [];
  const send = async (query: string, variables: Record<string, unknown>) => {
    const mutation = /\b(enqueuePullRequest|enablePullRequestAutoMerge)\b/.exec(query)?.[1] ?? "";
    sent.push({ mutation, variables });
    const answer = answers[mutation];
    assert.ok(answer, `unexpected ${mutation || query}`);
    return answer;
  };
  return { send, sent };
}

test("an enqueue GitHub accepts is the whole of it", async () => {
  const entry = { enqueuePullRequest: { mergeQueueEntry: { state: "QUEUED", position: 1 } } };
  const github = standIn({ enqueuePullRequest: { data: entry } });
  assert.deepEqual(await enqueue(github.send, pr), entry);
  assert.deepEqual(github.sent, [
    { mutation: "enqueuePullRequest", variables: { id: "PR_x", oid: pr.headRefOid } },
  ]);
});

test("while CI runs, the enqueue arms auto-merge on the same commit instead", async () => {
  for (const waiting of [
    queued,
    refused('Pull request Required status check "check" is in progress.'),
    refused(
      "Pull request mergeability check has not yet completed and Pull request not in mergeable state",
    ),
  ]) {
    const github = standIn({
      enqueuePullRequest: waiting,
      enablePullRequestAutoMerge: { data: { enablePullRequestAutoMerge: {} } },
    });
    assert.match(String(await enqueue(github.send, pr)), /^auto-merge armed: PR #7 at fa66b69 /);
    assert.deepEqual(
      github.sent.map((s) => s.mutation),
      ["enqueuePullRequest", "enablePullRequestAutoMerge"],
    );
    assert.deepEqual(github.sent[1]?.variables, { id: "PR_x", oid: pr.headRefOid });
  }
});

test("any other refusal fails the enqueue and arms nothing", async () => {
  for (const refusal of [
    refused("Pull request has merge conflicts and Pull request not in mergeable state"),
    refused('Pull request Required status check "check" is failing.'),
    refused("Pull request not in mergeable state"),
    // A wait alongside another reason, in one message or two.
    refused(
      'Pull request Required status check "check" is queued and Pull request has merge conflicts',
    ),
    {
      errors: [
        { type: "UNPROCESSABLE", message: 'Pull request Required status check "check" is queued.' },
        { type: "UNPROCESSABLE", message: "Pull request has merge conflicts" },
      ],
    },
    { errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }] },
  ]) {
    const github = standIn({ enqueuePullRequest: refusal });
    await assert.rejects(enqueue(github.send, pr), /^Error: graphql: /);
    assert.equal(github.sent.length, 1);
  }
});

test("with auto-merge off, the refusal names the setting the maintainer must turn on", async () => {
  const github = standIn({
    enqueuePullRequest: queued,
    enablePullRequestAutoMerge: refused(
      "Pull request Auto merge is not allowed for this repository",
    ),
  });
  await assert.rejects(enqueue(github.send, pr), (error: Error) => {
    assert.match(
      error.message,
      /^not enqueued: Pull request Required status check "check" is queued/,
    );
    assert.match(error.message, /Needs you: tick "Allow auto-merge" under Settings → General/);
    assert.match(error.message, /run pr-enqueue again once CI passes/);
    return true;
  });
});

test("a failure to arm auto-merge for another reason says both why", async () => {
  const github = standIn({
    enqueuePullRequest: queued,
    enablePullRequestAutoMerge: refused("Pull request is in clean status"),
  });
  await assert.rejects(
    enqueue(github.send, pr),
    /not enqueued: .* is queued\. Arming auto-merge failed too: graphql: .*clean status/,
  );
});

test("the next decision number follows the highest on main and in open PRs", () => {
  assert.deepEqual(parse(["next-decision"]), { op: "next-decision" });
  assert.ok("error" in parse(["next-decision", "x"]));
  assert.equal(nextDecision([]), "0001");
  assert.equal(
    nextDecision([
      "docs/decisions/0047-server.md",
      "docs/decisions/0048-codex-preview.md",
      // An open PR's files: its own draft, and paths that aren't decisions.
      "docs/decisions/0049-sketches.md",
      "docs/decisions/9999-draft.txt",
      "docs/user/0100-guide.md",
      "",
    ]),
    "0050",
  );
});
