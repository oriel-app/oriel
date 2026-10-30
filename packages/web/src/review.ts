// A review link's page: no thread, no window. Nothing is opened until the
// person asks, with a POST, since chat apps fetch links to preview them.
import { type Effect, errorOf, post, type Replied } from "./http.ts";
import type { ChangeSetView, ReviewView } from "./view.ts";

export type ReviewModel = {
  token: string;
  stage: "closed" | "opening" | "open" | "deciding" | "decided" | "dead";
  view: ReviewView | null;
  name: string;
  decided: ChangeSetView | null;
  problem: string | null;
};

export type ReviewMsg =
  | { type: "openClicked" }
  | { type: "nameChanged"; name: string }
  | { type: "decideClicked"; kind: "approved" | "rejected" };

export function initReview(token: string): [ReviewModel, Effect[]] {
  return [{ token, stage: "closed", view: null, name: "", decided: null, problem: null }, []];
}

export function updateReview(model: ReviewModel, msg: ReviewMsg): [ReviewModel, Effect[]] {
  switch (msg.type) {
    case "openClicked":
      if (model.stage !== "closed") return [model, []];
      return [
        { ...model, stage: "opening", problem: null },
        [post("/api/review/open", { token: model.token }, { kind: "reviewOpened" })],
      ];
    case "nameChanged":
      return [{ ...model, name: msg.name }, []];
    case "decideClicked": {
      const name = model.name.trim();
      if (model.stage !== "open" || model.view === null) return [model, []];
      if (name === "") return [{ ...model, problem: "Type your name first." }, []];
      return [
        { ...model, stage: "deciding", problem: null },
        [
          post(
            "/api/review/decide",
            {
              token: model.token,
              changeSet: model.view.changeSet.id,
              kind: msg.kind,
              name,
              hash: model.view.diff.hash,
            },
            { kind: "reviewDecided" },
          ),
        ],
      ];
    }
  }
}

export function reviewReplied(model: ReviewModel, msg: Replied): [ReviewModel, Effect[]] {
  if (msg.tag.kind === "reviewOpened") {
    if (!msg.ok) return [{ ...model, stage: "dead", problem: errorOf(msg.body) }, []];
    return [{ ...model, stage: "open", view: msg.body as ReviewView }, []];
  }
  if (msg.tag.kind === "reviewDecided") {
    if (!msg.ok) return [{ ...model, stage: "open", problem: errorOf(msg.body) }, []];
    const { changeSet } = msg.body as { changeSet: ChangeSetView };
    return [{ ...model, stage: "decided", decided: changeSet }, []];
  }
  return [model, []];
}
