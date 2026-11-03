# 0014 Agent access to GitHub

Accepted 2026-10-29. Changes SPEC §5, which kept the Jira secret as a repo-wide Actions secret, and the line in SPEC §10 and decision 0012 about who can edit the rules. Amended 2026-11-03 (#152): while CI runs, an enqueue arms auto-merge instead, only after the maintainer's go-ahead; and the client gives the next decision number.

**Decision.**

- Agents reach GitHub only through `pnpm -s github`. It's a small client in `scripts/github.ts` with a fixed set of operations on this repo: ~~list, view, create and enqueue PRs, rewrite a PR's body or title, and list CI runs.~~ Amended 2026-11-03 (#152): list, view, create and enqueue PRs, rewrite a PR's body or title, list CI runs, and give the next decision number, from main's `docs/decisions` and every open PR's files. When GitHub refuses an enqueue because checks are still running, it arms auto-merge instead, with the same `expectedHeadOid`, and the PR enters the queue when CI passes. Auto-merge stays armed through later pushes, so the agent pushes nothing more. Like an enqueue, it is armed only after the maintainer's go-ahead (0012).
  - It calls `api.github.com` directly.
  - It authenticates with a fine-grained token, read from `.env` and nothing else from it. The token has read and write on Contents, Pull requests and Merge queues, and no Administration, Secrets, Environments or Workflows.
- It doesn't use `gh`. It enqueues, or rewrites the body or title of, only PRs whose head is a branch of this repo; an enqueue is pinned to the commit it checked. It refuses a PR title or body that contains a credential from `.env`.
- The Jira secrets live in the `jira` Actions environment, which only `main` can deploy to.

**Why.** Agents act on text an attacker can write. With the maintainer's admin login they could edit the rulesets that gate `main`, and with repo-wide secrets, a workflow pushed to any branch could read the Jira credential.

A wrapper around `gh` was tried first. Three review rounds kept finding ways through it:

- a leading flag reached `auth token` and the keyring login;
- extension aliases ran code;
- file arguments uploaded `.env`;
- `--` reached `git clone`.

A fixed client has none of those surfaces.

**Consequences.**

- A new GitHub need means a new operation in `scripts/github.ts`, which is maintainer-owned.
- The token's permissions and the rulesets are the lock. The operation list, and keeping the maintainer's own gh login out of agents' reach, are policy: any process on this machine can read `.env` and the keyring.
- `git push` still uses the maintainer's SSH key. Rulesets keep every push off `main`.
- A CI job that uses the `jira` environment runs only on `main`, after merge. It can never be a required check on a PR or in the merge queue.
