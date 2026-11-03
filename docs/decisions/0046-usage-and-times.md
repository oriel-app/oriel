# 0046 Settings shows how much of the plan Oriel has used, and times are relative or absolute

Accepted 2026-11-03. Amends 0037 and 0041.

Adds: none

**Decision.**

- **Oriel's own use.** Under Claude Code's row in Providers: today's turns, and the tokens its responses read and wrote, titles included, on that instance. The harness counts each response's usage as it ends, the turn's first counting the turn. The counts live in `usage.json` in the data folder, beside `settings.json`, for today only, and nothing else: no message, title or model output. A new local day starts again at 0. An API key's use isn't counted: it bills per question.
- **The plan's windows.** The five-hour session and the week, each as a meter with how much is used and when it resets. They are the person's Claude Code's own answer to `get_usage` on its control channel, asked of a locked-down session like the sign-in check, with no model request. Oriel never reads the CLI's credentials, its logs or its transcripts, and asks with `skip_behaviors`, so the CLI doesn't scan them either. They're asked when Providers opens and after Check again, of a CLI found ready and passing the trust check (0038), and never kept. The route is a POST, `POST /settings/usage`, exempt as settings are (0041), so only the window's own origin can start the CLI.
  - When the CLI says no plan limits apply (an API key or a cloud provider), the row says so. When it doesn't answer, the row says to check again.
  - `get_usage` is marked experimental in the CLI. If it changes shape, the windows go and Oriel's own counts stay.
- **Times.** Settings › General picks how the window writes a time: relative ("3 min ago", "in 2 h"), the default, or absolute, each place's own date and time. It applies everywhere a time shows: the overview, a workstream's threads and versions, the Done page, Browse, the item panel, the sidebar's sources, a provider's limits and the first run. A review link's page keeps the default. Hovering a time shows its date and time. A time that has happened is never written as one to come, whatever the clocks say.

**Why.**

- The maintainer asked for both. A person on a Claude plan wants to know whether Oriel is eating it. Their plan's windows are the number that matters, and Oriel's own counts are what Oriel is answerable for.
- The CLI's stream emits `rate_limit_event` only when the limit's status changes. Tried on 2.1.314, an ordinary turn emitted none. `get_usage` answers at once, under the person's own sign-in, in 0.35 s.
- Asking the CLI keeps 0037's rule: Oriel reaches the person's account only through the CLI, with flags and its control channel.

**Rejected.**

- **Reading the plan's usage from the API with the CLI's token.** That means reading its credentials, which 0037 rules out.
- **`rate_limit_event` alone.** It's rare, so the meters would be empty most days. When it starts to come with each turn, it can update them between looks.
- **Counts per day in the database.** A week of history isn't asked for, and a file beside the settings is what both modes share (0041).

**Consequences.**

- 0037: the harness asks the CLI `get_usage`, and counts each response's tokens for Settings.
- 0041: Providers shows usage under Claude Code; General gains Times. "How much of a subscription Oriel has used" and "a timestamp format" are built.
