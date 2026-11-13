// Nothing is opened until the person asks, with a POST, since chat apps fetch links to preview
// them.
import { type Effect, errorOf, post, type Replied } from "./http.ts";
import type { ChangeSetView, NextStepView, ReviewView } from "./view.ts";

export type ReviewModel = {
  token: string;
  stage: "closed" | "opening" | "open" | "deciding" | "decided" | "dead";
  view: ReviewView | null;
  name: string;
  answer: ReviewStep | null;
  reason: string;
  decided: ChangeSetView | null;
  outcome: "approved" | "rejected" | "dismissed" | null;
  warnings: readonly string[];
  problem: string | null;
  reviewed: { hash: string; revisedAt: string | null } | null;
  altered: { at: string | null } | null;
};

export type ReviewStep = Extract<
  NextStepView["kind"],
  "approve" | "approve-rest" | "reject" | "dismiss"
>;

export type ReviewMsg =
  | { type: "openClicked" }
  | { type: "nameChanged"; name: string }
  | { type: "answerPicked"; answer: ReviewStep }
  | { type: "reasonChanged"; reason: string }
  | { type: "submitClicked" }
  | { type: "decideClicked"; kind: "approved" | "rejected" }
  | { type: "dismissClicked" };

export type ReviewPart = "answer" | "note" | "name" | "submit";

export function answerOf(model: ReviewModel): ReviewStep | null {
  const steps = model.view ? reviewSteps(model.view) : [];
  if (model.answer !== null && steps.includes(model.answer)) return model.answer;
  return steps.length === 1 ? (steps[0] ?? null) : null;
}

export function reviewParts(model: ReviewModel): ReviewPart[] {
  const steps = model.view ? reviewSteps(model.view) : [];
  if (steps.length === 0) return [];
  const answer = answerOf(model);
  const noting = answer === "reject" && model.view?.changeSet.revertOf === null;
  return [
    ...(steps.length > 1 ? (["answer"] as const) : []),
    ...(noting ? (["note"] as const) : []),
    "name",
    ...(answer ? (["submit"] as const) : []),
  ];
}

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
      answer: null,
      reason: "",
      decided: null,
      outcome: null,
      warnings: [],
      problem: null,
      reviewed: null,
      altered: null,
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
    case "answerPicked":
      return [{ ...model, answer: msg.answer, problem: null }, []];
    case "reasonChanged":
      return [{ ...model, reason: msg.reason }, []];
    case "submitClicked": {
      const answer = answerOf(model);
      if (answer === null) return [{ ...model, problem: "Pick your answer first." }, []];
      return updateReview(
        model,
        answer === "dismiss"
          ? { type: "dismissClicked" }
          : { type: "decideClicked", kind: answer === "reject" ? "rejected" : "approved" },
      );
    }
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
      if (
        model.stage !== "open" ||
        view === null ||
        !reviewSteps(view).some((step) => offered[outcome].includes(step))
      )
        return [model, []];
      if (name === "") return [{ ...model, problem: "Type your name first." }, []];
      const changeSet = view.changeSet.id;
      const reason = outcome === "rejected" ? model.reason.trim() : "";
      const request =
        outcome === "dismissed"
          ? post(
              "/api/review/dismiss",
              { token: model.token, changeSet, name, hash: view.diff.hash },
              { kind: "reviewDecided" },
            )
          : post(
              "/api/review/decide",
              {
                token: model.token,
                changeSet,
                kind: outcome,
                name,
                hash: view.diff.hash,
                ...(reason ? { reason } : {}),
              },
              { kind: "reviewDecided" },
            );
      return [{ ...model, stage: "deciding", outcome, problem: null, altered: null }, [request]];
    }
  }
}

export function reviewReplied(model: ReviewModel, msg: Replied): [ReviewModel, Effect[]] {
  if (msg.tag.kind === "reviewOpened") {
    if (!msg.ok) return [{ ...model, stage: "dead", problem: errorOf(msg.body) }, []];
    const view = msg.body as ReviewView;
    const { reviewed } = model;
    if (reviewed && view.diff.hash !== reviewed.hash) {
      const { revisedAt } = view.changeSet;
      return [
        {
          ...model,
          stage: "open",
          view,
          reviewed: null,
          problem: null,
          altered: { at: revisedAt !== reviewed.revisedAt ? revisedAt : null },
        },
        [],
      ];
    }
    return [{ ...model, stage: "open", view, reviewed: null }, []];
  }
  if (msg.tag.kind === "reviewDecided") {
    if (!msg.ok)
      return [
        {
          ...model,
          stage: "open",
          outcome: null,
          problem: errorOf(msg.body),
          reviewed: model.view && {
            hash: model.view.diff.hash,
            revisedAt: model.view.changeSet.revisedAt,
          },
        },
        [post("/api/review/open", { token: model.token }, { kind: "reviewOpened" })],
      ];
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
