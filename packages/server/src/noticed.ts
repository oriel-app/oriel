// Noticed (docs/decisions/draft-noticed.md): the overview's strip of what
// Oriel found unasked. Oriel computes its signals on every look, as the
// overview's own (no model). One pass of the person's model picks a few and
// says why, in the background: it runs when the signals on offer change,
// which is after a sync or a curation, never on every look, and a look
// never waits for it. The last pass's cards that still hold show meanwhile.
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
  clock?: () => number;
};

type Pass = { key: string; notices: Notice[]; at: Instant; model: string };

// How long Oriel waits before it looks for a model again, after it found
// none for this set of signals.
const noAiRetryMs = 10 * 60_000;

// A stored pick: its signal's ID, and the line and quote Oriel checked.
type Pick = { signal: string; why: string | null; quote: Notice["quote"] };

export function noticedService(deps: NoticedDeps) {
  const clock = deps.clock ?? (() => performance.now());
  let running: { key: string; done: Promise<void> } | null = null;
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
    const key = createHash("sha256")
      .update(JSON.stringify(offered.map((s) => [s.id, s.fingerprint])))
      .digest("hex");
    const taught = (Object.keys(weight) as SignalKind[])
      .filter((kind) => weight[kind] < 1)
      .map((kind) => `Shown less: ${kindNames[kind]}, after ${teachAfter} dismissals`);
    return { input, offered, key, taught };
  };

  const pass = (key: string, offered: readonly Signal[], input: SignalInput) => {
    const done = (async () => {
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
      const ran = await runNoticed(chosen.provider, offered, evidence, {
        signal: AbortSignal.timeout(120_000),
        log: deps.log,
        clock,
      });
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
      if (ran.stop !== "done") throw new Error(`the pass ended without its answer (${ran.stop})`);
      const picks = ran.notices.map((n) => ({ signal: n.signal.id, why: n.why, quote: n.quote }));
      last = { key, picks, at: deps.now(), model: ran.model || chosen.model };
      keepPass(deps.db, deps.workspaceId, last);
      failed = null;
    })()
      .catch((error: unknown) => {
        failed = { key, problem: error instanceof Error ? error.message : String(error) };
        deps.log("noticed: pass failed", { problem: failed.problem });
      })
      .finally(() => {
        if (running?.key === key) running = null;
      });
    running = { key, done };
  };

  // Starts a pass when the signals on offer changed since the last, unless
  // one is under way for them or the last failed for them.
  const refresh = async () => {
    const offered = await offer();
    const fresh = last?.key === offered.key;
    const waiting = noAi?.key === offered.key && clock() - noAi.at < noAiRetryMs;
    if (
      offered.offered.length &&
      !fresh &&
      !waiting &&
      running?.key !== offered.key &&
      failed?.key !== offered.key
    )
      pass(offered.key, offered.offered, offered.input);
    return offered;
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
    // Waits for the pass under way, if any: for tests and the screenshot
    // script, never for a look.
    settled: async () => {
      await running?.done;
    },

    async view(): Promise<NoticedView> {
      const { input, offered, key, taught } = await refresh();
      const now = new Map(offered.map((signal) => [signal.id, signal]));
      const held = pins(deps.db, deps.workspaceId);
      const pinned = new Map(held.flatMap((pin) => (pin.signal ? [[pin.signal, pin.id]] : [])));
      // The last pass's cards whose signal is still on offer, with its
      // headline and figures as Oriel has them now.
      const cards = (last?.picks ?? []).flatMap((pick) => {
        const signal = now.get(pick.signal);
        return signal ? [card(input, { signal, why: pick.why, quote: pick.quote }, pinned)] : [];
      });
      const chips = await deps.chips([
        ...new Set(
          cards.flatMap((c) => [
            ...[...(c.why ?? "").matchAll(/\[\[([^\]]+)\]\]/gu)].map((m) => m[1] ?? ""),
            ...(c.quote ? [c.quote.item] : []),
            ...(c.subject.kind === "item" ? [c.subject.id] : []),
          ]),
        ),
      ]);
      const status: NoticedView["status"] = !offered.length
        ? "quiet"
        : noAi?.key === key
          ? "no-ai"
          : running?.key === key
            ? "running"
            : failed?.key === key
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
    async dismiss(signalId: string): Promise<boolean> {
      const { offered } = await offer();
      const signal = offered.find((each) => each.id === signalId);
      if (!signal) return false;
      dismiss(
        deps.db,
        deps.workspaceId,
        { signal: signal.id, fingerprint: signal.fingerprint },
        deps.now(),
      );
      if (last) last = { ...last, picks: last.picks.filter((pick) => pick.signal !== signalId) };
      return true;
    },

    // Pins a card's block, as its saved read (decision 0030).
    // Null when no card has that signal now.
    async pin(signalId: string): Promise<{ id: Ulid } | { refused: string } | null> {
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
      return refused ?? { id };
    },

    unpin: (id: Ulid) => removePin(deps.db, deps.workspaceId, id),
  };
}

export type NoticedService = ReturnType<typeof noticedService>;
