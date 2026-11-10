// A review link's page: no thread, no window. Nothing is opened until the
// person asks, with a POST, since chat apps fetch links to preview them.
import { type Effect, errorOf, post, type Replied } from "./http.ts";
import type { ChangeSetView, NextStepView, ReviewView } from "./view.ts";

export type ReviewModel = {
  token: string;
  stage: "closed" | "opening" | "open" | "deciding" | "decided" | "dead";
  view: ReviewView | null;
  name: string;
  // The step the reviewer picked as their answer, before they send it.
  answer: ReviewStep | null;
  // What's wrong with it, to go with rejecting it: held in the thread for
  // whoever shared the link.
  reason: string;
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
  | { type: "answerPicked"; answer: ReviewStep }
  | { type: "reasonChanged"; reason: string }
  // The one button, which does what the answer says.
  | { type: "submitClicked" }
  | { type: "decideClicked"; kind: "approved" | "rejected" }
  | { type: "dismissClicked" };

// What the reviewer's form shows, in its order, under the change: their
// answer, the note only once they pick Reject, their name, and the one
// button, once there's an answer for it to send. With one step offered,
// that's the answer, and there's nothing to pick.
export type ReviewPart = "answer" | "note" | "name" | "submit";

// The reviewer's answer: the one they picked, or the only one offered.
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
      answer: null,
      reason: "",
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
      // Only what the change set engine offers is sent.
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
    // Refused, as when the change changed after the page showed it (OA-309):
    // the page shows it as it is now, with why.
    if (!msg.ok)
      return [
        { ...model, stage: "open", outcome: null, problem: errorOf(msg.body) },
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
