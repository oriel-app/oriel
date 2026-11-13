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

// Where a chat last scrolled itself to its latest entry, until the scroll
// event that says so.
let shownAt: number | null = null;
// A chat is gliding to its latest entry, as the New message pill asks.
let gliding = false;
// The thread being watched, one at a time.
let events: EventSource | null = null;
// Every thread, watched for a move, on a page with no thread stream to say.
let threadsMoved: EventSource | null = null;

// The only code that touches the network, the address bar, the clipboard,
// the clock or where the page is scrolled.
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
      // A glide to the latest goes on as what arrives renders: a jump would
      // cut it short. Once it ends, the chat is asked again.
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
      // After the page renders, as `focusHeading` waits: a folded change set
      // the link opened, or one inside it, is only there then.
      requestAnimationFrame(() => {
        const set = document.getElementById(changeSetAnchor(effect.changeSetId));
        if (!set) return;
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
        set.scrollIntoView({
          block: "start",
          behavior: effect.smooth && !still ? "smooth" : "auto",
        });
        // Readers start there too, at its heading.
        (set.querySelector<HTMLElement>(".change-set-head h2") ?? set).focus({
          preventScroll: true,
        });
      });
      return;
    case "focusComposer":
      focusComposer(10);
      return;
    case "focusFolded":
      // Once the page shows it folded, as `focusHeading` waits.
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
      // The page renders in a microtask, as `rendered` says. Where it's
      // scrolled stays.
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
        // Our own server's events, in the shape view.ts declares.
        dispatch({ type: "streamed", event: JSON.parse(message.data) as StreamEvent });
      };
      // Every open after the first is a reconnect, which replays entries but
      // not what changed meanwhile.
      let opened = false;
      events.onopen = () => {
        if (opened) dispatch({ type: "streamReopened" });
        opened = true;
      };
      return;
    }
    case "watchThreads": {
      // One the browser gave up on, after an error answer, opens again.
      if (threadsMoved && threadsMoved.readyState !== EventSource.CLOSED) return;
      threadsMoved = new EventSource("/api/threads/events");
      threadsMoved.onmessage = () => dispatch({ type: "threadsMoved" });
      // A move may have landed before the stream opened, or while it was
      // down: the server tells only what happens while it's open.
      threadsMoved.onopen = () => dispatch({ type: "threadsMoved" });
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
      // The default theme is `:root` itself, so naming it changes nothing.
      const html = document.documentElement;
      html.dataset.theme = effect.theme;
      if (effect.textSize === "default") delete html.dataset.textSize;
      else html.dataset.textSize = effect.textSize;
      return;
    }
  }
}

// The window chat's entries scroll by themselves; a thread's page scrolls
// the window (null).
const scroller = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(".window-chat-entries");

const scrolledTo = (chat: HTMLElement | null): number => (chat ? chat.scrollTop : scrollY);

// How far below what shows a chat ends, with the composer under its latest
// entry; null with no chat on screen. On a thread's page the window
// scrolls, and on a narrow screen the rail waits below the chat, so the
// page's own end is not the chat's.
function belowLatest(chat: HTMLElement | null): number | null {
  if (chat) return chat.scrollHeight - chat.clientHeight - chat.scrollTop;
  const thread = document.querySelector("main.thread");
  return thread ? thread.getBoundingClientRect().bottom - innerHeight : null;
}

// Says where a chat is as the user scrolls it, or opens a run's output in
// it, and whether they moved up, until the returned function stops it: a
// thread's page, or with `chat`, the window chat's entries. The scroll
// event for the chat's own scroll to the latest entry isn't the user's: a
// block rendering between that scroll and its event would read as them
// leaving.
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

// Browse's clusters, with no items: they load as each opens.
async function loadWindow(grouping: GroupingId, filter: BrowseFilter): Promise<WindowView> {
  const query = new URLSearchParams([["grouping", grouping], ...filterParams(filter)]);
  const response = await fetch(`/api/browse?${query}`);
  if (!response.ok) throw new Error(`GET /api/browse: ${response.status}`);
  // Our own server's reply, in the shape view.ts declares for both sides.
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

// Puts the cursor in the composer: at once, as after Reject, or once the
// page shows it, which may take a few frames, as when "Ask about this"
// opens the chat. Under an open item, the composer is the one its dock
// carries; a dock out of use (inert) is skipped, as the overview's is while
// the window chat is open.
function focusComposer(frames: number): void {
  const field =
    document.querySelector<HTMLTextAreaElement>(".panel-dock textarea") ??
    document.querySelector<HTMLTextAreaElement>(":not([inert]) > .composer textarea");
  if (field) field.focus();
  else if (frames > 0) requestAnimationFrame(() => focusComposer(frames - 1));
}
