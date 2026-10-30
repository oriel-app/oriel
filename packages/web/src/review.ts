// A review link's page: no thread, no window. Nothing is opened until the
// person asks, with a POST, since chat apps fetch links to preview them.
import { type Effect, errorOf, post, type Replied } from "./http.ts";
import type { ChangeSetView, NextStepView, ReviewView } from "./view.ts";

export type ReviewModel = {
  token: string;
  stage: "closed" | "opening" | "open" | "deciding" | "decided" | "dead";
  view: ReviewView | null;
  name: string;
  decided: ChangeSetView | null;
  // What the reviewer did, once decided; and, for a dismissal, what it said
  // may have landed.
  outcome: "approved" | "rejected" | "dismissed" | null;
  warnings: readonly string[];
  problem: string | null;
};

// The steps a review link can take: deciding, and dismissing what is left.
// The rest (retry, remove, revert) belong to the thread.
export type ReviewStep = Extract<
  NextStepView["kind"],
  "approve" | "approve-rest" | "reject" | "dismiss"
>;

export type ReviewMsg =
  | { type: "openClicked" }
  | { type: "nameChanged"; name: string }
  | { type: "decideClicked"; kind: "approved" | "rejected" }
  | { type: "dismissClicked" };

// What the change set engine offers that a review link can do, in its order.
export const reviewSteps = (view: ReviewView): ReviewStep[] =>
  view.changeSet.nextSteps.flatMap((step) =>
    step.kind === "approve" ||
    step.kind === "approve-rest" ||
    step.kind === "reject" ||
    step.kind === "dismiss"
      ? [step.kind]
      : [],
  );

export function initReview(token: string): [ReviewModel, Effect[]] {
  return [
    {
      token,
      stage: "closed",
      view: null,
      name: "",
      decided: null,
      outcome: null,
      warnings: [],
      problem: null,
    },
    [],
  ];
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
    case "decideClicked":
    case "dismissClicked": {
      const name = model.name.trim();
      const { view } = model;
      const outcome = msg.type === "dismissClicked" ? "dismissed" : msg.kind;
      const offered: Record<typeof outcome, ReviewStep[]> = {
        approved: ["approve", "approve-rest"],
        rejected: ["reject"],
        dismissed: ["dismiss"],
      };
      // Only what the change set engine offers is sent.
      if (
        model.stage !== "open" ||
        view === null ||
        !reviewSteps(view).some((step) => offered[outcome].includes(step))
      )
        return [model, []];
      if (name === "") return [{ ...model, problem: "Type your name first." }, []];
      const changeSet = view.changeSet.id;
      const request =
        outcome === "dismissed"
          ? post(
              "/api/review/dismiss",
              { token: model.token, changeSet, name },
              { kind: "reviewDecided" },
            )
          : post(
              "/api/review/decide",
              { token: model.token, changeSet, kind: outcome, name, hash: view.diff.hash },
              { kind: "reviewDecided" },
            );
      return [{ ...model, stage: "deciding", outcome, problem: null }, [request]];
    }
  }
}

export function reviewReplied(model: ReviewModel, msg: Replied): [ReviewModel, Effect[]] {
  if (msg.tag.kind === "reviewOpened") {
    if (!msg.ok) return [{ ...model, stage: "dead", problem: errorOf(msg.body) }, []];
    return [{ ...model, stage: "open", view: msg.body as ReviewView }, []];
  }
  if (msg.tag.kind === "reviewDecided") {
    if (!msg.ok)
      return [{ ...model, stage: "open", outcome: null, problem: errorOf(msg.body) }, []];
    // A decision can stand while applying it didn't: the reply says why.
    const { changeSet, problem, warnings } = msg.body as {
      changeSet: ChangeSetView;
      problem?: string | null;
      warnings?: string[];
    };
    return [
      {
        ...model,
        stage: "decided",
        decided: changeSet,
        warnings: warnings ?? [],
        problem: problem ?? null,
      },
      [],
    ];
  }
  return [model, []];
}
