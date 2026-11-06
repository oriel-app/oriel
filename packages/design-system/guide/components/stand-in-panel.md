---
title: Stand-in panel
status: stable
group: Surfaces
order: 61
classes: panel-edit, panel-edit-field, panel-edit-label, panel-edit-input, panel-edit-text, panel-edit-actions
summary: The item panel of a stand-in's issue, which a person edits in place, applied at once with an Undo; and the stand-in's row in the first run, in place of connecting a tracker.
---

# Stand-in panel

## What it is

Oriel keeps a small tracker of its own, the **stand-in**, while no other tracker is connected (decision 0059). Its epics and stories are Oriel's own, in its database, so a person can change one directly. Its [item panel](/components/item-panel) has an **Edit** button among its actions, and Edit turns the panel's body into a form of the issue's fields. **Save** applies the edit at once, through Oriel's `item.edit` action, and its Undo is a note in the window's [bead](/components/bead), as an add from the panel is (`EditFields` in `packages/web/src/item-panel.tsx`, `updateEdits` in `packages/web/src/panel-edits.ts`).

The form comes from the source, never from the page. The stand-in's read gives a `PanelEdit`, its fields each with a kind (`trackerEdit` in `packages/tracker/src/edit.ts`), and the page draws whatever form it is given. The page names no source.

The agent never edits through it. Its changes to the stand-in are change sets, the same as any other source's.

```html specimen id=form title="Editing a story: Save applies it at once" width=420
<aside class="item-panel" aria-labelledby="stand-in-title">
  <header class="panel-head">
    <p class="panel-source">Tracker · T-2</p>
    <button type="button" class="panel-close" aria-label="Close the panel">×</button>
    <h2 id="stand-in-title" class="panel-title">Pricing page</h2>
  </header>
  <form class="panel-edit" aria-label="Edit T-2">
    <div class="panel-edit-field">
      <label class="panel-edit-label" for="f-summary">Summary</label>
      <input id="f-summary" class="panel-edit-input" type="text" value="Pricing page" />
    </div>
    <div class="panel-edit-field">
      <label class="panel-edit-label" for="f-status">Status</label>
      <select id="f-status" class="panel-edit-input">
        <option>To do</option>
        <option selected>In progress</option>
        <option>Done</option>
      </select>
    </div>
    <div class="panel-edit-field">
      <label class="panel-edit-label" for="f-assignee">Assignee</label>
      <input
        id="f-assignee"
        class="panel-edit-input"
        type="text"
        placeholder="Unassigned"
        value="Ada Quill"
      />
    </div>
    <div class="panel-edit-field">
      <label class="panel-edit-label" for="f-points">Estimate</label>
      <input
        id="f-points"
        class="panel-edit-input"
        type="text"
        inputmode="decimal"
        placeholder="Not estimated yet"
        value="3"
      />
    </div>
    <div class="panel-edit-field">
      <label class="panel-edit-label" for="f-labels">Labels</label>
      <input
        id="f-labels"
        class="panel-edit-input"
        type="text"
        placeholder="Separate them with commas"
        value="web"
      />
    </div>
    <div class="panel-edit-field">
      <label class="panel-edit-label" for="f-description">Description</label>
      <textarea id="f-description" class="panel-edit-input panel-edit-text" rows="6">
Three tiers, with the yearly discount.</textarea>
    </div>
    <div class="panel-edit-actions">
      <button type="submit" class="button primary">Save</button>
      <button type="button" class="button">Cancel</button>
    </div>
  </form>
</aside>
```

## When to use it

- Only for an item whose read gives a form, which today is a stand-in's. `editable` in `packages/web/src/item-panel.tsx` decides from the read alone.

## When not to

- Not for any other source's item. A Jira issue, a file, a message or a row changes through a change set that a person approves. Its panel only reads.
- Not for the agent's writes. The agent drafts changes to the stand-in as change sets, which the person approves.
- Not as a dialog. It takes the place of the panel's body, which comes back once the form is saved or cancelled.

## Anatomy and variants

1. **The panel's head**, as on every [item panel](/components/item-panel), with **Edit** (a `.button`) among its actions while the form is closed.
2. **The form** (`form.panel-edit`). One `.panel-edit-field` per field, each a `.panel-edit-label` over its control, in the order the source gives:
   - a line (`input.panel-edit-input`): the summary;
   - a choice (`select.panel-edit-input`): the status, from its workflow's names;
   - a person (`input`): a name, with the empty value's words, "Unassigned", as its placeholder;
   - a number (`input`, `inputmode="decimal"`): the estimate, with "Not estimated yet" as its placeholder. An epic takes no estimate, so its form has no Estimate field;
   - a list (`input`): the labels, separated by commas;
   - text (`textarea.panel-edit-input.panel-edit-text`): the description.
3. **Actions** (`.panel-edit-actions`): **Save** (`.button.primary`) and **Cancel**.

## States

- **Saving**: every control is disabled, and Save reads "Saving…".
- **Refused**: why, in a `.panel-problem` line above the actions. The form stays open with what was typed, as for an estimate that isn't a number ("Estimate must be a number.") or a status the workflow doesn't have.
- **Saved**: the form closes, the panel reads the item again, and the bead says "Edited T-2." with Undo. That Undo sets back only the fields that changed. A save that changed nothing just closes the form.

```html specimen id=refused title="Refused: the form stays open and says why" width=420 state=refused
<form class="panel-edit" aria-label="Edit T-2">
  <div class="panel-edit-field">
    <label class="panel-edit-label" for="r-points">Estimate</label>
    <input id="r-points" class="panel-edit-input" type="text" value="three" />
  </div>
  <p class="panel-problem" role="alert">Estimate must be a number.</p>
  <div class="panel-edit-actions">
    <button type="submit" class="button primary">Save</button>
    <button type="button" class="button">Cancel</button>
  </div>
</form>
```

## Keyboard and ARIA

- The form's label is "Edit T-2", the item's key as the panel names it. Each control has its own `<label for>`.
- Enter in a line saves, as a form's submit does. Escape still closes the panel. Nothing in the form binds F8, which the bead keeps for the whole window.

## Content

- Field labels are the source's: "Summary", "Status", "Assignee", "Estimate", "Labels", "Description".
- The bead's note is "Edited {key}." Its words never quote a field's value.

## Where the app uses it

- The item panel of a stand-in's issue, on any page (`ItemPanel` in `packages/web/src/item-panel.tsx`).
- **The first run.** While the stand-in is on, it takes the place of what it stands in for (`standingIn` in `packages/web/src/connections.ts`). The Your work step has no Jira row and no field asking for a token. The stand-in shows as a row that is ready already (`YourWork` in `packages/web/src/setup-page.tsx`), so Continue goes straight on. The overview offers no Jira card (`ConnectCards` in `packages/web/src/connect-steps.tsx`), and while the window holds nothing yet, its one question to start from is a plan (`questionsFrom` in `packages/web/src/window-chat.ts`).

```html specimen id=first-run title="The first run's Your work, with the stand-in on" width=640
<ul class="provider-rows setup-rows">
  <li class="provider-row">
    <span class="provider-icon" aria-hidden="true">T</span>
    <div class="provider-main">
      <span class="provider-name">Epics and stories</span>
      <span class="provider-about">Oriel keeps them for you until you connect a tracker</span>
      <span class="provider-status" data-connected
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Ready</span><span>· Kept on this Mac, in Oriel</span></span
      >
    </div>
  </li>
  <li class="provider-row">
    <span class="provider-icon" aria-hidden="true">F</span>
    <div class="provider-main">
      <span class="provider-name">A folder</span>
      <span class="provider-about"
        >Notes saved as files on this Mac, and its folders. Oriel only reads them.</span
      >
    </div>
    <button type="button" class="button">Connect</button>
  </li>
</ul>
```
