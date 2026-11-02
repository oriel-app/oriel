// Spike (window-explore): prototype overviews, chosen by `?design=` and kept
// for the tab's session. Rough on purpose: each design composes the same
// sections differently. Nothing here is generated; every number comes from
// the server's /api/explore/overview.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
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

export const layouts: Record<string, (props: Props) => ComponentChildren> = {
  r1: OverviewR1,
};
