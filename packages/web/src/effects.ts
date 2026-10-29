import type { Effect, Msg } from "./update.ts";
import type { GroupingId, WindowView } from "./view.ts";

// The only code that touches the network or the address bar.
export function perform(effect: Effect, dispatch: (msg: Msg) => void): void {
  switch (effect.type) {
    case "loadWindow": {
      const { request } = effect;
      loadWindow(effect.grouping).then(
        (window) => dispatch({ type: "windowLoaded", request, window }),
        () => dispatch({ type: "windowFailed", request }),
      );
      return;
    }
    case "showGrouping": {
      const url = new URL(location.href);
      url.searchParams.set("grouping", effect.grouping);
      history.replaceState(null, "", url);
      return;
    }
  }
}

async function loadWindow(grouping: GroupingId): Promise<WindowView> {
  const response = await fetch(`/api/window?grouping=${grouping}`);
  if (!response.ok) throw new Error(`GET /api/window: ${response.status}`);
  // Our own server's reply, in the shape view.ts declares for both sides.
  return (await response.json()) as WindowView;
}
