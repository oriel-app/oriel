# 0014 Agent access to GitHub

Accepted 2026-10-29. Changes SPEC §5, which kept the Jira secret as a repo-wide Actions secret.

**Decision.**

- Agents use GitHub only through `pnpm -s github`, which runs `gh` with:
  - a fine-grained token for this repo, with read and write on Contents, Pull requests and Merge queues, and no Administration, Secrets, Environments or Workflows;
  - only that token from `.env`, none of its other secrets;
  - a fresh gh config, with no aliases, extensions or saved logins.

  It refuses `auth`, `alias`, `extension`, `config`, `secret` and `variable`.

- The Jira secrets live in the `jira` Actions environment, which only `main` can deploy to.

**Why.** Agents act on text an attacker can write. With the maintainer's admin login they could edit the rulesets that gate `main`. With repo-wide secrets, a workflow pushed to any branch could read the Jira credential.

**Consequences.**

- Until the maintainer's own gh login is off the machine agents run on, any process can still reach it. Until then this decision is policy, not a lock.
- `git push` still uses the maintainer's SSH key. Rulesets keep every push off `main`.
- A CI job that uses the `jira` environment runs only on `main`, after merge. It can never be a required check on a PR or in the merge queue.
