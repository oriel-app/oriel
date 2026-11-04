// Agents' only way to GitHub (decision 0014): a fixed set of operations on
// this repo, over the REST and GraphQL APIs, as the fine-grained agent token
// from .env. There is no gh, so no saved logins, aliases, extensions, file
// reads, other hosts or pass-through flags. Usage: pnpm -s github <operation>
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
  pr-enqueue <number>
  pr-wait <number>
  runs [branch]
  next-decision
  shots-push <branch> <png>...
A title is one line, type(scope): summary (SPEC §10), and a body never is,
so a title and body given the wrong way round are refused. While CI runs,
pr-enqueue arms auto-merge instead, and the PR enters the queue when it passes.
pr-wait returns within 9 minutes with one line: MERGED <sha>; DROPPED, open
but neither in the merge queue nor armed to enter it; FAILED <check>, then
the check's annotations; or WAITING. Call it again on WAITING.
shots-push commits the PNGs, at their paths from here, as the images-only
branch shots/<branch>, from the git checkout you run it in, and prints each
one's raw URL pinned to that commit. A later push to the same branch adds a
commit on top, so earlier URLs keep working. It refuses a remote
shots/<branch> it didn't make.`;

export type Operation =
  | { op: "pr-list" | "next-decision" }
  | { op: "pr-view" | "pr-enqueue" | "pr-wait"; number: number }
  | { op: "pr-create"; branch: string; title: string; body: string }
  | { op: "pr-edit"; number: number; body: string; title?: string }
  | { op: "runs"; branch: string | null }
  | { op: "shots-push"; branch: string; pngs: string[] };

// SPEC §10: branch names are at most three hyphenated words, no prefixes.
const branchName = /^[a-z0-9]+(-[a-z0-9]+){0,2}$/;
const prNumber = (value: string | undefined) =>
  value && /^[1-9][0-9]*$/.test(value) ? Number(value) : null;
// pr-create takes the title before the body and pr-edit after it, so each is
// told by its shape: a title is one line, SPEC §10's `type(scope): summary`,
// and a body never is. A pair given the wrong way round is refused rather
// than published swapped. Neither is a flag, so `--title x` can't become a
// body or `--draft` a title.
const isTitle = (text: string) =>
  /^[a-z]+(\([a-z0-9,-]+\))?!?: (?=\S)[^\p{Cc}\p{Zl}\p{Zp}]+$/u.test(text);
const isBody = (text: string) => text.trim() !== "" && !text.startsWith("--") && !isTitle(text);

export function parse(args: readonly string[]): Operation | { error: string } {
  const [op, ...rest] = args;
  if ((op === "pr-list" || op === "next-decision") && rest.length === 0) return { op };
  if ((op === "pr-view" || op === "pr-enqueue" || op === "pr-wait") && rest.length === 1) {
    const number = prNumber(rest[0]);
    if (number) return { op, number };
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

// What an operation would publish on a PR's page.
export function published(operation: Operation): string[] {
  if (operation.op === "pr-create") return [operation.title, operation.body];
  if (operation.op === "pr-edit") return [operation.title ?? "", operation.body];
  return [];
}

// Only a PR from a branch of this repo may enter the merge queue or have its
// title or body rewritten: a fork's PR is attacker input, whatever its title or branch
// name says (decision 0012).
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

// Why GitHub refused an enqueue, if the only answer is to wait for CI: a
// required check still queued or running, or mergeability not yet worked
// out. GitHub joins reasons with " and Pull request …", so every one must be
// a wait; a conflict or a failing check alongside one is not.
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

const autoMergeOff = (errors: GraphqlResult["errors"]) =>
  (errors ?? []).some(({ message = "" }) =>
    /auto.?merge (is )?(not allowed|not enabled|disabled)/i.test(message),
  );

// Enqueue the PR, pinned to the commit just checked so a push in between
// can't slip in. While CI runs, GitHub refuses an enqueue, so arm auto-merge
// instead: the PR enters the queue when CI passes. That pin holds only while
// arming; auto-merge stays armed through later pushes, so the agent pushes
// nothing more without a fresh go-ahead. This changes when the merge happens,
// not who decides (decision 0012).
export async function enqueue(
  send: Graphql,
  pr: { id: string; number: number; headRefOid: string },
): Promise<unknown> {
  const variables = { id: pr.id, oid: pr.headRefOid };
  const enqueued = await send(
    `mutation ($id: ID!, $oid: GitObjectID!) {
      enqueuePullRequest(input: { pullRequestId: $id, expectedHeadOid: $oid }) {
        mergeQueueEntry { state position }
      }
    }`,
    variables,
  );
  if (!enqueued.errors) return enqueued.data;
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
    return `auto-merge armed: PR #${pr.number} at ${pr.headRefOid.slice(0, 7)} enters the merge queue when CI passes. It stays armed through later pushes, so push nothing more to it without a fresh go-ahead.`;
  if (autoMergeOff(armed.errors))
    throw new Error(
      `not enqueued: ${waiting} Auto-merge is off for ${repo.owner}/${repo.name}, and the agent token can't turn it on. Needs you: tick "Allow auto-merge" under Settings → General → Pull Requests. Until then, run pr-enqueue again once CI passes.`,
    );
  throw new Error(
    `not enqueued: ${waiting} Arming auto-merge failed too: ${graphqlError(armed.errors).message}`,
  );
}

// The number after the highest decision on main or in any open PR, so two
// decisions drafted at once can't share one.
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

// What pr-wait reads of a PR on each look.
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

// A run that ended this way won't merge the PR. A cancelled one isn't
// counted: the queue cancels a group's runs when it rebuilds the group.
const failing = (run: CheckRun) =>
  run.status === "completed" &&
  ["failure", "timed_out", "startup_failure", "action_required"].includes(run.conclusion ?? "");

export const waitLimitMs = 9 * 60_000;
const lookEveryMs = 20_000;

// Looks at a PR until it merges, fails a check, leaves the queue or the
// time is up, whichever comes first. The checks it reads are its head's and
// its merge queue entry's, the last one seen, so a group the queue dropped
// for a failure still says which check failed.
export async function waitFor(
  reads: Reads,
  clock: () => number,
  pause: (ms: number) => Promise<void>,
): Promise<string> {
  const deadline = clock() + waitLimitMs;
  let queued: string | null = null;
  for (;;) {
    const pr = await reads.pullRequest();
    if (pr.state === "MERGED") return `MERGED ${pr.mergeCommit?.oid ?? "(no merge commit)"}`;
    queued = pr.mergeQueueEntry?.headCommit?.oid ?? queued;
    for (const sha of new Set([pr.headRefOid, ...(queued ? [queued] : [])])) {
      const failed = (await reads.checkRuns(sha)).find(failing);
      if (!failed) continue;
      const notes = (await reads.annotations(failed.id)).map(
        (a) =>
          `  ${a.annotation_level} ${a.path}:${a.start_line} ${a.title ? `${a.title}: ` : ""}${a.message.replaceAll("\n", "\n    ")}`,
      );
      return [`FAILED ${failed.name}`, ...notes].join("\n");
    }
    if (pr.state === "CLOSED") return "DROPPED: closed without merging";
    if (!pr.isInMergeQueue && !pr.autoMergeRequest)
      return "DROPPED: open, not in the merge queue, and no auto-merge armed";
    if (clock() + lookEveryMs >= deadline) return "WAITING";
    await pause(lookEveryMs);
  }
}

// Runs git where the caller is, and returns its output trimmed.
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

// Each PNG's path in the commit: its path from `from`, which it must be
// inside, so a push can't name a file outside the checkout's reach.
export function shotPaths(from: string, pngs: readonly string[]): string[] | { error: string } {
  const paths = pngs.map((png) => relative(from, resolve(from, png)).split(sep).join("/"));
  // Two paths to one file, or one given twice, would be one entry.
  const outside = paths.find((path) => path === "" || path.startsWith("../") || isAbsolute(path));
  if (outside !== undefined) return { error: `refusing: a PNG outside ${from}: ${outside}` };
  if (new Set(paths).size !== paths.length) return { error: "refusing: a PNG given twice" };
  return paths;
}

// Commits the PNGs as an images-only commit on shots/<branch> and pushes it,
// with plumbing, so no checkout, index or stash is touched. The branch is
// made fresh, or grows by a commit when its tip is one of these, so a raw URL
// given earlier still resolves. Anything else there is someone's: refused.
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
    case "pr-view":
      return graphql(token, pullRequestQuery, { ...repo, number: operation.number });
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
      const pr = await pullRequest(token, operation.number);
      const refusal = headRefusal(pr, "enqueue");
      if (refusal) throw new Error(refusal);
      return enqueue(
        async (query, variables) =>
          (await call(token, "POST", "/graphql", { query, variables })) as GraphqlResult,
        pr,
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
        checkRuns: async (sha) =>
          (
            (await call(
              token,
              "GET",
              `${base}/commits/${sha}/check-runs?filter=latest&per_page=100`,
            )) as { check_runs: CheckRun[] }
          ).check_runs,
        annotations: async (id) =>
          (await call(
            token,
            "GET",
            `${base}/check-runs/${id}/annotations?per_page=50`,
          )) as Annotation[],
      };
      return waitFor(reads, Date.now, (ms) => new Promise((done) => setTimeout(done, ms)));
    }
    case "shots-push":
      throw new Error("shots-push runs git, not the API");
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
