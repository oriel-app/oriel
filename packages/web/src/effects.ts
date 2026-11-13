import { type Effect, unreachable } from "./http.ts";
import type { Msg } from "./root.ts";
import { changeSetAnchor, parseRoute, routeUrl } from "./route.ts";
import type { ThreadMsg } from "./thread.ts";
import {
  type BrowseFilter,
  type ClusterPageView,
  filterKeys,
  filterParams,
  type GroupingId,
  type StreamEvent,
  type WindowView,
} from "./view.ts";

let shownAt: number | null = null;
let gliding = false;
let events: EventSource | null = null;
let threadsMoved: EventSource | null = null;

export function perform(effect: Effect, dispatch: (msg: Msg) => void): void {
  switch (effect.type) {
    case "loadWindow": {
      const { request } = effect;
      loadWindow(effect.grouping, effect.filter ?? {}).then(
        (window) => dispatch({ type: "window", msg: { type: "windowLoaded", request, window } }),
        () => dispatch({ type: "window", msg: { type: "windowFailed", request } }),
      );
      return;
    }
    case "loadItems": {
      const { request, cluster } = effect;
      loadItems(effect.grouping, cluster, effect.from, effect.filter ?? {}).then(
        (page) => dispatch({ type: "window", msg: { type: "itemsLoaded", request, page } }),
        () =>
          dispatch({
            type: "window",
            msg: { type: "itemsFailed", request, key: cluster, from: effect.from },
          }),
      );
      return;
    }
    case "showFilter": {
      const url = new URL(location.href);
      for (const key of filterKeys) url.searchParams.delete(key);
      for (const [key, value] of filterParams(effect.filter)) url.searchParams.set(key, value);
      history.replaceState(null, "", url);
      return;
    }
    case "showGrouping": {
      const url = new URL(location.href);
      url.searchParams.set("grouping", effect.grouping);
      history.replaceState(null, "", url);
      return;
    }
    case "http": {
      const { tag } = effect;
      const init: RequestInit =
        effect.method === "POST"
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(effect.body ?? {}),
            }
          : {};
      fetch(effect.url, init)
        .then(async (response) => {
          const body: unknown = await response.json().catch(() => null);
          dispatch({ type: "replied", tag, ok: response.ok, body });
        })
        .catch(() => dispatch({ type: "replied", tag, ok: false, body: { error: unreachable } }));
      return;
    }
    case "navigate": {
      const url = routeUrl(effect.route);
      if (effect.replace) history.replaceState(null, "", url);
      else if (`${location.pathname}${location.search}` !== url) history.pushState(null, "", url);
      dispatch({ type: "routed", route: parseRoute(location.pathname, location.search) });
      if (!effect.stay) scrollTo(0, 0);
      return;
    }
    case "showLatest": {
      // A jump would cut a glide to the latest short; once the glide ends, the chat is asked again.
      if (gliding && !effect.smooth) return;
      const chat = scroller();
      const below = belowLatest(chat);
      if (below === null) return;
      const was = scrolledTo(chat);
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior = effect.smooth && !still && below > 1 ? "smooth" : "auto";
      if (behavior === "smooth") {
        gliding = true;
        const glided = () => {
          gliding = false;
          dispatch({ type: "thread", msg: { type: "rendered" } });
        };
        (chat ?? document).addEventListener("scrollend", glided, { once: true });
      }
      (chat ?? window).scrollBy({ top: below, behavior });
      // Another in the same frame may not move it, and has no event to skip.
      // A glide's events are on the way to the latest, so none reads as up.
      if (scrolledTo(chat) !== was) shownAt = scrolledTo(chat);
      return;
    }
    case "showChangeSet":
      // After the page renders: a folded change set the link opened is only there then.
      requestAnimationFrame(() => {
        const set = document.getElementById(changeSetAnchor(effect.changeSetId));
        if (!set) return;
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
        set.scrollIntoView({
          block: "start",
          behavior: effect.smooth && !still ? "smooth" : "auto",
        });
        (set.querySelector<HTMLElement>(".change-set-head h2") ?? set).focus({
          preventScroll: true,
        });
      });
      return;
    case "focusComposer":
      focusComposer(10);
      return;
    case "focusFolded":
      requestAnimationFrame(() => {
        const set = document.getElementById(changeSetAnchor(effect.changeSetId));
        const active = document.activeElement;
        if (!set || (active && active !== document.body && !set.contains(active))) return;
        set.querySelector<HTMLElement>(".change-set-head > .quiet-action")?.focus({
          preventScroll: true,
        });
      });
      return;
    case "focusHeading":
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(".thread-title")?.focus({ preventScroll: true }),
      );
      return;
    case "subscribe": {
      events?.close();
      // The browser reconnects by itself and sends the last entry's ID, so
      // the server resumes after it.
      events = new EventSource(`/api/threads/${effect.threadId}/events?after=${effect.after}`);
      events.onmessage = (message: MessageEvent<string>) => {
        dispatch({ type: "streamed", event: JSON.parse(message.data) as StreamEvent });
      };
      // EventSource errs before every reconnect, and when its first try fails.
      let lost = false;
      events.onerror = () => {
        lost = true;
      };
      events.onopen = () => {
        if (lost) dispatch({ type: "streamReopened", stream: "thread" });
        lost = false;
      };
      return;
    }
    case "watchThreads": {
      // The browser gives up on a stream after an error answer; that one opens again.
      if (threadsMoved && threadsMoved.readyState !== EventSource.CLOSED) return;
      threadsMoved = new EventSource("/api/threads/events");
      threadsMoved.onmessage = () => dispatch({ type: "threadsMoved" });
      // A move may have landed before the stream opened, or while it was
      // down: the server tells only what happens while it's open.
      let lost = false;
      threadsMoved.onerror = () => {
        lost = true;
      };
      threadsMoved.onopen = () => {
        dispatch(lost ? { type: "streamReopened", stream: "threads" } : { type: "threadsMoved" });
        lost = false;
      };
      return;
    }
    case "unwatchThreads":
      threadsMoved?.close();
      threadsMoved = null;
      return;
    case "unsubscribe":
      events?.close();
      events = null;
      return;
    case "copy":
      navigator.clipboard?.writeText(effect.text).catch(() => {});
      return;
    case "after":
      setTimeout(() => dispatch(effect.msg), effect.ms);
      return;
    case "rendered":
      // The page renders in a microtask; input events come first in a frame.
      requestAnimationFrame(() => dispatch(effect.msg));
      return;
    case "showLook": {
      const html = document.documentElement;
      html.dataset.theme = effect.theme;
      if (effect.textSize === "default") delete html.dataset.textSize;
      else html.dataset.textSize = effect.textSize;
      return;
    }
  }
}

const scroller = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(".window-chat-entries");

const scrolledTo = (chat: HTMLElement | null): number => (chat ? chat.scrollTop : scrollY);

function belowLatest(chat: HTMLElement | null): number | null {
  if (chat) return chat.scrollHeight - chat.clientHeight - chat.scrollTop;
  const thread = document.querySelector("main.thread");
  return thread ? thread.getBoundingClientRect().bottom - innerHeight : null;
}

// The scroll event for the chat's own scroll to the latest entry isn't the user's: a block
// rendering between that scroll and its event would read as them leaving.
export function watchLatest(
  send: (msg: ThreadMsg) => void,
  chat: HTMLElement | null = null,
): () => void {
  const target = chat ?? window;
  let was = scrolledTo(chat);
  const moved = (up: boolean) => {
    const below = belowLatest(chat);
    if (below !== null) send({ type: "scrolled", below, up });
  };
  const scrolled = () => {
    const at = scrolledTo(chat);
    // Moved again before the event for the chat's own scroll: up from there.
    const up = at < (shownAt ?? was);
    const itself = at === shownAt;
    was = at;
    shownAt = null;
    if (!itself) moved(up);
  };
  // A details element's toggle doesn't bubble.
  const toggled = ({ target: opened }: Event) => {
    if (opened instanceof HTMLDetailsElement && opened.open && opened.closest(".chat")) moved(true);
  };
  target.addEventListener("scroll", scrolled, { passive: true });
  target.addEventListener("toggle", toggled, true);
  return () => {
    // A chat closed mid-glide hears no end to it.
    gliding = false;
    target.removeEventListener("scroll", scrolled);
    target.removeEventListener("toggle", toggled, true);
  };
}

async function loadWindow(grouping: GroupingId, filter: BrowseFilter): Promise<WindowView> {
  const query = new URLSearchParams([["grouping", grouping], ...filterParams(filter)]);
  const response = await fetch(`/api/browse?${query}`);
  if (!response.ok) throw new Error(`GET /api/browse: ${response.status}`);
  return (await response.json()) as WindowView;
}

async function loadItems(
  grouping: GroupingId,
  cluster: string,
  from: number,
  filter: BrowseFilter,
): Promise<ClusterPageView> {
  const query = new URLSearchParams([
    ["grouping", grouping],
    ["cluster", cluster],
    ["from", String(from)],
    ...filterParams(filter),
  ]);
  const response = await fetch(`/api/browse/items?${query}`);
  if (!response.ok) throw new Error(`GET /api/browse/items: ${response.status}`);
  return (await response.json()) as ClusterPageView;
}

function focusComposer(frames: number): void {
  const field =
    document.querySelector<HTMLTextAreaElement>(".panel-dock textarea") ??
    document.querySelector<HTMLTextAreaElement>(":not([inert]) > .composer textarea");
  if (field) field.focus();
  else if (frames > 0) requestAnimationFrame(() => focusComposer(frames - 1));
}
