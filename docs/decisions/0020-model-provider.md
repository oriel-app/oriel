# 0020 Model provider: API key first, a local harness later

Accepted 2026-10-30.

Adds: none

**Decision.**

- The agent loop reaches a model through `Provider` in `packages/agent`.
  - A provider holds one conversation per turn and streams one response at a time. `next(results, { maxOutputTokens })` yields usage as soon as it's known, then text deltas, then complete tool calls, then one end with the stop reason, the serving model and usage.
  - Each response is bounded by what's left of the thread's token cap, so a stopped or broken response still counts toward it.
  - The loop owns the tool, the caps, the runs and the history. A provider owns only how messages reach a model and come back.
- The first provider is the Anthropic Messages API with an API key: one key per instance, held by whoever runs it, never part of onboarding (SPEC §7).
  - Plain `fetch` and server-sent events, with no SDK.
  - `claude-opus-5-5` by default, effort `medium`, and 64000 output tokens per response.
  - Prompt caching on the tool, the system prompt and the turn's growing tail.
  - One run per response, and strict tool input.
  - The key lives in the provider's closure. It's sent only as a header, scrubbed from errors, and never logged, kept on an object or written to a cassette.
- **Thread titles** (added 2026-10-31, OA-17) are a second, separate use of a model, outside `Provider` and the agent loop.
  - Each thread makes one request, to a small model (`claude-haiku-5-5`). The person's first message is its only input, in the user message; the system prompt is constant.
  - The answer must be one short line, or it's dropped. If no key is set, or the request fails or is refused, the thread keeps the title the server clips from the first message.
  - It uses the same key, plain `fetch`, and the same scrubbing as the provider. Its usage is logged but not counted toward the thread's token cap.
  - The server receives it through the `Titler` seam (`AppOptions.titler`), so a later settings pane can choose another model or provider for it.
- A local harness comes later, as a second `Provider`.
  - Oriel drives the user's own command-line agent on their machine, signed in however the user signed it in.
  - Oriel never sees, stores or relays subscription credentials, and never offers a vendor sign-in.
  - The harness gets the same constant system prompt and `run` tool, and `next(results)` answers its pending tool calls.

**Why.**

- Phase 1 runs on localhost with the maintainer's key, then one instance per pilot (SPEC §4, §7). A key is the shortest path, and the evals can record and replay it.
- A stateful conversation keeps both futures open without touching the loop. The API needs its signed thinking blocks sent back unchanged within a turn, and a harness keeps its own process and history.
- Raw HTTP keeps the dependency list as it is, and matches `packages/evals`, whose cassettes key on the request body.

**Rejected.**

- The Anthropic SDK. One endpoint and a stream parser don't justify a dependency.
- A stateless `complete(messages)` provider. The loop would carry provider-specific blocks, or a harness would restart for every response.
- Handling subscription credentials or a vendor sign-in for a harness. Credentials stay on the user's machine, with the tool that owns them.

**Consequences.**

- The server builds the provider from `ANTHROPIC_API_KEY` and passes it to `agent()`. Evals pass their cassettes' `fetch`.
- Each run records the model that served the response that asked for it.
- Across turns, the history is rebuilt from the thread's messages. Only the tool and the system prompt hit the cache, and no earlier thinking is sent back.
- No retries on 429, 5xx or overload yet: the turn ends with an error.
- Thread titles have their own model constant, `titleModel`, in `packages/agent/src/title.ts`. Changing it, or making it configurable, is a change to this decision.
- Revisit when the local harness lands, when a second vendor is wanted, or when the latency eval calls for another effort.
