const root = document.documentElement;
const defaults = { theme: "graphite", scheme: "system", size: "default", vp: "wide" };

function current() {
  const p = new URLSearchParams(location.search);
  return {
    theme: p.get("theme") ?? root.dataset.theme ?? defaults.theme,
    scheme: p.get("scheme") ?? defaults.scheme,
    size: p.get("size") ?? defaults.size,
    vp: p.get("vp") ?? defaults.vp,
  };
}

function search(view) {
  const p = new URLSearchParams();
  for (const key of Object.keys(defaults)) if (view[key] !== defaults[key]) p.set(key, view[key]);
  const s = p.toString();
  return s ? `?${s}` : "";
}

function carry(view) {
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href || !href.startsWith("/") || href.startsWith("//")) continue;
    if (/\.(md|css|json|png)(#|$)/.test(href.split("?")[0])) continue;
    const url = new URL(href, location.origin);
    for (const key of Object.keys(defaults)) url.searchParams.delete(key);
    const extra = url.searchParams.toString();
    const q = search(view);
    const joined = q && extra ? `${q}&${extra}` : q || (extra ? `?${extra}` : "");
    a.setAttribute("href", `${url.pathname}${joined}${url.hash}`);
  }
}

function apply(view) {
  root.dataset.theme = view.theme;
  if (view.size === "default") delete root.dataset.textSize;
  else root.dataset.textSize = view.size;
  root.dataset.wsVp = view.vp;
  const tokens = document.getElementById("ws-tokens");
  const href = `/oriel/tokens.css${view.scheme === "system" ? "" : `?scheme=${view.scheme}`}`;
  if (tokens && tokens.getAttribute("href") !== href) tokens.setAttribute("href", href);
  for (const frame of document.querySelectorAll(".ws-stage iframe"))
    frame.contentWindow?.postMessage({ type: "ws-view", ...view }, location.origin);
  carry(view);
  scale();
}

function change(key, value) {
  const view = { ...current(), [key]: value };
  history.replaceState(null, "", `${location.pathname}${search(view)}${location.hash}`);
  apply(view);
}

document
  .getElementById("ws-theme")
  ?.addEventListener("change", (e) => change("theme", e.target.value));
document
  .getElementById("ws-size")
  ?.addEventListener("change", (e) => change("size", e.target.value));
for (const name of ["scheme", "vp"])
  for (const input of document.querySelectorAll(`input[name="${name}"]`))
    input.addEventListener("change", (e) => change(name, e.target.value));

addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.data?.type !== "ws-height") return;
  for (const frame of document.querySelectorAll(".ws-stage iframe")) {
    if (frame.contentWindow !== event.source) continue;
    const figure = frame.closest(".ws-specimen");
    if (
      figure?.hasAttribute("data-screen") ||
      figure?.querySelector(".ws-stage")?.style.getPropertyValue("--ws-height")
    )
      return;
    frame.style.height = `${Math.ceil(event.data.height)}px`;
  }
});

function scale() {
  for (const stage of document.querySelectorAll(".ws-specimen[data-screen] .ws-stage")) {
    const s = root.dataset.wsVp === "390" ? 1 : Math.min(1, stage.clientWidth / 1280);
    stage.style.setProperty("--ws-scale", String(s));
  }
}
addEventListener("resize", scale);

document.addEventListener("click", async (event) => {
  const button = event.target.closest?.("[data-copy]");
  if (!button) return;
  const code = button.parentElement?.querySelector("code")?.textContent ?? "";
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select and copy";
  }
  setTimeout(() => (button.textContent = "Copy"), 1500);
});

const input = document.getElementById("ws-search");
const results = document.getElementById("ws-results");
let index = null;
let active = -1;

async function find(term) {
  index ??= await (await fetch("/search.json")).json();
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const page of index) {
    const hay = (extra) =>
      [page.title, page.section, page.summary, page.status, ...page.classes, extra]
        .join(" ")
        .toLowerCase();
    if (words.every((w) => hay("").includes(w)))
      hits.push({
        url: page.url,
        title: page.title,
        sub: `${page.section}${page.status ? ` · ${page.status}` : ""}`,
        rank: 0,
      });
    for (const h of [...page.headings, ...page.specimens.map((s) => ({ text: s.title, id: s.id }))])
      if (
        words.every((w) => hay(h.text).includes(w)) &&
        words.some((w) => h.text.toLowerCase().includes(w))
      )
        hits.push({
          url: `${page.url}#${h.id}`,
          title: h.text.replace(/`/g, ""),
          sub: page.title,
          rank: 1,
        });
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, 12);
}

function show(hits) {
  results.innerHTML = "";
  active = -1;
  for (const [i, hit] of hits.entries()) {
    const li = document.createElement("li");
    li.setAttribute("role", "presentation");
    const a = document.createElement("a");
    a.href = hit.url;
    a.id = `ws-hit-${i}`;
    a.setAttribute("role", "option");
    a.tabIndex = -1;
    a.textContent = hit.title;
    const small = document.createElement("small");
    small.textContent = hit.sub;
    a.append(small);
    li.append(a);
    results.append(li);
  }
  if (hits.length === 0 && input.value.trim()) {
    const li = document.createElement("li");
    li.textContent = "Nothing matches. Try a class name, such as quiet-action.";
    li.className = "ws-no-hits";
    results.append(li);
  }
  results.hidden = results.childElementCount === 0;
  input.setAttribute("aria-expanded", String(!results.hidden));
  carry(current());
}

function move(by) {
  const options = [...results.querySelectorAll("[role=option]")];
  if (options.length === 0) return;
  active = (active + by + options.length) % options.length;
  for (const [i, o] of options.entries()) o.setAttribute("aria-selected", String(i === active));
  input.setAttribute("aria-activedescendant", options[active].id);
  options[active].scrollIntoView({ block: "nearest" });
}

input?.addEventListener("input", async () => {
  const term = input.value.trim();
  show(term ? await find(term) : []);
});
input?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") move(1);
  else if (event.key === "ArrowUp") move(-1);
  else if (event.key === "Enter") {
    const option = results.querySelectorAll("[role=option]")[Math.max(active, 0)];
    if (option) location.href = option.href;
  } else if (event.key === "Escape") {
    input.value = "";
    show([]);
  } else return;
  event.preventDefault();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement === document.body) {
    event.preventDefault();
    input?.focus();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest?.(".ws-search")) show([]);
});

apply(current());
