# Draft: model spend stays on the key, on a budget; no bridge through the host app

Draft, 2026-11-04 (t3-bridge spike). Not accepted. Would amend 0031 and 0037.

Adds: none

**Decision.**

- **Evals stay on the API key.** Recording, replaying and climbing measure the agent as the Messages API serves it, and only that path records cassettes CI can replay.
- **Spend is a budget, not a by-product.** A climb runs only under a cap the maintainer names in its brief, as 0031's plan already books it; a spike runs live rounds only when its brief grants a cap. A story records its cassettes once its agent-facing change is final, and again only when another agent-facing PR has merged since.
- **`pnpm evals --harness claude-code`** runs a live round's system under test on the person's own Claude Code, through 0037's harness, unchanged. It records nothing, keeps the judge on the key and prints what the plan's tokens would have cost on it. It measures the harness, not the agent: run it when the harness or Claude Code changes, never as a climb's round (it refuses `--climb`).
- **The dogfood server stays on the key.** It costs about $1.70 a day.
- **No bridge through the host app.** Oriel runs no turn through the coding app its builders run in.

**Why.**

- Measured, Nov 3 to Nov 4 08:30, from `.evals/` in the surviving worktrees (live rounds only; replays log their cassettes' usage and are left out) and the live server's log, at Opus 5.5's $4 / $20 per million tokens, cache reads $0.20 and writes $5:

  | where the key's dollars went    | dollars |
  | ------------------------------- | ------- |
  | a climb's rounds (show-from)    | 22.93   |
  | spikes' rounds                  | 10.46   |
  | stories' recordings             | 7.89    |
  | the live dogfood server (Opus)  | 2.56    |
  | thread titles (Haiku), all time | 0.01    |

  The server's 421 responses since Oct 31 cost $7.52 in all. A whole climb, OA-144's, cost $20.58.

- **The same 31 cases on Claude Code** (one round, Opus 5.5, four at a time): 18/31 pass, against 32/32 and 35/36 for the two live API rounds that day. Every miss is an injection case: 2/15 quote the planted text, against 15/15 and 16/16. No case made a wrong mutation; the model paraphrased the planted text or left it out. Median 7.8 s a case against 8.2 to 8.8 s; $0.03 on the key for the judge. So a round on the subscription measures a different system, and can't stand in for one on the key.
- **The subscription isn't spare.** The default account's week stood at 82% used when this was measured.
- **Anthropic's terms.** Claude Code's legal page: OAuth sign-in "is designed to support ordinary use of Claude Code and other native Anthropic applications"; "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK"; developers "should use API key authentication", and "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users", nor "collect, store, or intermediate Claude.ai credentials or session tokens". The Consumer Terms (Oct 8, 2025), §3: no access "through automated or non-human means, whether through a bot, script, or otherwise" unless "using an Anthropic API Key or Anthropic has explicitly allowed it"; §2: "You may not share your Account login information … You also may not make your Account available to anyone else." Bulk eval rounds on a plan are automated use beyond ordinary, individual use.
- **The host app.** It has a supported entry point: its CLI's `thread start` and `thread send`, which mint a full-access session against the app's local MCP endpoint. A turn there is a whole coding session: the model saw about 30 built-in tools (shell, file writes, web fetch, sub-agents) and about 80 of the app's own (secrets, projects, threads), with permissions bypassed, the person's settings loaded and no way to set Oriel's system prompt or host `run`. 0037's lock-down doesn't survive, and the turn still bills the same subscription Oriel's harness already reaches directly, so there is nothing to save. A turn took 1.9 to 5.3 s on Haiku and 13.8 s on Opus.

**Rejected.**

- **The dogfood server on Claude Code.** It saves about $1.70 a day, misses the injection cases above, draws on a week already 82% used, and from the builders' environment it finds Claude Code signed out: their `CLAUDE_CONFIG_DIR` reaches Anthropic only through a local proxy, whose variables 0037's allowlist drops. With no key it would fall to Codex, less locked down (0048).
- **Climbs on the subscription.** The largest saving, but automated bulk use the terms reserve for API keys, measuring a system that differs from the one users get on a key.
- **Turns through the host app** (above), and **pooling accounts or routing across them** to spread load: out under the terms quoted.
- **Titles and passes on Codex to save money.** Titles cost $0.01 in five days.
- **The Batch API's half price for climbs.** A turn is several dependent responses, so each would wait on its own batch.

**Consequences.**

- 0031: a climb's cap comes from its brief; spikes book live rounds against a cap too.
- 0037: the harness has an eval of its own, `--harness claude-code`, run by hand. Its injection gap is a story.
- Open, for the maintainer: whether 0037 and 0038, which run a person's own Claude Code on their plan for them, sit inside "route requests through … plan credentials on behalf of their users". Ask Anthropic before Oriel reaches anyone but the maintainer (0029's phase 2).
