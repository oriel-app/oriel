import type { Effect } from "./http.ts";
import type { Msg } from "./root.ts";
import { parseRoute, routeUrl } from "./route.ts";
import type { GroupingId, StreamEvent, WindowView } from "./view.ts";

// The thread being watched, one at a time.
let events: EventSource | null = null;

// The only code that touches the network, the address bar or the clipboard.
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
      if (`${location.pathname}${location.search}` !== url) history.pushState(null, "", url);
      dispatch({ type: "routed", route: parseRoute(location.pathname, location.search) });
      scrollTo(0, 0);
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
    case "unsubscribe":
      events?.close();
      events = null;
      return;
    case "copy":
      navigator.clipboard?.writeText(effect.text).catch(() => {});
      return;
  }
}

async function loadWindow(grouping: GroupingId): Promise<WindowView> {
  const response = await fetch(`/api/window?grouping=${grouping}`);
  if (!response.ok) throw new Error(`GET /api/window: ${response.status}`);
  // Our own server's reply, in the shape view.ts declares for both sides.
  return (await response.json()) as WindowView;
}
