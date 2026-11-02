import type { Effect } from "./http.ts";
import type { Msg } from "./root.ts";
import { changeSetAnchor, parseRoute, routeUrl } from "./route.ts";
import type { ThreadMsg } from "./thread.ts";
import type { GroupingId, StreamEvent, WindowView } from "./view.ts";

// Where the page last scrolled itself to a thread's latest entry, until the
// scroll event that says so.
let shownAt: number | null = null;
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
      loadWindow(effect.grouping).then(
        (window) => dispatch({ type: "window", msg: { type: "windowLoaded", request, window } }),
        () => dispatch({ type: "window", msg: { type: "windowFailed", request } }),
      );
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
        .catch(() =>
          dispatch({
            type: "replied",
            tag,
            ok: false,
            body: { error: "Oriel can't be reached. Is it still running?" },
          }),
        );
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
      const below = belowLatest();
      if (below === null) return;
      const was = scrollY;
      scrollBy(0, below);
      // Another in the same frame may not move it, and has no event to skip.
      if (scrollY !== was) shownAt = scrollY;
      return;
    }
    case "showChangeSet": {
      const set = document.getElementById(changeSetAnchor(effect.changeSetId));
      if (!set) return;
      set.scrollIntoView({ block: "start" });
      // Readers start there too.
      set.focus({ preventScroll: true });
      return;
    }
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
  }
}

// How far below the window's bottom edge a thread's chat ends, with the
// composer under its latest entry; null off a thread's page. The window
// scrolls; on a narrow screen the rail waits below the chat, so the page's
// own end is not the chat's.
function belowLatest(): number | null {
  const chat = document.querySelector("main.thread");
  return chat ? chat.getBoundingClientRect().bottom - innerHeight : null;
}

// Says where a thread's page is as the user scrolls, or opens a run's output
// in the chat, and whether they moved up, until the returned function stops
// it. The scroll event for the page's own scroll to the latest entry isn't
// the user's: a block rendering between that scroll and its event would read
// as them leaving.
export function watchLatest(send: (msg: ThreadMsg) => void): () => void {
  let was = scrollY;
  const moved = (up: boolean) => {
    const below = belowLatest();
    if (below !== null) send({ type: "scrolled", below, up });
  };
  const scrolled = () => {
    const up = scrollY < was;
    const itself = scrollY === shownAt;
    was = scrollY;
    shownAt = null;
    if (!itself) moved(up);
  };
  // A details element's toggle doesn't bubble.
  const toggled = ({ target }: Event) => {
    if (target instanceof HTMLDetailsElement && target.open && target.closest(".chat")) moved(true);
  };
  addEventListener("scroll", scrolled, { passive: true });
  addEventListener("toggle", toggled, true);
  return () => {
    removeEventListener("scroll", scrolled);
    removeEventListener("toggle", toggled, true);
  };
}

async function loadWindow(grouping: GroupingId): Promise<WindowView> {
  const response = await fetch(`/api/window?grouping=${grouping}`);
  if (!response.ok) throw new Error(`GET /api/window: ${response.status}`);
  // Our own server's reply, in the shape view.ts declares for both sides.
  return (await response.json()) as WindowView;
}
