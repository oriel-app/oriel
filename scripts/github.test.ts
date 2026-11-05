import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  agentToken,
  type Annotation,
  type CheckRun,
  enqueue,
  git,
  headRefusal,
  leaksSecret,
  nextDecision,
  parse,
  published,
  shotPaths,
  shotsPush,
  usage,
  waitFor,
  waitLimitMs,
  type Watched,
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

test("pr-wait takes one PR, and shots-push a branch and PNGs", () => {
  assert.deepEqual(parse(["pr-wait", "184"]), { op: "pr-wait", number: 184 });
  assert.deepEqual(parse(["shots-push", "agent-drafts", "a.png", "after/b.png"]), {
    op: "shots-push",
    branch: "agent-drafts",
    pngs: ["a.png", "after/b.png"],
  });
  for (const args of [
    ["pr-wait"],
    ["pr-wait", "0"],
    ["pr-wait", "7", "8"],
    ["shots-push", "agent-drafts"],
    ["shots-push", "shots/agent-drafts", "a.png"],
    ["shots-push", "one-two-three-four", "a.png"],
    ["shots-push", "agent-drafts", "a.jpg"],
    ["shots-push", "agent-drafts", "--force.png"],
  ])
    assert.ok("error" in parse(args), JSON.stringify(args));
  assert.match(usage, /pr-wait <number>/);
  assert.match(usage, /shots-push <branch> <png>\.\.\./);
});

// A PR as GitHub tells pr-wait of it, open and in the queue unless told.
const watched = (over: Partial<Watched> = {}): Watched => ({
  state: "OPEN",
  headRefOid: "head",
  isInMergeQueue: true,
  mergeQueueEntry: { headCommit: { oid: "group" } },
  autoMergeRequest: null,
  mergeCommit: null,
  ...over,
});
const passed = (name: string): CheckRun => ({
  id: 1,
  name,
  status: "completed",
  conclusion: "success",
});

// A stand-in GitHub that answers each look with the next PR in `looks`
// (the last one again once they run out), on a clock only pauses move.
function watching(
  looks: Watched[],
  runs: Record<string, CheckRun[]> = {},
  notes: Record<number, Annotation[]> = {},
) {
  let now = 0;
  let looked = 0;
  const pauses: number[] = [];
  const reads = {
    pullRequest: async () => looks[Math.min(looked++, looks.length - 1)] as Watched,
    checkRuns: async (sha: string) => runs[sha] ?? [],
    annotations: async (id: number) => notes[id] ?? [],
  };
  const pause = async (ms: number) => {
    pauses.push(ms);
    now += ms;
  };
  return { wait: () => waitFor(reads, () => now, pause), pauses, looks: () => looked };
}

test("pr-wait says MERGED with the merge commit once the queue merges it", async () => {
  const github = watching([
    watched(),
    watched(),
    watched({ state: "MERGED", isInMergeQueue: false, mergeCommit: { oid: "57cd1f09" } }),
  ]);
  assert.equal(await github.wait(), "MERGED 57cd1f09");
  assert.equal(github.pauses.length, 2);
});

test("pr-wait says DROPPED for an open PR neither queued nor armed, or a closed one", async () => {
  const out = { isInMergeQueue: false, mergeQueueEntry: null };
  const dropped = watching([watched(out)]);
  assert.match(await dropped.wait(), /^DROPPED: open, not in the merge queue/);
  // Looked at three times, ten seconds apart, before it's called dropped.
  assert.deepEqual(dropped.pauses, [10_000, 10_000]);
  // Armed to enter the queue once CI passes, it's still on its way.
  const armed = watching([watched({ ...out, autoMergeRequest: { enabledAt: "x" } }), watched(out)]);
  assert.match(await armed.wait(), /^DROPPED/);
  assert.equal(armed.looks(), 4);
  assert.match(await watching([watched({ ...out, state: "CLOSED" })]).wait(), /^DROPPED: closed/);
});

test("a PR out of the queue but not yet marked merged isn't called dropped", async () => {
  // GitHub takes it off the queue a moment before it marks it MERGED (#199).
  const out = watched({ isInMergeQueue: false, mergeQueueEntry: null });
  const merged = watched({
    state: "MERGED",
    isInMergeQueue: false,
    mergeCommit: { oid: "602e63aa" },
  });
  assert.equal(await watching([watched(), out, merged]).wait(), "MERGED 602e63aa");
  assert.equal(await watching([out, out, merged]).wait(), "MERGED 602e63aa");
});

test("pr-wait says FAILED with the check and its annotations", async () => {
  const lint: CheckRun = { id: 9, name: "check", status: "completed", conclusion: "failure" };
  const notes = {
    9: [
      {
        path: "scripts/github.ts",
        start_line: 12,
        annotation_level: "failure",
        title: "lint",
        message: "unused import\nremove it",
      },
    ],
  };
  // On the head, as auto-merge waits for CI.
  const armed = watched({
    isInMergeQueue: false,
    mergeQueueEntry: null,
    autoMergeRequest: { enabledAt: "x" },
  });
  assert.equal(
    await watching([armed], { head: [passed("build"), lint] }, notes).wait(),
    "FAILED check\n  failure scripts/github.ts:12 lint: unused import\n    remove it",
  );
  // On the queue's group, which drops the PR: the group seen before still counts.
  const dropped = watched({ isInMergeQueue: false, mergeQueueEntry: null });
  const github = watching([watched(), dropped], { head: [passed("check")], group: [lint] }, {});
  assert.equal(await github.wait(), "FAILED check");
});

test("a cancelled or unfinished check isn't a failure", async () => {
  const runs = {
    head: [{ id: 2, name: "check", status: "completed", conclusion: "cancelled" }],
    group: [{ id: 3, name: "check", status: "in_progress", conclusion: null }],
  };
  assert.equal(await watching([watched()], runs).wait(), "WAITING");
});

test("pr-wait says WAITING inside its time limit", async () => {
  const github = watching([watched()]);
  assert.equal(await github.wait(), "WAITING");
  const waited = github.pauses.reduce((sum, ms) => sum + ms, 0);
  assert.ok(waited < waitLimitMs && waited > waitLimitMs - 60_000, String(waited));
});

test("shots-push paths stay inside where it runs, once each", () => {
  assert.deepEqual(shotPaths("/w", ["a.png", "./before/b.png", "/w/after/b.png"]), [
    "a.png",
    "before/b.png",
    "after/b.png",
  ]);
  for (const pngs of [["../a.png"], ["/tmp/a.png"], ["a.png", "./a.png"]])
    assert.ok("error" in shotPaths("/w", pngs), JSON.stringify(pngs));
});

// A checkout with a bare repository as its origin, on disk, as GitHub
// stands in for nothing here.
async function checkout() {
  const root = mkdtempSync(join(tmpdir(), "oriel-shots-push-test-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  const at = (dir: string) => (args: readonly string[], env?: Record<string, string>) =>
    git(["-C", dir, ...args], env);
  await git(["init", "--quiet", "--bare", origin]);
  await git(["init", "--quiet", work]);
  const run = at(work);
  for (const [key, value] of [
    ["user.name", "Builder"],
    ["user.email", "builder@example.com"],
    ["remote.origin.url", origin],
  ])
    await run(["config", key ?? "", value ?? ""]);
  const png = (path: string, tail: string) => {
    mkdirSync(join(work, path, ".."), { recursive: true });
    writeFileSync(
      join(work, path),
      Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.from(tail)]),
    );
  };
  return { root, work, run, remote: at(origin), png };
}

test("shots-push pushes an images-only commit, then one on top of it", async () => {
  const { root, work, run, remote, png } = await checkout();
  try {
    png("before/ask bar.png", "one");
    png("after/ask bar.png", "two");
    const first = (
      await shotsPush(run, work, "ask-bar", ["before/ask bar.png", "after/ask bar.png"])
    ).split("\n");
    const tip = await remote(["rev-parse", "refs/heads/shots/ask-bar"]);
    assert.deepEqual(first, [
      `https://raw.githubusercontent.com/oriel-app/oriel/${tip}/before/ask%20bar.png`,
      `https://raw.githubusercontent.com/oriel-app/oriel/${tip}/after/ask%20bar.png`,
    ]);
    assert.equal(await remote(["log", "-1", "--format=%s|%P", tip]), "shots: ask-bar|");
    assert.equal(
      await remote(["ls-tree", "-r", "--name-only", tip]),
      "after/ask bar.png\nbefore/ask bar.png",
    );
    // Nothing of the checkout's own changed.
    assert.equal(await run(["status", "--porcelain", "--untracked-files=no"]), "");

    png("third.png", "three");
    const [again] = (await shotsPush(run, work, "ask-bar", ["third.png"])).split("\n");
    const next = await remote(["rev-parse", "refs/heads/shots/ask-bar"]);
    assert.equal(again, `https://raw.githubusercontent.com/oriel-app/oriel/${next}/third.png`);
    assert.equal(await remote(["log", "-1", "--format=%P", next]), tip);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shots-push refuses a branch it didn't make, a file that isn't a PNG, and an empty commit ID", async () => {
  const { root, work, run, remote, png } = await checkout();
  try {
    png("a.png", "a");
    writeFileSync(join(work, "fake.png"), "not a png");
    await assert.rejects(shotsPush(run, work, "fake", ["fake.png"]), /fake\.png isn't a PNG/);

    // Someone's branch: a code commit, and an images commit named for another branch.
    writeFileSync(join(work, "code.ts"), "export {};\n");
    await run(["add", "code.ts"]);
    await run(["commit", "--quiet", "-m", "shots: theirs"]);
    await run(["push", "--quiet", "origin", "HEAD:refs/heads/shots/theirs"]);
    await shotsPush(run, work, "other", ["a.png"]);
    const other = await remote(["rev-parse", "refs/heads/shots/other"]);
    await remote(["update-ref", "refs/heads/shots/mine", other]);
    for (const branch of ["theirs", "mine"]) {
      const was = await remote(["rev-parse", `refs/heads/shots/${branch}`]);
      await assert.rejects(shotsPush(run, work, branch, ["a.png"]), /is someone else's/);
      assert.equal(await remote(["rev-parse", `refs/heads/shots/${branch}`]), was);
    }

    // A git that answers commit-tree with nothing: no push, so no deleted branch.
    const pushed: string[][] = [];
    const blank = async (args: readonly string[], env?: Record<string, string>) => {
      if (args[0] === "commit-tree") return "";
      if (args[0] === "push") pushed.push([...args]);
      return run(args, env);
    };
    await assert.rejects(shotsPush(blank, work, "other", ["a.png"]), /made the commit as ""/);
    assert.deepEqual(pushed, []);
    assert.equal(await remote(["rev-parse", "refs/heads/shots/other"]), other);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
