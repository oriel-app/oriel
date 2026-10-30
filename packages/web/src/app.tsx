import { useEffect } from "preact/hooks";
import { GroupPage } from "./group-page.tsx";
import { parseRoute } from "./route.ts";
import { InboxPage, ReviewPage } from "./other-pages.tsx";
import { type Dispatch, Link, Mark } from "./parts.tsx";
import type { Program } from "./program.ts";
import type { Effect } from "./http.ts";
import type { Model, Msg } from "./root.ts";
import { ThreadPage } from "./thread-page.tsx";
import { useProgram } from "./use-program.ts";
import { WindowPage } from "./window-page.tsx";

export function App({ program }: { program: Program<Model, Msg, Effect> }) {
  const [model, dispatch] = useProgram(program);
  // Back and forward re-route the app from the address bar.
  useEffect(() => {
    const routed = () =>
      dispatch({ type: "routed", route: parseRoute(location.pathname, location.search) });
    addEventListener("popstate", routed);
    return () => removeEventListener("popstate", routed);
  }, []);
  // A review link stands alone: no window, no threads, no navigation.
  if (model.route.page === "review")
    return model.review && <ReviewPage model={model.review} dispatch={dispatch} />;
  return (
    <>
      <Bar model={model} dispatch={dispatch} />
      <Page model={model} dispatch={dispatch} />
    </>
  );
}

function Page({ model, dispatch }: { model: Model; dispatch: Dispatch }) {
  switch (model.route.page) {
    case "window":
      return (
        model.window && (
          <WindowPage
            model={model.window}
            groups={model.groups}
            folder={model.folder}
            dispatch={dispatch}
          />
        )
      );
    case "group":
      return model.group && <GroupPage model={model.group} dispatch={dispatch} />;
    case "thread":
      return model.thread && <ThreadPage model={model.thread} dispatch={dispatch} />;
    case "inbox":
      return <InboxPage threads={model.threads} dispatch={dispatch} />;
    case "review":
      return null;
  }
}

// The chrome: the brand, which goes to the window, and the inbox. Quiet
// until something is working.
function Bar({ model, dispatch }: { model: Model; dispatch: Dispatch }) {
  const working = model.threads?.filter((thread) => thread.state === "working").length ?? 0;
  const page = model.route.page;
  return (
    <header class="bar">
      <div class="bar-inner">
        <Link
          route={{ page: "window", grouping: model.window?.grouping ?? "epic", addTo: null }}
          dispatch={dispatch}
          class="brand"
          aria-current={page === "window" ? "page" : undefined}
        >
          <Mark />
          Oriel
        </Link>
        <nav class="bar-nav" aria-label="Pages">
          <Link
            route={{ page: "inbox" }}
            dispatch={dispatch}
            class="bar-link"
            aria-current={page === "inbox" ? "page" : undefined}
          >
            Inbox
            {working > 0 && (
              <span class="badge" title={`${working} working`}>
                {working}
              </span>
            )}
          </Link>
        </nav>
      </div>
    </header>
  );
}
