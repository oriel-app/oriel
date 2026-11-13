// Usage: pnpm -s github <operation>
// As the fine-grained agent token from .env, never gh: no saved logins, aliases, extensions,
// file reads, other hosts or pass-through flags.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, promisify } from "node:util";

const repo = { owner: "oriel-app", name: "oriel" };
const api = "https://api.github.com";

export const usage = `usage: pnpm -s github <operation>
  pr-list
  pr-view <number>
  pr-create <branch> <title> <body>
  pr-edit <number> <body> [title]
  pr-enqueue <number> [--despite <check>]...
  pr-wait <number>
  runs [branch]
  next-decision
  shots-push <branch> <png>...
  landed
A title is one line, type(scope): summary (SPEC §10), and a body never is,
so a title and body given the wrong way round are refused. While CI runs,
pr-enqueue arms auto-merge instead, and the PR enters the queue when it passes.
pr-enqueue refuses while a check on the head has failed, been cancelled or
timed out, or while one the merge queue won't wait for is still running: one
that main's ruleset doesn't require, such as ui. --despite <check> lets that
one check through, and the output names each.
pr-enqueue retries once, 3 seconds on, when GitHub hasn't yet seen a push
that just landed. pr-view's first fields say whether the PR is in the merge
queue and whether auto-merge is armed.
pr-wait returns within 9 minutes with one line: MERGED <sha>; CI PASSED, for
a PR that wasn't queued or armed at any look, once its head's checks all
pass; DROPPED, queued or armed at a look and then neither; FAILED <check>,
then the check's annotations; or WAITING. Call it again on WAITING.
shots-push commits the PNGs, at their paths from here, as the images-only
branch shots/<branch>, from the git checkout you run it in, and prints each
one's raw URL pinned to that commit. A later push to the same branch adds a
commit on top, so earlier URLs keep working. It refuses a remote
shots/<branch> it didn't make.
landed fetches main, then prints a line for each PR merged since this
branch's base (git merge-base HEAD origin/main), from git alone: the files
both it and this branch change (overlap); whether it's agent-facing, so
cassettes made before it no longer replay; a migration number this branch
adds too; and a generated design-system file both change, with the command
that writes it again.`;

export type Operation =
  | { op: "pr-list" | "next-decision" | "landed" }
  | { op: "pr-view" | "pr-wait"; number: number }
  | { op: "pr-enqueue"; number: number; despite: string[] }
  | { op: "pr-create"; branch: string; title: string; body: string }
  | { op: "pr-edit"; number: number; body: string; title?: string }
  | { op: "runs"; branch: string | null }
  | { op: "shots-push"; branch: string; pngs: string[] };

const branchName = /^[a-z0-9]+(-[a-z0-9]+){0,2}$/;
const prNumber = (value: string | undefined) =>
  value && /^[1-9][0-9]*$/.test(value) ? Number(value) : null;
// Title and body are told apart by shape, so a pair given the wrong way round is refused
// rather than published swapped, and neither can be a flag.
const isTitle = (text: string) =>
  /^[a-z]+(\([a-z0-9,-]+\))?!?: (?=\S)[^\p{Cc}\p{Zl}\p{Zp}]+$/u.test(text);
const isBody = (text: string) => text.trim() !== "" && !text.startsWith("--") && !isTitle(text);
const checkName = /^[\w.()/][\w .()/-]*$/;

export function parse(args: readonly string[]): Operation | { error: string } {
  const [op, ...rest] = args;
  if ((op === "pr-list" || op === "next-decision" || op === "landed") && rest.length === 0)
    return { op };
  if ((op === "pr-view" || op === "pr-wait") && rest.length === 1) {
    const number = prNumber(rest[0]);
    if (number) return { op, number };
  }
  if (op === "pr-enqueue" && rest.length % 2 === 1) {
    const [first, ...flags] = rest;
    const number = prNumber(first);
    const despite = flags.filter((_, i) => i % 2 === 1);
    const pairs = flags.every((flag, i) =>
      i % 2 === 0 ? flag === "--despite" : checkName.test(flag),
    );
    if (number && pairs) return { op, number, despite };
  }
  if (op === "pr-create" && rest.length === 3) {
    const [branch = "", title = "", body = ""] = rest;
    if (branchName.test(branch) && isTitle(title) && isBody(body))
      return { op, branch, title, body };
  }
  if (op === "pr-edit" && (rest.length === 2 || rest.length === 3)) {
    const [, body = "", title] = rest;
    const number = prNumber(rest[0]);
    if (number && isBody(body) && title === undefined) return { op, number, body };
    if (number && isBody(body) && title !== undefined && isTitle(title))
      return { op, number, body, title };
  }
  if (op === "runs" && rest.length <= 1) {
    const branch = rest[0] ?? null;
    if (branch === null || branchName.test(branch)) return { op, branch };
  }
  if (op === "shots-push" && rest.length >= 2) {
    const [branch = "", ...pngs] = rest;
    if (
      branchName.test(branch) &&
      pngs.every((png) => png.endsWith(".png") && !png.startsWith("-"))
    )
      return { op, branch, pngs };
  }
  return { error: usage };
}

export function agentToken(envFile: string | null): string | null {
  const token = envFile ? parseEnv(envFile).GH_TOKEN : undefined;
  return token && /^github_pat_\w+$/.test(token) ? token : null;
}

// A PR title or body must never carry a credential from .env onto a public
// page. Plain settings such as JIRA_SITE may appear.
export function leaksSecret(texts: readonly string[], envFile: string | null): boolean {
  const values = Object.entries(envFile ? parseEnv(envFile) : {})
    .filter(([key]) => /TOKEN|KEY|SECRET|PASSWORD|EMAIL/.test(key))
    .map(([, value]) => value)
    .filter((value): value is string => typeof value === "string" && value.length >= 8);
  return texts.some((text) => values.some((value) => text.includes(value)));
}

export function published(operation: Operation): string[] {
  if (operation.op === "pr-create") return [operation.title, operation.body];
  if (operation.op === "pr-edit") return [operation.title ?? "", operation.body];
  return [];
}

// A fork's PR is attacker input, whatever its title or branch name says: only a PR from a
// branch of this repo may be enqueued or have its title or body rewritten.
export function headRefusal(
  pr: { isCrossRepository: boolean; headRepository: { nameWithOwner: string } | null },
  action: "enqueue" | "edit",
): string | null {
  const own = `${repo.owner}/${repo.name}`;
  if (pr.isCrossRepository || pr.headRepository?.nameWithOwner !== own) {
    return `refusing to ${action} a PR whose head is not a branch of ${own} (head: ${pr.headRepository?.nameWithOwner ?? "deleted"})`;
  }
  return null;
}

async function call(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

type GraphqlResult = { data?: unknown; errors?: { type?: string; message?: string }[] };
type Graphql = (query: string, variables: Record<string, unknown>) => Promise<GraphqlResult>;

const graphqlError = (errors: unknown) =>
  new Error(`graphql: ${JSON.stringify(errors).slice(0, 300)}`);

async function graphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const result = (await call(token, "POST", "/graphql", { query, variables })) as GraphqlResult;
  if (result.errors) throw graphqlError(result.errors);
  return result.data;
}

// GitHub joins reasons with " and Pull request …", so every one must be a wait; a conflict
// or a failing check alongside one is not.
export function waitingOnChecks(errors: GraphqlResult["errors"]): string | null {
  const messages = (errors ?? []).map(({ message = "" }) => message);
  const waits = (reason: string) =>
    /^(Pull request )?Required status check "[^"]*" is (queued|in progress|expected|pending|waiting)\.?$/i.test(
      reason,
    ) ||
    /^(Pull request )?mergeability check has not yet completed$/i.test(reason) ||
    /^(Pull request )?not in mergeable state$/i.test(reason);
  const all = messages.flatMap((message) => message.split(/ and (?=Pull request )/));
  return all.length > 0 && all.every(waits) && all.some((r) => !/not in mergeable state/i.test(r))
    ? messages.join(" ")
    : null;
}

export type Enqueued = { id: string; number: number; headRefOid: string };

const headMoved = (errors: GraphqlResult["errors"]) =>
  (errors ?? []).some(({ message = "" }) =>
    /expected head oid does not match the current head oid/i.test(message),
  );
export const headMovedPauseMs = 3_000;

const autoMergeOff = (errors: GraphqlResult["errors"]) =>
  (errors ?? []).some(({ message = "" }) =>
    /auto.?merge (is )?(not allowed|not enabled|disabled)/i.test(message),
  );

export type Checks = {
  runs(sha: string): Promise<CheckRun[]>;
  required(): Promise<string[]>;
  despite: readonly string[];
};

const red = (run: CheckRun) =>
  run.status === "completed" &&
  ["failure", "cancelled", "timed_out", "startup_failure", "action_required"].includes(
    run.conclusion ?? "",
  );

export async function checksGate(
  checks: Checks,
  sha: string,
): Promise<{ refusal: string | null; notes: string[] }> {
  const runs = await checks.runs(sha);
  const required = await checks.required();
  const stopping = runs.filter(
    (run) => red(run) || (run.status !== "completed" && !required.includes(run.name)),
  );
  const said = (run: CheckRun) =>
    run.status === "completed"
      ? `${run.name} (${run.conclusion})`
      : `${run.name} (${run.status}, and main's ruleset requires only ${required.join(", ") || "nothing"}, so the merge queue won't wait for it)`;
  const notes = checks.despite.map((name) => {
    const run = runs.find((r) => r.name === name);
    return `despite ${name}: ${run ? (stopping.includes(run) ? said(run) : `${run.status} ${run.conclusion ?? ""}`.trim()) : "no such check on the head"}`;
  });
  const left = stopping.filter((run) => !checks.despite.includes(run.name));
  if (left.length === 0) return { refusal: null, notes };
  return {
    refusal: [
      `not enqueued: PR head ${sha.slice(0, 7)} has ${left.map(said).join("; ")}.`,
      "Fix it and push, or rerun it, then run pr-enqueue again once it passes. To enqueue anyway, pass --despite <check> for each, and say why in the PR.",
      ...notes,
    ].join("\n"),
    notes,
  };
}

// GitHub refuses an enqueue while CI runs, so auto-merge is armed, which outlives later pushes;
// right after a push it may refuse the head it reports, so the PR is read again 3 s on.
export async function enqueue(
  send: Graphql,
  first: Enqueued,
  pause: (ms: number) => Promise<void>,
  reread: () => Promise<Enqueued>,
  checks: Checks,
): Promise<unknown> {
  let pr = first;
  let notes: string[] = [];
  const gate = async (on: Enqueued) => {
    const gated = await checksGate(checks, on.headRefOid);
    if (gated.refusal) throw new Error(gated.refusal);
    notes = gated.notes;
  };
  const said = (result: unknown) =>
    notes.length === 0
      ? result
      : [...notes, typeof result === "string" ? result : JSON.stringify(result, null, 2)].join(
          "\n",
        );
  await gate(pr);
  const enqueueOn = (on: Enqueued) =>
    send(
      `mutation ($id: ID!, $oid: GitObjectID!) {
        enqueuePullRequest(input: { pullRequestId: $id, expectedHeadOid: $oid }) {
          mergeQueueEntry { state position }
        }
      }`,
      { id: on.id, oid: on.headRefOid },
    );
  let enqueued = await enqueueOn(pr);
  if (headMoved(enqueued.errors)) {
    await pause(headMovedPauseMs);
    pr = await reread();
    await gate(pr);
    enqueued = await enqueueOn(pr);
  }
  if (!enqueued.errors) return said(enqueued.data);
  const variables = { id: pr.id, oid: pr.headRefOid };
  const waiting = waitingOnChecks(enqueued.errors);
  if (!waiting) throw graphqlError(enqueued.errors);
  const armed = await send(
    `mutation ($id: ID!, $oid: GitObjectID!) {
      enablePullRequestAutoMerge(
        input: { pullRequestId: $id, expectedHeadOid: $oid, mergeMethod: SQUASH }
      ) {
        pullRequest { autoMergeRequest { enabledAt } }
      }
    }`,
    variables,
  );
  if (!armed.errors)
    return said(
      `auto-merge armed: PR #${pr.number} at ${pr.headRefOid.slice(0, 7)} enters the merge queue when CI passes. It stays armed through later pushes, so push nothing more to it without a fresh go-ahead.`,
    );
  if (autoMergeOff(armed.errors))
    throw new Error(
      `not enqueued: ${waiting} Auto-merge is off for ${repo.owner}/${repo.name}, and the agent token can't turn it on. Needs you: tick "Allow auto-merge" under Settings → General → Pull Requests. Until then, run pr-enqueue again once CI passes.`,
    );
  throw new Error(
    `not enqueued: ${waiting} Arming auto-merge failed too: ${graphqlError(armed.errors).message}`,
  );
}

export function nextDecision(paths: readonly string[]): string {
  const taken = paths.flatMap((path) => {
    const number = /^docs\/decisions\/(\d{4})-[^/]*\.md$/.exec(path)?.[1];
    return number ? [Number(number)] : [];
  });
  return String(Math.max(0, ...taken) + 1).padStart(4, "0");
}

const pullRequestQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id number title state headRefName headRefOid isCrossRepository
      headRepository { nameWithOwner }
      mergeable mergeStateStatus isInMergeQueue
      mergeQueueEntry { headCommit { oid } }
      autoMergeRequest { enabledAt }
      mergeCommit { oid }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
    }
  }
}`;

async function pullRequest(token: string, number: number) {
  const data = (await graphql(token, pullRequestQuery, { ...repo, number })) as {
    repository: {
      pullRequest: {
        id: string;
        number: number;
        headRefOid: string;
        isCrossRepository: boolean;
        headRepository: { nameWithOwner: string } | null;
      } | null;
    };
  };
  const pr = data.repository.pullRequest;
  if (!pr) throw new Error(`no PR #${number} in ${repo.owner}/${repo.name}`);
  return pr;
}

export type Viewed = {
  number: number;
  title: string;
  state: string;
  isInMergeQueue: boolean;
  autoMergeRequest: unknown;
};
export function viewed<T extends Viewed>(pr: T) {
  const { number, title, state, ...rest } = pr;
  return {
    number,
    title,
    state,
    inMergeQueue: pr.isInMergeQueue,
    autoMergeArmed: Boolean(pr.autoMergeRequest),
    ...rest,
  };
}

export type Watched = {
  state: "OPEN" | "CLOSED" | "MERGED";
  headRefOid: string;
  isInMergeQueue: boolean;
  mergeQueueEntry: { headCommit: { oid: string } | null } | null;
  autoMergeRequest: unknown;
  mergeCommit: { oid: string } | null;
};
export type CheckRun = { id: number; name: string; status: string; conclusion: string | null };
export type Annotation = {
  path: string;
  start_line: number;
  annotation_level: string;
  title?: string | null;
  message: string;
};
export type Reads = {
  pullRequest(): Promise<Watched>;
  checkRuns(sha: string): Promise<CheckRun[]>;
  annotations(checkRunId: number): Promise<Annotation[]>;
};

// A cancelled run isn't failing: the queue cancels a group's runs when it rebuilds the group.
const failing = (run: CheckRun) =>
  run.status === "completed" &&
  ["failure", "timed_out", "startup_failure", "action_required"].includes(run.conclusion ?? "");

const succeeded = (run: CheckRun) =>
  run.status === "completed" && ["success", "neutral", "skipped"].includes(run.conclusion ?? "");

export const waitLimitMs = 9 * 60_000;
const lookEveryMs = 20_000;
// A PR leaves the queue a moment before GitHub marks it merged, so one
// that looks dropped is looked at again, sooner, before it's called so.
const dropLooks = 3;
const dropLookEveryMs = 10_000;

export async function waitFor(
  reads: Reads,
  clock: () => number,
  pause: (ms: number) => Promise<void>,
): Promise<string> {
  const deadline = clock() + waitLimitMs;
  let queued: string | null = null;
  let joined = false;
  let outLooks = 0;
  for (;;) {
    const pr = await reads.pullRequest();
    if (pr.state === "MERGED") return `MERGED ${pr.mergeCommit?.oid ?? "(no merge commit)"}`;
    queued = pr.mergeQueueEntry?.headCommit?.oid ?? queued;
    const inLine = pr.isInMergeQueue || Boolean(pr.autoMergeRequest);
    joined ||= inLine;
    let headRuns: CheckRun[] = [];
    for (const sha of new Set([pr.headRefOid, ...(queued ? [queued] : [])])) {
      const runs = await reads.checkRuns(sha);
      if (sha === pr.headRefOid) headRuns = runs;
      const failed = runs.find(failing);
      if (!failed) continue;
      const notes = (await reads.annotations(failed.id)).map(
        (a) =>
          `  ${a.annotation_level} ${a.path}:${a.start_line} ${a.title ? `${a.title}: ` : ""}${a.message.replaceAll("\n", "\n    ")}`,
      );
      return [`FAILED ${failed.name}`, ...notes].join("\n");
    }
    if (pr.state === "CLOSED") return "DROPPED: closed without merging";
    if (!joined && headRuns.length > 0 && headRuns.every(succeeded)) return "CI PASSED";
    outLooks = joined && !inLine ? outLooks + 1 : 0;
    if (outLooks >= dropLooks)
      return "DROPPED: open, not in the merge queue, and no auto-merge armed";
    const every = outLooks > 0 ? dropLookEveryMs : lookEveryMs;
    if (clock() + every >= deadline) return "WAITING";
    await pause(every);
  }
}

export type Git = (args: readonly string[], env?: Record<string, string>) => Promise<string>;
const execGit = promisify(execFile);
export const git: Git = async (args, env) =>
  (
    await execGit("git", [...args], {
      env: env ? { ...process.env, ...env } : process.env,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout.trim();

const isSha = (value: string) => /^[0-9a-f]{40}$/.test(value);
const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function shotPaths(from: string, pngs: readonly string[]): string[] | { error: string } {
  const paths = pngs.map((png) => relative(from, resolve(from, png)).split(sep).join("/"));
  const outside = paths.find((path) => path === "" || path.startsWith("../") || isAbsolute(path));
  if (outside !== undefined) return { error: `refusing: a PNG outside ${from}: ${outside}` };
  if (new Set(paths).size !== paths.length) return { error: "refusing: a PNG given twice" };
  return paths;
}

export async function shotsPush(
  run: Git,
  from: string,
  branch: string,
  pngs: readonly string[],
  remote = "origin",
): Promise<string> {
  const paths = shotPaths(from, pngs);
  if ("error" in paths) throw new Error(paths.error);
  for (const png of pngs) {
    const head = readFileSync(resolve(from, png)).subarray(0, 8);
    if (!head.equals(pngMagic)) throw new Error(`refusing: ${png} isn't a PNG`);
  }
  const ref = `refs/heads/shots/${branch}`;
  const message = `shots: ${branch}`;
  const listed = await run(["ls-remote", remote, ref]);
  const tip =
    listed
      .split("\n")
      .map((line) => line.split("\t"))
      .find(([, name]) => name === ref)?.[0] ?? "";
  if (tip !== "") {
    if (!isSha(tip)) throw new Error(`refusing: can't read ${ref} on ${remote}: ${listed}`);
    await run(["fetch", "--no-write-fetch-head", "--no-prune", "--quiet", remote, tip]);
    const subject = await run(["log", "-1", "--format=%s", tip]);
    const files = (await run(["ls-tree", "-r", "--name-only", tip])).split("\n");
    if (subject !== message || !files.every((file) => file.endsWith(".png")))
      throw new Error(
        `refusing: ${ref} is someone else's (its tip ${tip.slice(0, 7)} isn't an images-only "${message}" commit). Pick another branch name.`,
      );
  }
  const index = mkdtempSync(join(tmpdir(), "oriel-shots-push-"));
  try {
    const env = { GIT_INDEX_FILE: join(index, "index") };
    for (const [i, png] of pngs.entries()) {
      const blob = await run(["hash-object", "-w", "--", resolve(from, png)]);
      if (!isSha(blob)) throw new Error(`refusing: git stored ${png} as "${blob}"`);
      await run(["update-index", "--add", "--cacheinfo", `100644,${blob},${paths[i]}`], env);
    }
    const tree = await run(["write-tree"], env);
    if (!isSha(tree)) throw new Error(`refusing: git wrote the tree as "${tree}"`);
    const commit = await run(["commit-tree", tree, ...(tip ? ["-p", tip] : []), "-m", message]);
    // An empty commit ID would make the push below delete the branch.
    if (!isSha(commit)) throw new Error(`refusing: git made the commit as "${commit}"`);
    await run(["push", "--quiet", remote, `${commit}:${ref}`]);
    return paths
      .map(
        (path) =>
          `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`,
      )
      .join("\n");
  } finally {
    rmSync(index, { recursive: true, force: true });
  }
}

export type Changed = { status: string; path: string; from?: string };
export type LandedPr = { sha: string; number: number | null; title: string; files: Changed[] };

export function changedFiles(text: string): Changed[] {
  return text.split("\n").flatMap((line) => {
    const [status = "", path = "", renamed] = line.split("\t");
    if (!/^[ACDMRTU]/.test(status) || path === "") return [];
    return [renamed ? { status: status[0] ?? "", path: renamed, from: path } : { status, path }];
  });
}

export const landedLogFormat = "%x00%H %s";
export function landedLog(text: string): LandedPr[] {
  return text
    .split("\0")
    .filter((entry) => entry.trim() !== "")
    .map((entry) => {
      const [head = "", ...rest] = entry.split("\n");
      const space = head.indexOf(" ");
      const sha = head.slice(0, space);
      const subject = head.slice(space + 1);
      const number = /\s\(#(\d+)\)$/.exec(subject);
      return {
        sha,
        number: number ? Number(number[1]) : null,
        title: number ? subject.slice(0, number.index) : subject,
        files: changedFiles(rest.join("\n")),
      };
    });
}

export function agentFacing(path: string): boolean {
  const code = (dir: string) =>
    path.startsWith(dir) && !path.endsWith(".test.ts") && !path.endsWith("/testing.ts");
  return (
    path.startsWith("tests/cassettes/") ||
    code("packages/agent/src/") ||
    code("packages/bindings/src/") ||
    /^packages\/[^/]+\/src\/(namespace|declaration)\.ts$/.test(path) ||
    /^packages\/evals\/src\/(system|world|graders|fixtures)\.ts$/.test(path) ||
    path.startsWith("packages/evals/cases/") ||
    path.startsWith("fixtures/") ||
    path === "packages/core/src/challenge.ts"
  );
}

const migrationNumber = (file: Changed) =>
  file.status === "A" ? (/^packages\/db\/migrations\/(\d+)_/.exec(file.path)?.[1] ?? null) : null;

export const generated: Record<string, string> = {
  "packages/design-system/COMPONENTS.md": "pnpm --filter @oriel/design-system index",
};

export function landedReport(base: string, landed: readonly LandedPr[], mine: readonly Changed[]) {
  if (landed.length === 0) return `nothing landed on main since ${base.slice(0, 7)}`;
  const paths = (files: readonly Changed[]) =>
    new Set(files.flatMap((f) => (f.from ? [f.path, f.from] : [f.path])));
  const own = paths(mine);
  const ownMigrations = new Set(mine.map(migrationNumber).filter((n) => n !== null));
  const list = (names: readonly string[]) =>
    names.length === 0
      ? "none"
      : names.length <= 4
        ? names.join(", ")
        : `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`;
  return landed
    .map((pr) => {
      const theirs = [...paths(pr.files)];
      const overlap = theirs.filter((path) => own.has(path));
      const facing = [
        ...new Set(
          theirs
            .filter(agentFacing)
            .map((path) => (path.startsWith("tests/cassettes/") ? "tests/cassettes/" : path)),
        ),
      ];
      const clash = pr.files
        .map(migrationNumber)
        .filter((n): n is string => n !== null && ownMigrations.has(n));
      const design = overlap.flatMap((path) => {
        const command = generated[path];
        return command ? [`${path} (regenerate: ${command})`] : [];
      });
      return [
        `${pr.number ? `#${pr.number}` : pr.sha.slice(0, 7)} ${pr.title}`,
        `overlap: ${list(overlap)}`,
        `agent-facing: ${facing.length > 0 ? `yes (${list(facing)})` : "no"}`,
        `migration clash: ${list(clash)}`,
        `design system: ${list(design)}`,
      ].join(" · ");
    })
    .join("\n");
}

export async function landed(run: Git): Promise<string> {
  const base = await run(["merge-base", "HEAD", "origin/main"]);
  const log = await run([
    "log",
    "--first-parent",
    "--diff-merges=first-parent",
    "--name-status",
    "-M",
    `--format=${landedLogFormat}`,
    `${base}..origin/main`,
  ]);
  const mine = [
    ...changedFiles(await run(["diff", "--name-status", "-M", base])),
    ...(await run(["ls-files", "--others", "--exclude-standard"]))
      .split("\n")
      .filter((path) => path !== "")
      .map((path) => ({ status: "A", path })),
  ];
  return landedReport(base, landedLog(log), mine);
}

async function checkRuns(token: string, sha: string): Promise<CheckRun[]> {
  return (
    (await call(
      token,
      "GET",
      `/repos/${repo.owner}/${repo.name}/commits/${sha}/check-runs?filter=latest&per_page=100`,
    )) as { check_runs: CheckRun[] }
  ).check_runs;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export async function run(token: string, operation: Operation): Promise<unknown> {
  const base = `/repos/${repo.owner}/${repo.name}`;
  switch (operation.op) {
    case "pr-list": {
      const pulls = (await call(token, "GET", `${base}/pulls?state=open`)) as {
        number: number;
        title: string;
        head: { ref: string; repo: { full_name: string } | null };
      }[];
      return pulls.map((p) => ({
        number: p.number,
        title: p.title,
        branch: p.head.ref,
        from: p.head.repo?.full_name ?? "deleted",
      }));
    }
    case "pr-view": {
      const data = (await graphql(token, pullRequestQuery, {
        ...repo,
        number: operation.number,
      })) as {
        repository: { pullRequest: Viewed | null };
      };
      const pr = data.repository.pullRequest;
      if (!pr) throw new Error(`no PR #${operation.number} in ${repo.owner}/${repo.name}`);
      return viewed(pr);
    }
    case "pr-create": {
      const created = (await call(token, "POST", `${base}/pulls`, {
        title: operation.title,
        head: operation.branch,
        base: "main",
        body: operation.body,
      })) as { number: number; html_url: string };
      return { number: created.number, url: created.html_url };
    }
    case "pr-edit": {
      const pr = await pullRequest(token, operation.number);
      const refusal = headRefusal(pr, "edit");
      if (refusal) throw new Error(refusal);
      const edited = (await call(token, "PATCH", `${base}/pulls/${operation.number}`, {
        body: operation.body,
        ...(operation.title === undefined ? {} : { title: operation.title }),
      })) as { number: number; html_url: string };
      return { number: edited.number, url: edited.html_url };
    }
    case "pr-enqueue": {
      const own = async () => {
        const pr = await pullRequest(token, operation.number);
        const refusal = headRefusal(pr, "enqueue");
        if (refusal) throw new Error(refusal);
        return pr;
      };
      return enqueue(
        async (query, variables) =>
          (await call(token, "POST", "/graphql", { query, variables })) as GraphqlResult,
        await own(),
        sleep,
        own,
        {
          runs: (sha) => checkRuns(token, sha),
          required: async () => {
            const rules = (await call(token, "GET", `${base}/rules/branches/main`)) as {
              type: string;
              parameters?: { required_status_checks?: { context: string }[] };
            }[];
            return rules.flatMap((rule) =>
              rule.type === "required_status_checks"
                ? (rule.parameters?.required_status_checks ?? []).map((c) => c.context)
                : [],
            );
          },
          despite: operation.despite,
        },
      );
    }
    case "pr-wait": {
      const { number } = operation;
      const reads: Reads = {
        pullRequest: async () => {
          const data = (await graphql(token, pullRequestQuery, { ...repo, number })) as {
            repository: { pullRequest: Watched | null };
          };
          const pr = data.repository.pullRequest;
          if (!pr) throw new Error(`no PR #${number} in ${repo.owner}/${repo.name}`);
          return pr;
        },
        checkRuns: (sha) => checkRuns(token, sha),
        annotations: async (id) =>
          (await call(
            token,
            "GET",
            `${base}/check-runs/${id}/annotations?per_page=50`,
          )) as Annotation[],
      };
      return waitFor(reads, Date.now, sleep);
    }
    case "shots-push":
    case "landed":
      throw new Error(`${operation.op} runs git, not the API`);
    case "next-decision": {
      const onMain = (await call(token, "GET", `${base}/contents/docs/decisions?ref=main`)) as {
        path: string;
      }[];
      const pulls = (await call(token, "GET", `${base}/pulls?state=open&per_page=100`)) as {
        number: number;
      }[];
      const inPulls = await Promise.all(
        pulls.map(async ({ number }) => {
          const files: string[] = [];
          for (let page = 1; ; page++) {
            const batch = (await call(
              token,
              "GET",
              `${base}/pulls/${number}/files?per_page=100&page=${page}`,
            )) as { filename: string; previous_filename?: string }[];
            files.push(...batch.flatMap((f) => [f.filename, f.previous_filename ?? ""]));
            if (batch.length < 100) return files;
          }
        }),
      );
      return nextDecision([...onMain.map((f) => f.path), ...inPulls.flat()]);
    }
    case "runs": {
      const query = operation.branch ? `&branch=${encodeURIComponent(operation.branch)}` : "";
      const runs = (await call(token, "GET", `${base}/actions/runs?per_page=10${query}`)) as {
        workflow_runs: {
          event: string;
          head_branch: string;
          head_repository: { full_name: string } | null;
          status: string;
          conclusion: string | null;
        }[];
      };
      return runs.workflow_runs.map((r) => ({
        event: r.event,
        branch: r.head_branch,
        from: r.head_repository?.full_name ?? "deleted",
        status: r.status,
        conclusion: r.conclusion,
      }));
    }
  }
}

if (import.meta.main) {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  const envFile = existsSync(envPath) ? readFileSync(envPath, "utf8") : null;
  const token = agentToken(envFile);
  const operation = parse(process.argv.slice(2));
  // Git pushes this with the checkout's own credentials: no token, no API.
  if (!("error" in operation) && operation.op === "shots-push") {
    try {
      console.log(await shotsPush(git, process.cwd(), operation.branch, operation.pngs));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    process.exit();
  }
  if (!("error" in operation) && operation.op === "landed") {
    try {
      await execGit("git", ["fetch", "--quiet", "--no-prune", "origin", "main"], {
        timeout: 30_000,
      }).catch(() => console.error("couldn't fetch main; reading origin/main as last fetched"));
      console.log(await landed(git));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    process.exit();
  }
  if (!("error" in operation) && leaksSecret(published(operation), envFile)) {
    console.error("refusing: the title or body contains a value from .env");
    process.exit(1);
  }
  if (!token) {
    console.error(
      "GH_TOKEN in .env must be the fine-grained agent token described in env.example.",
    );
    process.exit(1);
  }
  if ("error" in operation) {
    console.error(operation.error);
    process.exit(1);
  }
  try {
    const result = await run(token, operation);
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
