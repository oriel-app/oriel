// Spike (window-explore): prototype overviews, chosen by `?design=` and kept
// for the tab's session. Rough on purpose: each design composes the same
// sections differently. Nothing here is generated; every number comes from
// the server's /api/explore/overview.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  ChatProvider,
  CiteButton,
  Composer,
  InlineAnswers,
  Panel,
  PinnedStrip,
  Rail,
  Suggestions,
  useChat,
} from "./chat.tsx";
import type { Card, Candidate, ListData, OverviewData, PersonRow, Waiting } from "./data.ts";

const key = "oriel.explore.design";
export const exploreDesign: string | null = (() => {
  try {
    const asked = new URLSearchParams(location.search).get("design");
    if (asked) sessionStorage.setItem(key, asked);
    const design = asked ?? sessionStorage.getItem(key);
    if (design) document.documentElement.dataset["design"] = design;
    return design;
  } catch {
    return null;
  }
})();

let loaded: Promise<OverviewData> | null = null;
const load = () =>
  (loaded ??= fetch("/api/explore/overview").then((r) => r.json() as Promise<OverviewData>));

const day = 86_400_000;
const since = (iso: string, now: string) => {
  const days = Math.floor((Date.parse(now) - Date.parse(iso)) / day);
  if (days <= 0) {
    const hours = Math.max(1, Math.floor((Date.parse(now) - Date.parse(iso)) / 3_600_000));
    return `${hours}h`;
  }
  return `${days}d`;
};
const weekday = (iso: string) =>
  new Date(iso).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" });
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const waitWords: Record<Waiting["waitingOn"], string> = {
  held: "Message held",
  review: "Needs review",
  reply: "Your turn",
};

export function Explore({ design }: { design: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  useEffect(() => {
    void load().then(setData);
  }, []);
  const view = new URLSearchParams(location.search).get("view");
  if (view === "browse") return <Browse design={design} />;
  if (data === null) return <p class="loading">Loading…</p>;
  const Layout = layouts[design] ?? OverviewR1;
  // Rounds 10 on: the window chat. A pin or a made workstream reloads the overview.
  if (chatDesigns.has(design))
    return (
      <ChatProvider
        data={data}
        refresh={() => {
          loaded = null;
          void load().then(setData);
        }}
      >
        <Layout data={data} design={design} />
      </ChatProvider>
    );
  return <Layout data={data} design={design} />;
}

type Props = { data: OverviewData; design: string };

// Sections ------------------------------------------------------------------

function Section(props: {
  id: string;
  title: ComponentChildren;
  count?: number;
  more?: ComponentChildren;
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <section class={`x-section ${props.class ?? ""}`} data-section={props.id}>
      <h2 class="x-head">
        <span>{props.title}</span>
        {props.count !== undefined && <span class="x-count">{props.count}</span>}
        {props.more && <span class="x-head-more">{props.more}</span>}
      </h2>
      {props.children}
    </section>
  );
}

function More({
  shown,
  total,
  onClick,
  href,
}: {
  shown: number;
  total: number;
  onClick?: () => void;
  href?: string;
}) {
  if (total <= shown) return null;
  return href ? (
    <a class="x-more" data-more href={href}>
      {total - shown} more
    </a>
  ) : (
    <button type="button" class="x-more" data-more onClick={onClick}>
      {total - shown} more
    </button>
  );
}

export function NeedsYou({ data, cap = 5 }: { data: OverviewData; cap?: number }) {
  const [all, setAll] = useState(false);
  const rows = all ? data.needsYou : data.needsYou.slice(0, cap);
  return (
    <Section id="needs" title="Needs you" count={data.needsYou.length}>
      <ul class="x-rows">
        {rows.map((w) => (
          <li key={w.thread.id} class="x-row">
            <a class="x-title" href={`/threads/${w.thread.id}`}>
              {w.thread.title}
            </a>
            <span class="x-tag" data-wait={w.waitingOn}>
              {waitWords[w.waitingOn]}
            </span>
            <span class="x-sub">{w.workstream.name}</span>
            <span class="x-age" title={`Waiting since ${weekday(w.since)}`}>
              waiting {since(w.since, data.now)}
            </span>
          </li>
        ))}
      </ul>
      <More shown={rows.length} total={data.needsYou.length} onClick={() => setAll(true)} />
      {data.unopened.length > 0 && (
        <p class="x-note">
          {plural(data.unopened.length, "review link")} sent and not opened yet:{" "}
          {data.unopened
            .slice(0, 2)
            .map((u) => u.thread.title)
            .join("; ")}
          {data.unopened.length > 2 && "…"}
        </p>
      )}
    </Section>
  );
}

export function Strip({ data }: { data: OverviewData }) {
  const c = data.counts;
  return (
    <div class="x-strip" data-section="strip">
      <span class="x-since">Since you looked {weekday(data.lastSeen)}:</span>
      <a class="x-stat" href={browse({ changed: "1" })}>
        <strong>{c.changed}</strong> items changed
      </a>
      <span class="x-stat">
        <strong>{c.workstreamsMoved}</strong> workstreams moved
      </span>
      <span class="x-stat">
        <strong>{c.needsYou}</strong> need you
      </span>
      <span class="x-stat">
        <strong>{c.candidates}</strong> not in a workstream
      </span>
    </div>
  );
}

const categories = [
  ["done", "done"],
  ["in-progress", "in progress"],
  ["todo", "to do"],
] as const;

export function StatusBar({ status }: { status: Card["status"] }) {
  const shown = categories.filter(([c]) => status[c] > 0);
  const label = shown.map(([c, name]) => `${status[c]} ${name}`).join(", ");
  return (
    <span class="status-bar" role="img" aria-label={label} title={label}>
      {shown.map(([c]) => (
        <span key={c} class={`segment ${c}`} style={{ flexGrow: status[c] }} />
      ))}
    </span>
  );
}

export function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => `${(i / 13) * 56},${16 - (v / max) * 14}`).join(" ");
  return (
    <svg class="x-spark" viewBox="0 0 56 17" aria-label={`Activity, 14 days: ${values.join(", ")}`}>
      <polyline points={points} />
    </svg>
  );
}

export function WorkstreamCard({ card, now }: { card: Card; now: string }) {
  return (
    <article class="x-card" data-workstream={card.name}>
      <h3 class="x-card-name">
        <a href={`/workstreams/${card.id}`}>{card.name}</a>
      </h3>
      <p class="x-card-sources">{card.bySource.map((s) => `${s.count} ${s.source}`).join(" · ")}</p>
      <div class="x-card-status">
        <StatusBar status={card.status} />
        <Spark values={card.activity} />
      </div>
      <p class="x-card-moved">
        {card.moved > 0 ? (
          <>
            <strong>{card.moved}</strong> moved since you looked
            {card.movedDone > 0 && `, ${card.movedDone} to done`}
          </>
        ) : (
          <span class="x-quiet">
            Nothing moved since you looked · last activity {since(card.lastActivity, now)} ago
          </span>
        )}
      </p>
      <p class="x-card-threads">
        {[
          card.threads.working > 0 && `${card.threads.working} working`,
          card.threads.waiting > 0 && `${card.threads.waiting} waiting on you`,
          card.threads.done > 0 && `${card.threads.done} done`,
        ]
          .filter(Boolean)
          .join(" · ") || "No threads"}
      </p>
      {card.signals.map((s) => (
        <p key={s.rule} class="x-signal" data-tone={s.tone} title={s.rule}>
          <span class="derived-tag">Oriel rule</span>
          {s.text}
        </p>
      ))}
    </article>
  );
}

export function Make({ candidate }: { candidate: Candidate }) {
  const [made, setMade] = useState<string | null>(null);
  if (made)
    return (
      <span class="x-made" role="status">
        {made}
      </span>
    );
  return (
    <button
      type="button"
      class="quiet-action x-make"
      data-make
      onClick={async () => {
        const reply = await fetch("/api/explore/make", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: candidate.id, name: candidate.suggested }),
        });
        const body = (await reply.json()) as { name: string; size: number };
        setMade(`Made workstream ${body.name} (${plural(body.size, "item")})`);
      }}
    >
      Make a workstream
    </button>
  );
}

export function Candidates({ data, cap = 5 }: { data: OverviewData; cap?: number }) {
  const rows = data.candidates.slice(0, cap);
  return (
    <Section
      id="candidates"
      title="Not in a workstream yet"
      count={data.candidates.length}
      more={
        <More shown={rows.length} total={data.candidates.length} href={browse({ held: "0" })} />
      }
    >
      <ul class="x-rows">
        {rows.map((c) => (
          <li key={c.id} class="x-row x-candidate">
            <span class="x-title">
              {c.label} <span class="key">{c.key}</span>
            </span>
            <span class="x-sub">
              {c.source} · {c.detail}
            </span>
            <span class="x-rule" title={c.rule}>
              <span class="derived-tag">Oriel rule</span>
              {c.rule}
            </span>
            <Make candidate={c} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

// Round 9: the top candidates by weight, one line each, under their rule,
// which shows once per group.
export function GroupedCandidates({ data, cap = 8 }: { data: OverviewData; cap?: number }) {
  const rows = data.candidates.slice(0, cap);
  const groups = [...Map.groupBy(rows, (c) => c.rule)];
  return (
    <Section
      id="candidates"
      title="Not in a workstream yet"
      count={data.candidates.length}
      more={
        <More shown={rows.length} total={data.candidates.length} href={browse({ held: "0" })} />
      }
    >
      <div class="x-rows x-grouped">
        {groups.map(([rule, list]) => (
          <div key={rule} class="x-group">
            <p class="x-rule">
              <span class="derived-tag">Oriel rule</span>
              {rule}
            </p>
            <ul>
              {list.map((c) => (
                <li key={c.id} class="x-line">
                  <span class="x-title">{c.label}</span>
                  <span class="x-sub">
                    {c.source} · {c.detail}
                  </span>
                  <CiteButton cite={{ kind: "item", id: c.id, label: c.key }} />
                  <Make candidate={c} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function People({ data, cap = 5 }: { data: OverviewData; cap?: number }) {
  const [all, setAll] = useState(false);
  const rows = all ? data.people : data.people.slice(0, cap);
  return (
    <Section id="people" title="In progress, by person" count={data.people.length}>
      <ul class="x-rows">
        {rows.map((p) => (
          <PersonLine key={p.id} person={p} />
        ))}
      </ul>
      <More shown={rows.length} total={data.people.length} onClick={() => setAll(true)} />
    </Section>
  );
}

function PersonLine({ person }: { person: PersonRow }) {
  const [open, setOpen] = useState(false);
  const top = person.workstreams[0];
  return (
    <li class="x-row x-person" data-person data-open={open ? "" : undefined}>
      <button
        type="button"
        class="x-person-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span class="x-title">{person.name}</span>
        <span class="x-sub">
          {person.inProgress} in progress
          {top ? ` · most in ${top.name} (${top.count})` : " · none in a workstream"}
        </span>
      </button>
      {open && (
        <ul class="x-person-items">
          {person.items.map((item) => (
            <li key={item.key}>
              <span class="key">{item.key}</span> {item.title}
              <span class="x-sub"> · {item.workstream ?? "not in a workstream"}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Talked({ data, cap = 3 }: { data: OverviewData; cap?: number }) {
  return (
    <Section id="talked" title="Named most in chat this week">
      <ul class="x-rows">
        {data.talked.slice(0, cap).map((t) => (
          <li key={t.id} class="x-row">
            <span class="x-title">
              <span class="key">{t.key}</span> {t.title}
            </span>
            <span class="x-sub">
              named {t.refs}× · {t.workstream ?? "not in a workstream"}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Find({ inline = false }: { inline?: boolean }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ListData | null>(null);
  useEffect(() => {
    if (q.trim() === "") {
      setFound(null);
      return;
    }
    let live = true;
    void fetch(`/api/explore/list?${new URLSearchParams({ q })}`)
      .then((r) => r.json() as Promise<ListData>)
      .then((d) => live && setFound(d));
    return () => {
      live = false;
    };
  }, [q]);
  return (
    <div class={inline ? "x-find inline" : "x-find"} role="search">
      <input
        data-find
        type="search"
        placeholder="Find an item, a person, a workstream"
        value={q}
        onInput={(e) => setQ(e.currentTarget.value)}
      />
      {found && (
        <ul class="x-found">
          {found.items.slice(0, 6).map((item) => (
            <li key={item.id} class="x-row">
              <span class="key">{item.key}</span>
              <span class="x-title">{item.title}</span>
              <span class="x-sub">
                {item.source} · {item.status ?? "no status"} ·{" "}
                {item.workstream ?? "not in a workstream"}
              </span>
            </li>
          ))}
          {found.total === 0 && <li class="x-quiet">Nothing matches.</li>}
        </ul>
      )}
    </div>
  );
}

export function browse(filter: Record<string, string>) {
  return `/?${new URLSearchParams({ view: "browse", ...filter })}`;
}

function Browse({ design }: { design: string }) {
  const [data, setData] = useState<ListData | null>(null);
  const params = new URLSearchParams(location.search);
  params.delete("view");
  params.delete("design");
  useEffect(() => {
    void fetch(`/api/explore/list?${params}`)
      .then((r) => r.json() as Promise<ListData>)
      .then(setData);
  }, []);
  return (
    <div class="x-page" data-useful>
      <nav class="x-tabs">
        <a href={`/?design=${design}`}>Overview</a>
        <a aria-current="page" href={browse({})}>
          Browse
        </a>
      </nav>
      <Find inline />
      {data && (
        <ul class="x-rows x-browse">
          <li class="x-quiet">{plural(data.total, "item")}</li>
          {data.items.map((item) => (
            <li key={item.id} class="x-row">
              <span class="key">{item.key}</span>
              <span class="x-title">{item.title}</span>
              <span class="x-sub">
                {item.source} · {item.status ?? "—"} · {item.assignee ?? "nobody"} ·{" "}
                {item.workstream ?? "not in a workstream"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Layouts --------------------------------------------------------------------

// Round 1: 0027 as written. Counts, needs you, a card per workstream, one
// ranked "Not in a workstream yet", in progress by person; Browse beside it.
function OverviewR1({ data, design }: Props) {
  const cards = data.workstreams.toSorted((a, b) => b.moved - a.moved);
  return (
    <div class="x-page" data-useful>
      <nav class="x-tabs">
        <a aria-current="page" href={`/?design=${design}`}>
          Overview
        </a>
        <a data-browse href={browse({})}>
          Browse
        </a>
      </nav>
      <Strip data={data} />
      <NeedsYou data={data} />
      <Section id="workstreams" title="Workstreams" count={cards.length}>
        <div class="x-cards">
          {cards.map((card) => (
            <WorkstreamCard key={card.id} card={card} now={data.now} />
          ))}
        </div>
      </Section>
      <Candidates data={data} />
      <People data={data} />
    </div>
  );
}

// A workstream as one row: name, status, what moved, when, threads, signals.
export type Flags = {
  mostMoved: string | null;
  quietest: string | null;
  talked: OverviewData["talked"];
};

export function WorkstreamTable({
  cards,
  now,
  flags,
}: {
  cards: Card[];
  now: string;
  flags?: Flags;
}) {
  return (
    <ul class="x-rows x-table">
      {cards.map((card) => (
        <li key={card.id} class="x-row x-ws" data-workstream={card.name}>
          {flags && (
            <span class="x-ws-flags">
              {card.id === flags.mostMoved && (
                <span
                  class="x-flag"
                  title="The workstream with the most members changed since you last looked"
                >
                  Most moved
                </span>
              )}
              {card.id === flags.quietest && (
                <span
                  class="x-flag warn"
                  title="The open workstream whose latest activity is oldest"
                >
                  Quiet longest
                </span>
              )}
              {flags.talked
                .filter((t) => t.workstream === card.name)
                .slice(0, 1)
                .map((t) => (
                  <span
                    key={t.id}
                    class="x-flag"
                    title="Named in chat messages from the last 7 days"
                  >
                    {t.key} named {t.refs}× in chat this week
                  </span>
                ))}
            </span>
          )}
          <span class="x-ws-namecell">
            <a class="x-title x-ws-name" href={`/workstreams/${card.id}`}>
              {card.name}
            </a>
            <CiteButton cite={{ kind: "workstream", id: card.id, label: card.name }} />
          </span>
          <span class="x-ws-bar">
            <StatusBar status={card.status} />
          </span>
          <span class="x-ws-moved">
            {card.moved > 0 ? (
              <>
                <strong>{card.moved}</strong> moved
                {card.movedDone > 0 && `, ${card.movedDone} done`}
              </>
            ) : (
              <span class="x-quiet">none moved</span>
            )}
          </span>
          <span class="x-ws-last" title="Latest member update or thread activity">
            {since(card.lastActivity, now)} ago
          </span>
          <span class="x-ws-threads">
            {card.threads.waiting > 0
              ? `${card.threads.waiting} waiting on you`
              : card.threads.working > 0
                ? `${card.threads.working} working`
                : ""}
          </span>
          <span class="x-ws-signals">
            {card.signals.map((s) => (
              <span key={s.rule} class="x-signal" title={s.rule}>
                {s.text}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Round 2: denser. One line per workstream, and the overview in two columns
// where there is room, so every section starts on the first screen.
function OverviewR2({
  data,
  design,
  headlines = false,
  roster = false,
  tokens = false,
  cap = 0,
  flags = false,
  calm = false,
  grouped = false,
  chat,
  suggest = false,
  pinStrip = false,
  pinTop = 5,
  citeAsks = false,
}: Props & {
  chat?: "rail" | "top" | "inline";
  suggest?: boolean;
  pinStrip?: boolean;
  pinTop?: number;
  citeAsks?: boolean;
  calm?: boolean;
  grouped?: boolean;
  headlines?: boolean;
  roster?: boolean;
  tokens?: boolean;
  cap?: number;
  flags?: boolean;
}) {
  const sorted = data.workstreams.toSorted((a, b) => b.moved - a.moved);
  // Capped: the ones that moved most, and any stalled one, which a cap
  // would otherwise hide.
  const cards = cap > 0 ? sorted.filter((card, i) => i < cap || card.idleDays >= 14) : sorted;
  return (
    <div class="x-page x-dense" data-useful>
      <div class="x-top">
        <nav class="x-tabs">
          <a aria-current="page" href={`/?design=${design}`}>
            Overview
          </a>
          <a data-browse href={browse({})}>
            Browse
          </a>
        </nav>
        <Strip data={data} />
        {(chat === "top" || chat === "inline") && (
          <div class="x-askbar">
            <Composer />
            {suggest && <Suggestions cited={citeAsks} />}
          </div>
        )}
      </div>
      {chat === "inline" && <InlineAnswers />}
      {headlines && !calm && <Headlines data={data} />}
      <div class="x-columns">
        <div class="x-main">
          <NeedsYou data={data} cap={4} />
          {calm && (
            <Headlines data={data} only={["moved", "quiet", "talked", "top"]} pins={!pinStrip} />
          )}
          {pinStrip && <PinnedStrip data={data} top={pinTop} />}
          <Section id="workstreams" title="Workstreams" count={sorted.length}>
            <WorkstreamTable
              cards={cards}
              now={data.now}
              {...(flags && {
                flags: {
                  mostMoved: sorted[0]?.id ?? null,
                  quietest:
                    data.workstreams.toSorted((a, b) =>
                      a.lastActivity.localeCompare(b.lastActivity),
                    )[0]?.id ?? null,
                  // The most-named item of each workstream, for the three most named.
                  talked: data.talked.filter((t) => t.workstream !== null).slice(0, 3),
                },
              })}
            />
            <More shown={cards.length} total={sorted.length} href={browse({ view: "browse" })} />
          </Section>
        </div>
        <div class="x-side">
          {grouped ? <GroupedCandidates data={data} /> : <Candidates data={data} />}
          {roster ? <Roster data={data} tokens={tokens} /> : <People data={data} />}
        </div>
      </div>
      {chat === "rail" && <Rail suggest={suggest} />}
      {chat === "top" && <Panel />}
    </div>
  );
}

// Round 3: headlines. One computed line for each standing question, each the
// extreme of one measure, with its rule. A fixed number of lines whatever the
// number of sources or workstreams.
export function Headlines({
  data,
  only,
  pins = true,
}: {
  data: OverviewData;
  only?: string[];
  pins?: boolean;
}) {
  const cards = data.workstreams;
  const moved = cards.toSorted((a, b) => b.moved - a.moved)[0];
  const quiet = cards.toSorted((a, b) => a.lastActivity.localeCompare(b.lastActivity))[0];
  const waited = data.needsYou[0];
  const talked = data.talked[0];
  const top = data.candidates[0];
  const busiest = data.people[0];
  const lines: { id: string; label: string; rule: string; body: ComponentChildren }[] = [];
  if (waited)
    lines.push({
      id: "waited",
      label: "Waited longest",
      rule: `The oldest of the ${data.needsYou.length} threads waiting on you`,
      body: (
        <>
          <a class="x-title" href={`/threads/${waited.thread.id}`}>
            {waited.thread.title}
          </a>{" "}
          <span class="x-sub">
            {since(waited.since, data.now)} · {waited.workstream.name}
          </span>
        </>
      ),
    });
  if (moved && moved.moved > 0)
    lines.push({
      id: "moved",
      label: `Moved most since ${weekday(data.lastSeen)}`,
      rule: "The workstream with the most members changed since you last looked",
      body: (
        <>
          <a class="x-title" href={`/workstreams/${moved.id}`}>
            {moved.name}
          </a>{" "}
          <span class="x-sub">
            {moved.moved} items moved{moved.movedDone > 0 && `, ${moved.movedDone} to done`}
          </span>
        </>
      ),
    });
  if (quiet)
    lines.push({
      id: "quiet",
      label: "Quiet longest",
      rule: "The open workstream whose latest member update or thread activity is oldest",
      body: (
        <>
          <a class="x-title" href={`/workstreams/${quiet.id}`}>
            {quiet.name}
          </a>{" "}
          <span class="x-sub">nothing moved in {plural(quiet.idleDays, "day")}</span>
        </>
      ),
    });
  if (talked)
    lines.push({
      id: "talked",
      label: "Named most in chat this week",
      rule: "The item chat messages from the last 7 days name most",
      body: (
        <>
          <span class="x-title">
            <span class="key">{talked.key}</span> {talked.title}
          </span>{" "}
          <span class="x-sub">
            named {talked.refs}× ·{" "}
            {talked.workstream ? `in ${talked.workstream}` : "not in a workstream"}
          </span>
        </>
      ),
    });
  if (top)
    lines.push({
      id: "top",
      label: "Top not in a workstream",
      rule: top.rule,
      body: (
        <>
          <span class="x-title">{top.label}</span>{" "}
          <span class="x-sub">
            {top.source} · {top.detail}
          </span>
        </>
      ),
    });
  if (busiest)
    lines.push({
      id: "busiest",
      label: "Most in progress",
      rule: "The person with the most items in progress",
      body: (
        <>
          <span class="x-title">{busiest.name}</span>{" "}
          <span class="x-sub">{busiest.inProgress} items in progress</span>
        </>
      ),
    });
  const shown = only ? lines.filter((line) => only.includes(line.id)) : lines;
  return (
    <section class="x-headlines" data-section="headlines" aria-label="Headlines">
      {shown.map((line) => (
        <p key={line.id} class="x-headline" title={line.rule}>
          <span class="x-headline-label">{line.label}</span>
          <span class="x-headline-body">{line.body}</span>
        </p>
      ))}
      {pins && <Pins data={data} />}
    </section>
  );
}

// Rounds 10 on: an answer pinned from the chat, its question rerun on each look.
function Pins({ data }: { data: OverviewData }) {
  const chat = useChat();
  return (
    <>
      {(data.chat?.pins ?? []).map((p) => (
        <p
          key={p.id}
          class="x-headline x-pinned"
          data-pinned
          title={`Pinned: "${p.q}", rerun on each look`}
        >
          <span class="x-headline-label">
            Pinned · {p.title}
            {chat && (
              <button
                type="button"
                class="x-unpin"
                aria-label={`Unpin ${p.title}`}
                onClick={() => chat.unpin(p.id)}
              >
                ×
              </button>
            )}
          </span>
          <span class="x-headline-body">{p.headline}</span>
        </p>
      ))}
    </>
  );
}

function OverviewR3(props: Props) {
  return <OverviewR2 {...props} headlines />;
}

// Round 4: everyone in progress, one short line each, where the side column
// has room beside the workstreams; the first five, and "N more", where not.
export function Roster({
  data,
  cap = 5,
  tokens = false,
}: {
  data: OverviewData;
  cap?: number;
  tokens?: boolean;
}) {
  const [all, setAll] = useState(false);
  return (
    <Section id="people" title="In progress, by person" count={data.people.length}>
      <ul class={`x-rows x-roster${all ? " all" : ""}${tokens ? " tokens" : ""}`}>
        {data.people.map((p, i) => {
          const top = p.workstreams[0];
          return (
            <li
              key={p.id}
              class={i < cap ? "x-row x-person" : "x-row x-person x-extra"}
              data-person
            >
              {p.name}
              <span class="x-sub">
                {p.inProgress}
                {top && <span class="x-where">{` · ${top.name} (${top.count})`}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {!all && !tokens && (
        <span class="x-narrow-only">
          <More shown={cap} total={data.people.length} onClick={() => setAll(true)} />
        </span>
      )}
    </Section>
  );
}

function OverviewR4(props: Props) {
  return <OverviewR2 {...props} headlines roster />;
}

// Round 5: on a narrow screen, everyone as a wrapped line of name and count.
function OverviewR5(props: Props) {
  return <OverviewR2 {...props} headlines roster tokens />;
}

// Round 6: R5 with the workstream list capped.
function OverviewR6(props: Props) {
  return <OverviewR2 {...props} headlines roster tokens cap={8} />;
}

// Round 7: R6 with no headlines; their facts are flags on the rows they're about.
function OverviewR7(props: Props) {
  return <OverviewR2 {...props} roster tokens cap={8} flags />;
}

// Round 8: R6 with Needs you first, only the headlines no row right below
// already says, and no second Needs you in the sidebar on this page.
function OverviewR8(props: Props) {
  return <OverviewR2 {...props} headlines roster tokens cap={8} calm />;
}

// Round 9: R8 with Not in a workstream yet as one-line rows under their rule.
function OverviewR9(props: Props) {
  return <OverviewR2 {...props} headlines roster tokens cap={8} calm grouped />;
}

// Round 10: round 9 with 0027's window chat as written: a rail beside the
// overview, Ask on each workstream and candidate row, answers pinnable.
function OverviewR10(props: Props) {
  return <OverviewR2 {...props} headlines roster tokens cap={8} calm grouped chat="rail" />;
}

// Round 11: an ask bar at the top; answers in a panel only while asking.
function OverviewR11(props: Props) {
  return <OverviewR2 {...props} headlines roster tokens cap={8} calm grouped chat="top" />;
}

// Round 12: answers in place under the ask bar; pins keep their form.
function OverviewR12(props: Props) {
  return (
    <OverviewR2 {...props} headlines roster tokens cap={8} calm grouped chat="inline" pinStrip />
  );
}

// Round 13: round 11 with questions to start from under the ask bar, pins in
// their own compact strip, and each person's main workstream on narrow too.
function OverviewR13(props: Props) {
  return (
    <OverviewR2
      {...props}
      headlines
      roster
      tokens
      cap={8}
      calm
      grouped
      chat="top"
      suggest
      pinStrip
      pinTop={3}
    />
  );
}

// Round 14: round 13, and a cited row offers questions about itself.
function OverviewR14(props: Props) {
  return (
    <OverviewR2
      {...props}
      headlines
      roster
      tokens
      cap={8}
      calm
      grouped
      chat="top"
      suggest
      pinStrip
      pinTop={3}
      citeAsks
    />
  );
}

const chatDesigns = new Set(["r10", "r11", "r12", "r13", "r14"]);

export const layouts: Record<string, (props: Props) => ComponentChildren> = {
  r14: OverviewR14,
  r13: OverviewR13,
  r12: OverviewR12,
  r11: OverviewR11,
  r10: OverviewR10,
  r9: OverviewR9,
  r8: OverviewR8,
  r7: OverviewR7,
  r6: OverviewR6,
  r5: OverviewR5,
  r4: OverviewR4,
  r3: OverviewR3,
  r1: OverviewR1,
  r2: OverviewR2,
};
