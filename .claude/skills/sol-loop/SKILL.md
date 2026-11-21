---
name: sol-loop
description: Use when the user says "sol loop".
---

# sol-loop

This is a workflow for making your code changes more correct before (or
sometimes after) filing a pull request. tl;dr - use OpenAI's GPT Sol to review
your code in a loop.

Make the most minimal possible changes to appease the Sol reviewers. Be careful
of scope creep and don't be scared to push back.

## Budget

- Default: 3 rounds total. Round 1 is full. Later rounds check only
  changed code and open findings.
- Extend to 5 only for security, permissions, auth, data loss, or
  state/concurrency, while a blocker or should stays open with evidence. Or when
  the user asks.
- Stop early if a round returns only nits. Declined nits and comment,
  doc, or format-only fixes need no new round.
- One reviewer only. Sol must not start subagents or reviewers.
- Keep a ledger: id, severity, outcome, usage if returned. Never guess it.

## 1. Scope

Run `git status --short`. Do not stash, discard, or include unrelated
changes. Limit review to the change paths if they separate cleanly.
Otherwise stop and ask.

Find the base after `git fetch origin`:

- PR: `gh pr view <n> --json baseRefName,headRefOid`. Check out the branch
  only if clean. Confirm `HEAD` is the PR head, or ahead only by this
  change. Base: `git merge-base HEAD origin/<baseRefName>`.
- Local: `git merge-base HEAD origin/<default-branch>`. No remote: a base
  the user names, or `HEAD` for uncommitted changes only.

The change is base to working tree in those paths, with untracked files.
Use one diff command all rounds. State intent and out-of-scope in 1-2
sentences. Run covering checks. Do not send code this change breaks. Note
missing or pre-failing checks in the brief.

## 2. Start Sol

In T3, call `orchestrator_capabilities`. Pick the latest Sol unless the user
named a version. Do not hardcode an ID. Record provider, model, and effort
only if exposed. Use `delegate_task` every round (`role: "review"`,
`mode: "async"`). Save `taskId`. New `clientRequestId` per round.
`childThreadId` is storage, not the next target. Do not use
`t3_thread_send`, `create_threads`, or `t3_thread_launch` for review.

If T3 tools are not listed, try one direct capability call. Outside T3, use
a native Sol subagent and keep its ID. In Claude Code, use a custom subagent
only if it is set up to run Sol. If no route runs Sol, report the blocker. Do
not substitute a model.

Do not edit scoped files while review runs. Wait for the notice. Do not
poll or start a second reviewer. Timeout, error, or no reply is not
approval. On failure, cancel, verify stop, restart with the ledger.

Round 1 brief (T3 children get no history):

```
Review only. Do not edit, commit, push, comment on PRs, or start subagents.
Repo: <abs path> Base: <sha> Intent: <intent> Out of scope: <scope> Checks: <results>
See: git diff <base> [-- <paths>]; git status --short (read untracked).
Read surrounding code. Find bugs, broken callers, mismatch with intent.
Skip style unless it hides a bug. Hold to the smallest change. Flag code,
tests, or guards the intent does not need. Other paths, rare cases, small
perf, extra compat: nits.
blocker = intended case wrong. should = real bug callers will hit, in intent. nit = rest.
Reply:
VERDICT: APPROVE or CHANGES
S1 [blocker|should|nit] <file>:<line> <claim>. Fix: <suggestion> (stable ids)
```

## 3. Answer findings

Check each finding and severity yourself. Another path, rare case, or
small cost is a nit, whatever label it came with.

- Agree: smallest fix. Prefer delete or narrow over new lock, cache,
  helper, or option. Fix the case that happened. Add one focused test
  that fails without the fix, if intent needs it.
- Disagree: say why, with evidence (file:line, test, output).
- Out of scope or nit: decline in one line. List as follow-up.

Update the ledger. Re-run checks and `git diff --shortstat <base>`. If
review grew the diff, cut first. Do not agree just to end the loop.

## 4. Next round

Start one only if budget remains and a blocker or should is open, behavior code
changed, or approval does not cover the current behavior diff. Use a fresh
`delegate_task` in T3, or follow up the saved native ID. Send the round 1 brief,
the ledger (`fixed:` / `disagree:` / `declined:` + evidence), the same base
diff, and the change since last round. Tell Sol: open ids and changed code only.
Mark each old id `resolved` or `still open: <reason>`.

## 5. Stop and ship

Agreed: APPROVE on the current behavior diff, no blocker or should open,
no concern of your own. Stuck: an item stays disputed after two replies,
or budget ends. Show both sides in 2-3 lines each. The user decides.
Budget end is not approval.

Do not push during the loop. Push after agreement only if the user asked
to push, ship, or update the PR. If you push to a PR, add above the model
blurb:

`Reviewed with sol-loop: <N> rounds with <model>. Sol verdict: approved`.

Add `on <effort>` only if verified.

Report: rounds, model, what Sol changed, diff size before/after, fixed and
declined findings with reasons, usage if exposed (else say not), pushed or not.

## In Oriel

Source: github.com/t3dotgg/tstack, skills/sol-loop. Everything above is upstream. These notes adapt it to Oriel's repo rules, and they win where the two differ.

- GitHub: never `gh`. For the PR's base and head, use `pnpm -s github pr-view <n>`; a worktree has no `.env`, so run the main checkout's `scripts/github.ts`.
- Model: Codex's latest Sol from `orchestrator_capabilities`. Use reasoningEffort `high`, or `xhigh` for the five-round classes.
- In a builder thread, this loop is the correctness review. It replaces the `correctness-reviewer` agent. Still run `security-reviewer` when the diff touches the sandbox, bindings, a source writer, connections, the review link or anything that reads synced content.
- Waiting: start each round with `delegate_task` `mode: "wait"`, not `async`. A builder's ended turn reads to the hub as its final report.
- Checks: the builder runs `pnpm check` and gives Sol its result in the brief. Add to the round 1 brief: "Don't run `pnpm check` or the whole suite: the results are above. To test one claim, run one package's tests (`pnpm --filter <pkg> test`)."
- Two classes to look for, added to the round 1 brief after "mismatch with intent":
  - **Misleading controls:** a button, line or state that promises what the code won't do, such as a Revert that can't send its undo, a rail line naming the wrong place, or a control shown where it can't work.
  - **Source content reaching a model:** any text from a source or a tool result (titles, descriptions, comments, cells, a server's answer) placed in a system prompt, a user message, a `.d.ts` or a tool's input shown to a model. It belongs only in tool results (SPEC §5).
- Two more blocks for the round 1 brief, pasted as they are, after the two classes above:
  ```text
  Test layers: use .claude/skills/unit-tests/SKILL.md, "Which layer" and "The keep rule".
  - For changed behaviour, identify the layer that applies and inspect the evidence: unit for keep classes only; flow for what a person does across pages (an asserting shots scene or the design-system site); upgrade for migrations or stored shapes (a database copied from the last release); live for agent-facing text (an eval recording); none for copy, layout or one-line UI.
  - For each added or edited unit test, verify its keep class. Class 4 needs an observed defect, its fixing PR or commit, and the wrong result; a feature's introduction is not enough. Flag wording, labels, growing lists and duplicate checks.
  - Verify that the check exercises the changed behaviour and asserts its outcome; a screenshot or a check's name alone is not enough. Name missing evidence and the smallest check that would expose the failure.
  - Flag a changed guard in any keep class whose check would still pass with the guard broken. Inspect the assertion and any mutation evidence; don't require another unit test when another layer already proves the behaviour.

  Blind spots:
  Name every surface in CLAUDE.md's 'Hit every surface' list that this diff can reach outside the files it changed. For each, say how the builder showed it still works, or flag it as unchecked.
  - Trace the changed exports, stored fields, route payloads and states to concrete readers. One reachability path per surface is enough; group surfaces that share a path and evidence. Don't audit unrelated behaviour.
  - Inspect the cited assertion or demonstrated state and its result. A passing command or a page's name counts only if it exercises the affected behaviour. Run an existing focused check when practical.
  - Report demonstrated breakage as a should, with the reader's file:line, trigger and consequence. Keep other unchecked surfaces in a compact evidence-gap list; missing evidence alone is not automatically a defect or a nit.
  - Do this tracing and verification in review. Ask the builder for a focused check only for a specific unresolved risk; name the scenario and the expected outcome, never a blanket QA pass.
  ```
- Pushing: the loop itself pushes nothing. A builder's brief decides when its branch and PR are pushed. If the PR already exists, push once after agreement and add the "Reviewed with sol-loop" line to the PR body's Evidence, not above a model blurb.
- The ledger goes in the PR's Evidence. Declined nits are listed there in one line each. They are not follow-ups for the hub, and nobody files tickets for them.
- Report to the hub only blockers or shoulds you couldn't settle, and a follow-up only if it's a real bug a user would hit, or duplicated logic with a named cost.
