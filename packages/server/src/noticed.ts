// Noticed (decision 0052): the overview's strip of what Oriel found
// unasked. Oriel computes its signals on every look, as the overview's own
// (no model). One pass of the person's model picks a few and says why, in
// the background: it runs at a sync's end and after a curation, when the
// signals on offer changed, and never from a look. A look shows the last
// pass's cards whose signals still hold, with their figures as they are now.
// Pins rerun their read on every look, with no model and no source call.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type Evidence, type Provider, runNoticed } from "@oriel/agent";
import {
  type Block,
  dismissed,
  type Instant,
  type ItemId,
  kindWeights,
  type Log,
  type Notice,
  type Signal,
  type SignalKind,
  teachAfter,
  type TelemetryEvent,
  type Ulid,
  ulid,
} from "@oriel/core";
import {
  addPin,
  dismiss,
  dismissals,
  keepPass,
  kindOfSignal,
  lastPass,
  pins,
  removePin,
} from "@oriel/db";
import type { BlockView, Chips, NoticedCardView, NoticedView } from "@oriel/web/view";
import { evidenceFacts, type SignalInput, signalBlock, signalsOf } from "./signals.ts";

// The signals a pass is offered at most, heaviest first.
export const offeredAtMost = 12;

const kindNames: Record<SignalKind, string> = {
  stalled: "stalled workstreams",
  drift: "estimate rises",
  overloaded: "people with a lot in progress",
  contradicted: "chat after done",
  scope: "epics that grew",
};

export type NoticedDeps = {
  db: DatabaseSync;
  workspaceId: Ulid;
  input: () => Promise<SignalInput>;
  // Each item's title and text, read from its source now.
  read: (ids: readonly ItemId[]) => Promise<Evidence[]>;
  // The model the pass runs on, chosen again for each pass.
  noticer: () => Promise<{ provider: Provider; model: string } | null>;
  block: (built: Block) => BlockView;
  chips: (ids: readonly string[]) => Promise<Chips>;
  now: () => Instant;
  log: Log;
  // Telemetry: counts and times, never words.
  emit: (event: TelemetryEvent) => void;
  clock?: () => number;
};

type Pass = { key: string; notices: Notice[]; at: Instant; model: string };

// A Noticed event, before its time and workspace.
type Counted =
  Extract<TelemetryEvent, { name: `noticed.${string}` }> extends infer E
    ? E extends TelemetryEvent
      ? Omit<E, "at" | "workspaceId">
      : never
    : never;

// How long Oriel waits before it looks for a model again, after it found
// none for this set of signals.
const noAiRetryMs = 10 * 60_000;

// A stored pick: its signal's ID, and the line and quote Oriel checked.
type Pick = { signal: string; why: string | null; quote: Notice["quote"] };

export function noticedService(deps: NoticedDeps) {
  const clock = deps.clock ?? (() => performance.now());
  let running: { key: string } | null = null;
  // Each look for a pass waits for the one before, so two passes never run
  // at once; `queued`: one is waiting to start, which any more asked for
  // join. `stop` ends the one under way, as the server closes.
  let looking: Promise<void> = Promise.resolve();
  let queued = false;
  const stop = new AbortController();
  const count = (event: Counted) =>
    deps.emit({ ...event, at: deps.now(), workspaceId: deps.workspaceId } as TelemetryEvent);
  // The last pass's cards counted as shown, by their signals.
  let shown = new Set<string>();
  let failed: { key: string; problem: string } | null = null;
  let noAi: { key: string; at: number } | null = null;
  // The last pass, kept in the database so a restart doesn't pay for it
  // again. Its picks' signals are filled in from the signals on offer.
  const stored = lastPass(deps.db, deps.workspaceId);
  let last: (Omit<Pass, "notices"> & { picks: Pick[] }) | null = stored && {
    ...stored,
    picks: Array.isArray(stored.picks) ? (stored.picks as Pick[]) : [],
  };

  // What a pass is offered now: every signal not dismissed, weighed by
  // what dismissals taught, heaviest first.
  const offer = async () => {
    const input = await deps.input();
    const gone = dismissals(deps.db, deps.workspaceId, deps.now());
    const kept = pins(deps.db, deps.workspaceId).flatMap((pin) => {
      const kind = pin.signal ? kindOfSignal(pin.signal) : null;
      return kind ? [kind] : [];
    });
    const weight = kindWeights(gone, kept);
    const offered = signalsOf(input)
      .filter((signal) => !dismissed(signal, gone))
      .map((signal) => ({ ...signal, weight: signal.weight * weight[signal.kind] }))
      .toSorted((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
      .slice(0, offeredAtMost);
    // The set on offer, whatever its order: a reranking alone is no change.
    const pairs = offered
      .map((s) => [s.id, s.fingerprint] as const)
      .toSorted((a, b) => a[0].localeCompare(b[0]));
    const key = createHash("sha256").update(JSON.stringify(pairs)).digest("hex");
    const taught = (Object.keys(weight) as SignalKind[])
      .filter((kind) => weight[kind] < 1)
      .map((kind) => `Shown less: ${kindNames[kind]}, after ${teachAfter} dismissals`);
    return { input, offered, key, taught };
  };

  const pass = (key: string, offered: readonly Signal[], input: SignalInput) => {
    running = { key };
    let started: number | null = null;
    let counted = false;
    return (async () => {
      const chosen = await deps.noticer();
      if (!chosen) {
        noAi = { key, at: clock() };
        return;
      }
      noAi = null;
      const ids = [...new Set(offered.flatMap((s) => s.items))];
      // Where each stands, from the index, beside its text from its source.
      const facts = new Map(
        evidenceFacts(input, ids).map(({ id, ...rest }) => [id as string, rest]),
      );
      const evidence = (await deps.read(ids)).map((item) => ({
        ...item,
        facts: { ...facts.get(item.id), ...item.facts },
      }));
      started = clock();
      const ran = await runNoticed(chosen.provider, offered, evidence, {
        signal: AbortSignal.any([AbortSignal.timeout(120_000), stop.signal]),
        log: deps.log,
        clock,
      });
      const ok = ran.stop === "done";
      count({
        name: "noticed.pass",
        offered: offered.length,
        picked: ran.notices.length,
        dropped: ran.refused.length,
        inputTokens: ran.usage.inputTokens,
        outputTokens: ran.usage.outputTokens,
        firstMs: ran.firstMs === null ? null : Math.round(ran.firstMs),
        ms: Math.round(ran.ms),
        ok,
      });
      counted = true;
      deps.log("noticed: pass", {
        model: ran.model,
        offered: offered.length,
        shown: ran.notices.length,
        refused: ran.refused.length,
        first_ms: ran.firstMs === null ? null : Math.round(ran.firstMs),
        ms: Math.round(ran.ms),
        input_tokens: ran.usage.inputTokens,
        output_tokens: ran.usage.outputTokens,
      });
      if (!ok) throw new Error(`the pass ended without its answer (${ran.stop})`);
      const picks = ran.notices.map((n) => ({ signal: n.signal.id, why: n.why, quote: n.quote }));
      last = { key, picks, at: deps.now(), model: ran.model || chosen.model };
      shown = new Set();
      keepPass(deps.db, deps.workspaceId, last);
      failed = null;
    })()
      .catch((error: unknown) => {
        failed = { key, problem: error instanceof Error ? error.message : String(error) };
        deps.log("noticed: pass failed", { problem: failed.problem });
        // One that failed before its answer came, as on a read or the network.
        if (!counted && started !== null)
          count({
            name: "noticed.pass",
            offered: offered.length,
            picked: 0,
            dropped: 0,
            inputTokens: 0,
            outputTokens: 0,
            firstMs: null,
            ms: Math.round(clock() - started),
            ok: false,
          });
      })
      .finally(() => {
        running = null;
      });
  };

  // At a sync's end and after a curation: runs a pass when the signals on
  // offer changed since the last, unless the last failed for them, or found
  // no model for them a moment ago. Never from a look.
  const refresh = (): Promise<void> => {
    if (queued || stop.signal.aborted) return looking;
    queued = true;
    looking = looking
      .then(async () => {
        queued = false;
        if (stop.signal.aborted) return;
        const { offered, key, input } = await offer();
        const waiting = noAi?.key === key && clock() - noAi.at < noAiRetryMs;
        if (offered.length && last?.key !== key && !waiting && failed?.key !== key)
          await pass(key, offered, input);
      })
      .catch((error: unknown) => {
        deps.log("noticed: refresh failed", { problem: String(error) });
      });
    return looking;
  };

  const card = (
    input: SignalInput,
    notice: Notice,
    pinned: ReadonlyMap<string, string>,
  ): NoticedCardView => {
    const { signal } = notice;
    const built = signalBlock(input, signal.block);
    return {
      signal: signal.id,
      kind: signal.kind,
      subject: signal.subject,
      headline: signal.headline,
      rule: signal.rule,
      why: notice.why,
      quote: notice.quote,
      block: built ? deps.block(built) : null,
      pinned: pinned.get(signal.id) ?? null,
    };
  };

  return {
    refresh,
    // Waits for the looks and the pass under way, if any: for tests and the
    // screenshot script, never for a look.
    settled: () => looking,
    // Ends the pass under way, and starts none after, as the server closes.
    async stop() {
      stop.abort();
      await looking;
    },

    // What the strip shows now. It reads the last pass and never starts one,
    // so opening the overview makes no model call.
    async view(): Promise<NoticedView> {
      const { input, offered, taught } = await offer();
      const now = new Map(offered.map((signal) => [signal.id, signal]));
      const held = pins(deps.db, deps.workspaceId);
      const pinned = new Map(held.flatMap((pin) => (pin.signal ? [[pin.signal, pin.id]] : [])));
      // The last pass's cards whose signal is still on offer, with its
      // headline and figures as Oriel has them now.
      const cards = (last?.picks ?? []).flatMap((pick) => {
        const signal = now.get(pick.signal);
        return signal ? [card(input, { signal, why: pick.why, quote: pick.quote }, pinned)] : [];
      });
      for (const each of cards)
        if (!shown.has(each.signal)) {
          shown.add(each.signal);
          count({ name: "noticed.shown", kind: each.kind });
        }
      const chips = await deps.chips([
        ...new Set(
          cards.flatMap((c) => [
            ...[...(c.why ?? "").matchAll(/\[\[([^\]]+)\]\]/gu)].map((m) => m[1] ?? ""),
            ...(c.quote ? [c.quote.item] : []),
            ...(c.subject.kind === "item" ? [c.subject.id] : []),
          ]),
        ),
      ]);
      // How the last pass went, whatever it was offered.
      const status: NoticedView["status"] = running
        ? "running"
        : !offered.length
          ? "quiet"
          : noAi
            ? "no-ai"
            : failed
              ? "failed"
              : "ready";
      return {
        status,
        cards,
        pins: held.map((pin) => {
          const built = signalBlock(input, pin.spec);
          return { id: pin.id, block: built ? deps.block(built) : null };
        }),
        chips,
        foundAt: last?.at ?? null,
        model: last?.model ?? null,
        taught,
        problem: status === "failed" ? "Oriel couldn't look for what to notice just now." : null,
      };
    },

    // The person dismissed a card: it stays away until its figures move on.
    // Its kind, or null when no card has that signal now.
    async dismiss(signalId: string): Promise<SignalKind | null> {
      const { offered } = await offer();
      const signal = offered.find((each) => each.id === signalId);
      if (!signal) return null;
      dismiss(
        deps.db,
        deps.workspaceId,
        { signal: signal.id, fingerprint: signal.fingerprint },
        deps.now(),
      );
      if (last) last = { ...last, picks: last.picks.filter((pick) => pick.signal !== signalId) };
      return signal.kind;
    },

    // Pins a card's block, as its saved read (decision 0030).
    // Null when no card has that signal now.
    async pin(
      signalId: string,
    ): Promise<{ id: Ulid; kind: SignalKind } | { refused: string } | null> {
      const { offered } = await offer();
      const signal = offered.find((each) => each.id === signalId);
      if (!signal) return null;
      const id = ulid(Date.parse(deps.now()));
      const refused = addPin(deps.db, deps.workspaceId, {
        id,
        spec: signal.block,
        signal: signal.id,
        createdAt: deps.now(),
      });
      return refused ?? { id, kind: signal.kind };
    },

    unpin: (id: Ulid) => removePin(deps.db, deps.workspaceId, id),
  };
}

export type NoticedService = ReturnType<typeof noticedService>;
