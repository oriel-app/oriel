// A connector's steps, drawn from its declaration the same way wherever a
// connection is made: the first run, the overview's card and Settings'
// Add a connection (decision 0049). Each step kind is drawn here once, in
// its connector's words: what the person types, with its help beside it;
// one from a list the source gives; a folder step's path, from the folder picker or
// by its typed path. A refusal names its fields and keeps the help on
// screen (OA-125). And what the window says of a connector it offers, or of
// a connection that read nothing.
import type { ComponentChildren } from "preact";
import {
  type ConnectForm,
  type ConnectionsModel,
  type ConnectionsMsg,
  emptyConnections,
  type FolderKind,
  folderStep,
  formOf,
  openConnections,
  pickedChoice,
  stepOf,
  typedAll,
} from "./connections.ts";
import type { Connectors } from "./connectors.ts";
import { type Dispatch, Link, plural, useStamp } from "./parts.tsx";
import type { ConnectField, ConnectorView, ConnectStep } from "./view.ts";

type Step<K extends ConnectStep["kind"]> = Extract<ConnectStep, { kind: K }>;

type StepProps<K extends ConnectStep["kind"]> = {
  connector: ConnectorView;
  step: Step<K>;
  form: ConnectForm;
  send(msg: ConnectionsMsg): void;
  // What sits beside the step's button, such as Back.
  actions?: ComponentChildren;
};

// A connector's own words with a little markup: `**text**` is strong, and
// `[text](https://…)` a link that opens in the browser. Its words are
// reviewed code, never a value anyone typed or synced.
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https:\/\/[^)\s]+\))/);
  return (
    <>
      {parts.map((part, at) => {
        const strong = /^\*\*([^*]+)\*\*$/.exec(part);
        if (strong) return <strong key={at}>{strong[1]}</strong>;
        const link = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(part);
        if (link)
          return (
            <a key={at} href={link[2]} target="_blank" rel="noreferrer">
              {link[1]}
            </a>
          );
        return part;
      })}
    </>
  );
}

// What a field holds, for the browser: a secret is never offered back.
const inputOf = (field: ConnectField): Record<string, string> =>
  field.secret
    ? { type: "password", autoComplete: "off" }
    : field.input === "url"
      ? { type: "text", autoComplete: "url" }
      : field.input === "email"
        ? { type: "email", autoComplete: "email" }
        : { type: "text" };

export function FieldsStep(props: StepProps<"fields">) {
  const { connector, step, form, send } = props;
  const { kind } = connector;
  return (
    <form
      class="connect-details"
      aria-label={step.label}
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: "nextClicked", kind, steps: connector.connect?.steps ?? [] });
      }}
    >
      <div class="connect-fields">
        {step.fields.map((field) => (
          <label key={field.name} class="connect-field">
            <span class="connect-label">{field.label}</span>
            <input
              class="input"
              name={field.name}
              value={form.typed[field.name] ?? ""}
              spellcheck={false}
              autoCapitalize="off"
              aria-invalid={form.fields.includes(field.name) || undefined}
              {...inputOf(field)}
              {...(field.placeholder ? { placeholder: field.placeholder } : {})}
              onInput={(event) =>
                send({
                  type: "fieldChanged",
                  kind,
                  field: field.name,
                  value: event.currentTarget.value,
                })
              }
            />
            {field.hint && <span class="connect-hint">{field.hint}</span>}
          </label>
        ))}
        {form.problem && form.choices === null && (
          <p class="connect-problem" role="alert">
            {form.problem}
          </p>
        )}
      </div>
      {step.help && (
        <div class="connect-help">
          <p>
            <Inline text={step.help.intro} />
          </p>
          <ol>
            {step.help.lines.map((line) => (
              <li key={line}>
                <Inline text={line} />
              </li>
            ))}
          </ol>
        </div>
      )}
      <div class="connect-actions">
        {props.actions}
        <button
          type="submit"
          class="button primary"
          disabled={form.pending !== null || !typedAll(form, step)}
        >
          {form.pending === "listing" || form.pending === "connecting" ? "Connecting…" : "Connect"}
        </button>
      </div>
    </form>
  );
}

const shortDay = (instant: string) =>
  new Date(instant).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function PickStep(props: StepProps<"pick">) {
  const { connector, step, form, send } = props;
  const { kind } = connector;
  const steps = connector.connect?.steps ?? [];
  const stamp = useStamp();
  const choices = form.choices ?? [];
  const picked = choices.find((choice) => choice.value === form.picked);
  return (
    <form
      class="connect-pick"
      aria-label={step.label}
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: "connectClicked", kind, steps });
      }}
    >
      {(form.more || form.query !== "") && (
        <input
          class="input"
          type="search"
          value={form.query}
          placeholder={step.find}
          aria-label={step.findLabel}
          onChange={(event) =>
            send({ type: "queryChanged", kind, steps, query: event.currentTarget.value })
          }
        />
      )}
      {choices.length === 0 ? (
        <p class="connect-none">{form.query ? step.noMatch : step.none}</p>
      ) : (
        <ul class="choice-rows" role="radiogroup" aria-label={step.list}>
          {choices.map((choice) => (
            <li key={choice.value} data-picked={choice.value === form.picked || undefined}>
              <label class="choice-row">
                <input
                  type="radio"
                  name={`${kind}-${step.field}`}
                  value={choice.value}
                  checked={choice.value === form.picked}
                  onChange={() => send({ type: "choicePicked", kind, value: choice.value })}
                />
                <span class="choice-text">
                  <span class="choice-name">{choice.name}</span>
                  <span class="choice-detail">
                    {choice.value}
                    {choice.count !== null && ` · ${plural(choice.count, step.counts)}`}
                    {choice.updatedAt && ` · changed ${stamp(choice.updatedAt, shortDay)}`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {form.problem && (
        <p class="connect-problem" role="alert">
          {form.problem}
        </p>
      )}
      <div class="connect-actions">
        {props.actions}
        <button
          type="submit"
          class="button primary"
          disabled={form.pending !== null || picked === undefined}
        >
          {form.pending === "connecting" ? "Connecting…" : picked ? `Use ${picked.name}` : step.use}
        </button>
      </div>
    </form>
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

// A connector's steps, at the one the person is on. `onCancel` leaves them.
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
  if (!step) return null;
  switch (step.kind) {
    case "fields":
      return (
        <FieldsStep
          connector={connector}
          step={step}
          form={form}
          send={send}
          actions={
            <button type="button" class="quiet-action" onClick={props.onCancel}>
              Cancel
            </button>
          }
        />
      );
    case "pick":
      return (
        <PickStep
          connector={connector}
          step={step}
          form={form}
          send={send}
          actions={
            <button
              type="button"
              class="quiet-action"
              onClick={() => send({ type: "backClicked", kind: connector.kind })}
            >
              Back
            </button>
          }
        />
      );
    case folderStep: {
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
  }
}

// Whether only connections Oriel reads and never changes are open, so a
// connector that writes says what it adds.
export const readOnlyOnly = (connections: ConnectionsModel, connectors: Connectors): boolean => {
  const open = openConnections(connections);
  return open.length > 0 && !open.some((each) => connectors[each.kind]?.writable);
};

// The overview's card for a connector it offers while the window may connect
// it: what it brings, then its steps, the one place the onboarding names
// what a sign-in calls a token, in its field's label.
export function ConnectCard(props: {
  connector: ConnectorView;
  connections: ConnectionsModel;
  readOnlyOnly: boolean;
  dispatch: Dispatch;
}) {
  const { connector, connections, dispatch } = props;
  const send = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const invite = connector.connect?.offer.invite;
  const steps = connector.connect?.steps ?? [];
  const form = formOf(connections, connector.kind);
  const step = stepOf(steps, form);
  if (!invite || !step) return null;
  const title = `connect-${connector.kind}-title`;
  // One its source turned away, which only signing in again or
  // disconnecting gets past.
  const signedOut = connections.view?.connections.find(
    (each) => each.kind === connector.kind && each.state === "signed-out",
  );
  return (
    <section class="connect-card" aria-labelledby={title}>
      <h2 id={title}>{step.kind === folderStep ? `Connect ${connector.name}` : step.title}</h2>
      <p class="connect-note">
        {step.kind === "pick" ? step.lede : props.readOnlyOnly ? invite.readOnly : invite.note}
      </p>
      {signedOut && (
        <p class="connect-note">
          {signedOut.name} is signed out. Sign in to it again here, or{" "}
          <Link
            route={{ page: "settings", section: "connections" }}
            dispatch={dispatch}
            class="quiet-action"
          >
            disconnect it in Settings
          </Link>
          .
        </p>
      )}
      {step.kind === "fields" ? (
        <FieldsStep connector={connector} step={step} form={form} send={send} />
      ) : step.kind === "pick" ? (
        <PickStep
          connector={connector}
          step={step}
          form={form}
          send={send}
          actions={
            <button
              type="button"
              class="quiet-action"
              onClick={() => send({ type: "backClicked", kind: connector.kind })}
            >
              Back
            </button>
          }
        />
      ) : null}
    </section>
  );
}

// A card for each connector the window offers while it may connect it.
export function ConnectCards(props: {
  connections: ConnectionsModel;
  connectors: Connectors;
  dispatch: Dispatch;
}) {
  const { connections, connectors, dispatch } = props;
  const connectable = connections.view?.connectable ?? [];
  const only = readOnlyOnly(connections, connectors);
  return (
    <>
      {Object.values(connectors)
        .filter((connector) => connectable.includes(connector.kind))
        .map((connector) => (
          <ConnectCard
            key={connector.kind}
            connector={connector}
            connections={connections}
            readOnlyOnly={only}
            dispatch={dispatch}
          />
        ))}
    </>
  );
}

// What Browse shows of connections above its clusters: the cards, and a
// connection that read nothing said in its place, so the window doesn't look
// as if it failed.
export function ConnectNotices(props: {
  connections: ConnectionsModel;
  connectors: Connectors;
  dispatch: Dispatch;
}) {
  const { connections, connectors } = props;
  return (
    <>
      <ConnectCards {...props} />
      {emptyConnections(connections).map((connection) => {
        const said = connectors[connection.kind]?.connect?.offer.invite?.connected;
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

// The choice a connect is reading, by its name in the list, for progress.
export const readingName = (form: ConnectForm): string | null =>
  pickedChoice(form)?.name ?? (form.tried || null);
