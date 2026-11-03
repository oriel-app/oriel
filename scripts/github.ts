// Agents' only way to GitHub (decision 0014): a fixed set of operations on
// this repo, over the REST and GraphQL APIs, as the fine-grained agent token
// from .env. There is no gh, so no saved logins, aliases, extensions, file
// reads, other hosts or pass-through flags. Usage: pnpm -s github <operation>
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const repo = { owner: "oriel-app", name: "oriel" };
const api = "https://api.github.com";

export const usage = `usage: pnpm -s github <operation>
  pr-list
  pr-view <number>
  pr-create <branch> <title> <body>
  pr-edit <number> <body> [title]
  pr-enqueue <number>
  runs [branch]
  next-decision
A title is one line, type(scope): summary (SPEC §10), and a body never is,
so a title and body given the wrong way round are refused. While CI runs,
pr-enqueue arms auto-merge instead, and the PR enters the queue when it passes.`;

export type Operation =
  | { op: "pr-list" | "next-decision" }
  | { op: "pr-view" | "pr-enqueue"; number: number }
  | { op: "pr-create"; branch: string; title: string; body: string }
  | { op: "pr-edit"; number: number; body: string; title?: string }
  | { op: "runs"; branch: string | null };

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
  if ((op === "pr-view" || op === "pr-enqueue") && rest.length === 1) {
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

// Why GitHub refused an enqueue, if the answer is to wait for CI: a required
// check still queued or running, or mergeability not yet worked out.
export function waitingOnChecks(errors: GraphqlResult["errors"]): string | null {
  for (const { message = "" } of errors ?? [])
    if (
      /required status check .* is (queued|in progress|expected|pending|waiting)/i.test(message) ||
      /mergeability check has not yet completed/i.test(message)
    )
      return message;
  return null;
}

const autoMergeOff = (errors: GraphqlResult["errors"]) =>
  (errors ?? []).some(({ message = "" }) =>
    /auto.?merge (is )?(not allowed|not enabled|disabled)/i.test(message),
  );

// Enqueue the PR, pinned to the commit just checked so a push in between
// can't slip in. While CI runs, GitHub refuses an enqueue, so arm auto-merge
// instead, pinned the same way: the PR enters the queue when CI passes. This
// changes when the merge happens, not who decides (decision 0012).
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
    return `auto-merge armed: PR #${pr.number} at ${pr.headRefOid.slice(0, 7)} enters the merge queue when CI passes. A later push to its branch keeps it armed.`;
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
