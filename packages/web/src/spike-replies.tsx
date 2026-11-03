// Spike (reply-elements): one exchange from the evals, drawn as a thread
// page draws it, under one candidate set of reply elements, for screenshots.
// `?scene=<case>&arm=<today|r0|r1|r2>`. Its data is fixture data only.
import { render } from "preact";
import type { Workspace } from "./chip.ts";
import {
  ItemLinksContext,
  Markdown,
  type RefView,
  RefsContext,
  WorkspaceContext,
} from "./parts.tsx";

type Scene = { id: string; user: string; replies: Partial<Record<string, string>> };
type Data = { scenes: Scene[]; refs: Record<string, RefView>; workspace: Workspace };

const params = new URLSearchParams(location.search);
const data = (await (await fetch("/spike/data.json")).json()) as Data;
const scene = data.scenes.find((each) => each.id === params.get("scene"));
const arm = params.get("arm") ?? "today";
const text = scene?.replies[arm] ?? "(no reply for this arm)";
const root = document.getElementById("app");
if (root === null) throw new Error("no #app");

render(
  <ItemLinksContext.Provider value={{ dispatch: () => {}, items: new Map() }}>
    <WorkspaceContext.Provider value={data.workspace}>
      <RefsContext.Provider value={(id) => data.refs[id] ?? null}>
        <div class="spike-frame">
          <ol class="chat">
            <li class="user-message">{scene?.user}</li>
            <li class="reply">
              <Markdown text={text} linksTo="any" />
            </li>
          </ol>
        </div>
      </RefsContext.Provider>
    </WorkspaceContext.Provider>
  </ItemLinksContext.Provider>,
  root,
);
document.body.dataset["ready"] = "";
