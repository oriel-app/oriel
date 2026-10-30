# 0014 Agent access to GitHub

Accepted 2026-10-29. Changes SPEC §5, which kept the Jira secret as a repo-wide Actions secret, and the line in SPEC §10 and decision 0012 about who can edit the rules.

**Decision.**

- Agents reach GitHub only through `pnpm -s github`. It's a small client in `scripts/github.ts` with a fixed set of operations on this repo: list, view, create and enqueue PRs, rewrite a PR's body, and list CI runs.
  - It calls `api.github.com` directly.
  - It authenticates with a fine-grained token, read from `.env` and nothing else from it. The token has read and write on Contents, Pull requests and Merge queues, and no Administration, Secrets, Environments or Workflows.
- It doesn't use `gh`. It enqueues, or rewrites the body of, only PRs whose head is a branch of this repo; an enqueue is pinned to the commit it checked. It refuses a PR title or body that contains a credential from `.env`.
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
