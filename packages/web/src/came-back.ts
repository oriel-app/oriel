import { reached } from "./http.ts";
import { updatePanel } from "./panel.ts";
import type { Effect } from "./http.ts";
import type { Model } from "./root.ts";

export function cameBack(model: Model): [Model, Effect[]] {
  const { overview, chat, window, workstream, newThread, closing, ending, moving } = model;
  const { approved, rejected, panelAdds, panelEdits, settings, setup, connections } = model;
  const [panel, reading] =
    model.panel?.status === "failed" && reached(model.panel.problem) === null
      ? updatePanel(model.panel, { type: "readAgainClicked" })
      : [model.panel, []];
  const failedApply = approved.failed && reached(approved.failed.why) && approved.failed;
  const undoRefused = rejected.problem && reached(rejected.problem.said) && rejected.problem;
  return [
    {
      ...model,
      overview: overview && {
        ...overview,
        problem: reached(overview.problem),
        noticedProblem: reached(overview.noticedProblem),
        failed: reached(overview.failed),
      },
      chat: { ...chat, problem: reached(chat.problem) },
      window: window && { ...window, notice: reached(window.notice) },
      workstream: workstream && { ...workstream, notice: reached(workstream.notice) },
      newThread: newThread && { ...newThread, notice: reached(newThread.notice) },
      closing: { ...closing, problem: reached(closing.problem) },
      ending: { ...ending, problem: reached(ending.problem) },
      moving: { ...moving, problem: reached(moving.problem) },
      approved: { ...approved, failed: failedApply || null },
      rejected: { ...rejected, problem: undoRefused || null },
      panel,
      panelAdds: {
        ...panelAdds,
        adds: panelAdds.adds.map((add) => ({ ...add, problem: reached(add.problem) })),
      },
      panelEdits: {
        ...panelEdits,
        form: panelEdits.form && { ...panelEdits.form, problem: reached(panelEdits.form.problem) },
        saved: panelEdits.saved.map((edit) => ({ ...edit, problem: reached(edit.problem) })),
      },
      settings: { ...settings, problem: reached(settings.problem) },
      setup: { ...setup, problem: reached(setup.problem) },
      connections: {
        ...connections,
        problems: stillSaid(connections.problems),
        switchProblems: stillSaid(connections.switchProblems),
        forms: each(connections.forms, (form) => ({ ...form, problem: reached(form.problem) })),
        settings: each(connections.settings, (setting) => ({
          ...setting,
          problem: reached(setting.problem),
          unread: reached(setting.unread),
        })),
        edits: each(connections.edits, (editing) => ({
          ...editing,
          redrawn: { ...editing.redrawn, problem: reached(editing.redrawn.problem) },
        })),
      },
    },
    reading,
  ];
}

const each = <T>(byKey: Readonly<Record<string, T>>, back: (value: T) => T): Record<string, T> =>
  Object.fromEntries(Object.entries(byKey).map(([key, value]) => [key, back(value)]));

const stillSaid = (byKey: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(byKey).filter(([, said]) => reached(said) !== null));
