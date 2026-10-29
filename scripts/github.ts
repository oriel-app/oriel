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
  pr-enqueue <number>
  runs [branch]`;

export type Operation =
  | { op: "pr-list" }
  | { op: "pr-view" | "pr-enqueue"; number: number }
  | { op: "pr-create"; branch: string; title: string; body: string }
  | { op: "runs"; branch: string | null };

// SPEC §10: branch names are at most three hyphenated words, no prefixes.
const branchName = /^[a-z0-9]+(-[a-z0-9]+){0,2}$/;
const prNumber = (value: string | undefined) =>
  value && /^[1-9][0-9]*$/.test(value) ? Number(value) : null;

export function parse(args: readonly string[]): Operation | { error: string } {
  const [op, ...rest] = args;
  if (op === "pr-list" && rest.length === 0) return { op };
  if ((op === "pr-view" || op === "pr-enqueue") && rest.length === 1) {
    const number = prNumber(rest[0]);
    if (number) return { op, number };
  }
  if (op === "pr-create" && rest.length === 3) {
    const [branch = "", title = "", body = ""] = rest;
    if (branchName.test(branch) && title.trim()) return { op, branch, title, body };
  }
  if (op === "runs" && rest.length <= 1) {
    const branch = rest[0] ?? null;
    if (branch === null || branchName.test(branch)) return { op, branch };
  }
  return { error: usage };
}

export function agentToken(envFile: string | null): string | null {
  const token = envFile ? parseEnv(envFile).GH_TOKEN : undefined;
  return token?.startsWith("github_pat_") ? token : null;
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

async function graphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const result = (await call(token, "POST", "/graphql", { query, variables })) as {
    data?: unknown;
    errors?: unknown;
  };
  if (result.errors) throw new Error(`graphql: ${JSON.stringify(result.errors).slice(0, 300)}`);
  return result.data;
}

const pullRequestQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id number title state headRefName mergeable mergeStateStatus isInMergeQueue
      mergeCommit { oid }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
    }
  }
}`;

export async function run(token: string, operation: Operation): Promise<unknown> {
  const base = `/repos/${repo.owner}/${repo.name}`;
  switch (operation.op) {
    case "pr-list": {
      const pulls = (await call(token, "GET", `${base}/pulls?state=open`)) as {
        number: number;
        title: string;
        head: { ref: string };
      }[];
      return pulls.map((p) => ({ number: p.number, title: p.title, branch: p.head.ref }));
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
    case "pr-enqueue": {
      const data = (await graphql(token, pullRequestQuery, {
        ...repo,
        number: operation.number,
      })) as {
        repository: { pullRequest: { id: string } };
      };
      return graphql(
        token,
        `
          mutation ($id: ID!) {
            enqueuePullRequest(input: { pullRequestId: $id }) {
              mergeQueueEntry {
                state
                position
              }
            }
          }
        `,
        { id: data.repository.pullRequest.id },
      );
    }
    case "runs": {
      const query = operation.branch ? `&branch=${encodeURIComponent(operation.branch)}` : "";
      const runs = (await call(token, "GET", `${base}/actions/runs?per_page=10${query}`)) as {
        workflow_runs: {
          event: string;
          head_branch: string;
          status: string;
          conclusion: string | null;
        }[];
      };
      return runs.workflow_runs.map((r) => ({
        event: r.event,
        branch: r.head_branch,
        status: r.status,
        conclusion: r.conclusion,
      }));
    }
  }
}

if (import.meta.main) {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  const token = agentToken(existsSync(envPath) ? readFileSync(envPath, "utf8") : null);
  const operation = parse(process.argv.slice(2));
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
    console.log(JSON.stringify(await run(token, operation), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
