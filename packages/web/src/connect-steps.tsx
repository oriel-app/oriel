// A connector's steps, drawn from its declaration the same way wherever a
// connection is made: the first run and Settings' Add a connection
// (decision 0049), which since decision 0059 are only for what's on this
// Mac. Each
// step kind is drawn here once, in its connector's words: a folder step's
// path, from the folder picker or by its typed path; and the options Oriel or
// the agent drafts, drawn from the source, to apply or edit, which Settings
// draws with a connection's mapping. And what the window says of a
// connection that read nothing.
import type { ComponentChildren } from "preact";
import { ReviewTables } from "./block.tsx";
import {
  appliesEdited,
  type ConnectForm,
  type ConnectionsModel,
  type ConnectionsMsg,
  emptyConnections,
  type FolderKind,
  folderStep,
  formOf,
  openConnections,
  type ReviewEditing,
  stepOf,
} from "./connections.ts";
import type { Connectors } from "./connectors.ts";
import type { Dispatch } from "./parts.tsx";
import type {
  ConnectorView,
  ConnectStep,
  OptionsReviewView,
  ReviewEdit,
  ReviewField,
  ReviewTable,
} from "./view.ts";

type Step<K extends ConnectStep["kind"]> = Extract<ConnectStep, { kind: K }>;

type StepProps<K extends ConnectStep["kind"]> = {
  connector: ConnectorView;
  step: Step<K>;
  form: ConnectForm;
  send(msg: ConnectionsMsg): void;
  // What sits beside the step's button, such as Back.
  actions?: ComponentChildren;
};

// A review step (decision 0051): the connection's options as the agent
// drafted them, or Oriel's guess until then, or with no AI; each drawn from
// the source by Oriel, for the person to apply, or to edit and apply
// (OA-232). It says whose it is, and, before Apply, what applying does to
// the items the connection has. The same step shows wherever a connection
// is made, and in Settings, where `beside` names the option it sets, and
// where it edits one table by hand, as it reads now.
export function ReviewStep(props: {
  connector: ConnectorView;
  step: Step<"review">;
  connection: string;
  review: OptionsReviewView | null;
  editing: ReviewEditing | null;
  pending: boolean;
  problem: string | null;
  send(msg: ConnectionsMsg): void;
  beside?: string;
  actions?: ComponentChildren;
}) {
  const { connector, step, connection, review, editing, send } = props;
  const { kind } = connector;
  const shown = review?.draft ?? review?.guess ?? review?.current ?? null;
  const problem = editing?.redrawn.problem ?? props.problem;
  const again = (
    <button
      type="button"
      class="button"
      onClick={() => send({ type: "reviewAsked", kind, connection, fresh: true })}
    >
      Try again
    </button>
  );
  if (!review || (!shown && review.drafting))
    return problem && !review ? (
      <div class="connect-review">
        <p class="connect-problem" role="alert">
          {problem}
        </p>
        <div class="connect-actions">{again}</div>
      </div>
    ) : (
      <p class="cli-line cli-waiting" role="status">
        <span class="spinner" aria-hidden="true" />
        {step.reading}
      </p>
    );
  const whose = editing
    ? "Your draft."
    : review.draft
      ? "Oriel's draft."
      : review.drafting
        ? "A first guess. Oriel is drafting."
        : review.guess
          ? "Oriel's first guess. Check the columns below."
          : "How Oriel reads it now.";
  const drawn = editing?.redrawn.tables ?? shown?.tables ?? [];
  const tables = editing?.only ? drawn.filter((table) => table.at === editing.only) : drawn;
  const said = editing?.redrawn.said ?? review.draft?.said ?? review.guess?.said ?? [];
  const apply = () =>
    send({
      type: "reviewApplied",
      kind,
      connection,
      ...(props.beside ? { beside: props.beside } : {}),
    });
  return (
    <div class="connect-review" role="group" aria-label={step.label}>
      <p class="connect-note">
        <strong>{whose}</strong>{" "}
        {editing ? "Nothing changes until you apply." : review.current ? "" : step.lede}
      </p>
      {shown ? (
        <ReviewTables
          tables={tables}
          controls={
            editing &&
            ((table) => (
              <TableControls
                table={table}
                fields={review.fields}
                disabled={editing.pending || props.pending}
                onEdit={(edit) => send({ type: "reviewEdited", connection, edit })}
              />
            ))
          }
        />
      ) : (
        <p class="connect-none">
          Oriel couldn't guess: no column has a different value in every row. Add one, such as an
          ID, in the sheet, then try again.
        </p>
      )}
      {said.map((line) => (
        <p key={line} class="connect-said">
          {line}
        </p>
      ))}
      {problem && (
        <p class="connect-problem" role="alert">
          {problem}
        </p>
      )}
      <div class="connect-actions">
        {props.actions}
        {editing ? (
          <>
            <button
              type="button"
              class="quiet-action"
              disabled={props.pending}
              onClick={() => send({ type: "reviewEditCancelled", connection })}
            >
              Cancel
            </button>
            <button
              type="button"
              class="button primary"
              disabled={props.pending || !appliesEdited(editing)}
              onClick={apply}
            >
              {props.pending ? "Reading…" : "Apply"}
            </button>
          </>
        ) : !shown ? (
          again
        ) : (
          <>
            <button
              type="button"
              class="button"
              disabled={props.pending}
              onClick={() => send({ type: "reviewEditClicked", connection })}
            >
              Edit
            </button>
            <button type="button" class="button primary" disabled={props.pending} onClick={apply}>
              {props.pending ? "Reading…" : "Apply"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Where a table ends, in the review step's words.
const ends = [
  { value: "blank", label: "At its first blank row" },
  { value: "grid", label: "At the end of the sheet, skipping blank rows" },
] as const;

// What the person changes of one table in a review step (OA-232): whether
// it's read; each field's column, by its letter and the header the sheet
// has there; its header row; where it ends; and whether rows hidden by hand
// are read. Each change is drawn again from the source by the server.
function TableControls(props: {
  table: ReviewTable;
  fields: readonly ReviewField[];
  disabled: boolean;
  onEdit(edit: ReviewEdit): void;
}) {
  const { table, fields, disabled, onEdit } = props;
  const { at, reads } = table;
  if (at === null) return null;
  return (
    <div class="review-controls" role="group" aria-label={`How Oriel reads ${table.name}`}>
      <label class="choice">
        <input
          type="checkbox"
          checked={reads !== null}
          disabled={disabled}
          onChange={(event) => onEdit({ table: at, read: event.currentTarget.checked })}
        />
        Read this tab
      </label>
      {reads && (
        <div class="review-fields">
          {fields.map((field) => (
            <label key={field.name} class="review-field">
              <span>{field.label}</span>
              <select
                class="select"
                value={reads.fields[field.name] ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  onEdit({
                    table: at,
                    field: field.name,
                    column: event.currentTarget.value || null,
                  })
                }
              >
                {!field.required && <option value="">None</option>}
                {table.columns.map((column) => (
                  <option key={column.at} value={column.at}>
                    {column.header ? `${column.at} · ${column.header}` : column.at}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label class="review-field">
            <span>Header row</span>
            <input
              class="input"
              type="number"
              min={1}
              value={reads.header}
              disabled={disabled}
              onChange={(event) => {
                const header = Number(event.currentTarget.value);
                if (Number.isInteger(header) && header >= 1) onEdit({ table: at, header });
              }}
            />
          </label>
          <label class="review-field">
            <span>Stop reading</span>
            <select
              class="select"
              value={reads.end}
              disabled={disabled}
              onChange={(event) =>
                onEdit({ table: at, end: event.currentTarget.value === "grid" ? "grid" : "blank" })
              }
            >
              {ends.map((end) => (
                <option key={end.value} value={end.value}>
                  {end.label}
                </option>
              ))}
            </select>
          </label>
          <label class="choice">
            <input
              type="checkbox"
              checked={reads.hidden}
              disabled={disabled}
              onChange={(event) => onEdit({ table: at, hidden: event.currentTarget.checked })}
            />
            Read rows hidden by hand
          </label>
        </div>
      )}
    </div>
  );
}

// A folder step: the system's folder picker on the desktop app, or a path typed under
// `pnpm dev`, which has none. One that takes the place of the connector's
// connection says so.
export function FolderStep(
  props: StepProps<FolderKind> & { picker: boolean; replaces: string | null; onCancel(): void },
) {
  const { connector, step, form, send } = props;
  const { kind } = connector;
  const instead = props.replaces && ` It takes the place of ${props.replaces}.`;
  if (props.picker)
    return (
      <div class="path-form">
        <span class="path-actions">
          <button
            type="button"
            class="button primary"
            disabled={form.pending !== null}
            onClick={() => send({ type: "chooseClicked", kind })}
          >
            {form.pending ? "Choosing…" : `${step.choose}…`}
          </button>
          <button type="button" class="quiet-action" onClick={props.onCancel}>
            Cancel
          </button>
        </span>
        <span class="path-note">
          {step.what} {step.note}
          {instead}
        </span>
        {form.problem && (
          <p class="connect-problem" role="alert">
            {form.problem}
          </p>
        )}
      </div>
    );
  const typed = form.typed[step.field] ?? "";
  return (
    <form
      class="path-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed.trim() === "") return;
        send({ type: "nextClicked", kind, steps: connector.connect?.steps ?? [] });
      }}
    >
      <label class="path-label">
        {step.label}
        <input
          value={typed}
          placeholder={step.placeholder}
          spellcheck={false}
          autoComplete="off"
          onInput={(event) =>
            send({
              type: "fieldChanged",
              kind,
              field: step.field,
              value: event.currentTarget.value,
            })
          }
        />
      </label>
      <span class="path-actions">
        <button
          type="submit"
          class="button primary"
          disabled={form.pending !== null || typed.trim() === ""}
        >
          {form.pending ? "Reading…" : "Add"}
        </button>
        <button type="button" class="quiet-action" onClick={props.onCancel}>
          Cancel
        </button>
      </span>
      <span class="path-note">
        {step.note}
        {instead}
      </span>
      {form.problem && (
        <p class="connect-problem" role="alert">
          {form.problem}
        </p>
      )}
    </form>
  );
}

// A connector's steps, at the one the person is on, which is a folder step
// since decision 0059: a review step is declared on its connector and drawn
// with a connection's mapping in Settings, never among its connect steps.
// `onCancel` leaves them.
export function ConnectSteps(props: {
  connector: ConnectorView;
  connections: ConnectionsModel;
  dispatch: Dispatch;
  onCancel(): void;
}) {
  const { connector, connections, dispatch } = props;
  const send = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const steps = connector.connect?.steps ?? [];
  const form = formOf(connections, connector.kind);
  const step = stepOf(steps, form);
  if (step?.kind !== folderStep) return null;
  const current = openConnections(connections).find((each) => each.kind === connector.kind);
  return (
    <FolderStep
      connector={connector}
      step={step}
      form={form}
      send={send}
      picker={connections.view?.picker ?? false}
      replaces={current?.reads ?? null}
      onCancel={props.onCancel}
    />
  );
}

// A connection that read nothing, said in its place above Browse's
// clusters, so the window doesn't look as if it failed.
export function ConnectNotices(props: { connections: ConnectionsModel; connectors: Connectors }) {
  const { connections, connectors } = props;
  return (
    <>
      {emptyConnections(connections).map((connection) => {
        const said = connectors[connection.kind]?.offer?.invite?.connected;
        if (!said) return null;
        const title = `empty-${connection.id}-title`;
        // What it reads, in bold, at the head of what the sidebar says of it.
        const rest = connection.about.startsWith(connection.reads)
          ? connection.about.slice(connection.reads.length)
          : ` · ${connection.about}`;
        return (
          <section key={connection.id} class="connected-empty" aria-labelledby={title}>
            <h2 id={title}>
              <span class="connected-dot" aria-hidden="true" />
              {connection.name} is connected
            </h2>
            <p class="connect-note">
              <strong>{connection.reads}</strong>
              {`${rest} ${said}`}
            </p>
          </section>
        );
      })}
    </>
  );
}
