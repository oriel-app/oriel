// Settings' Connections (decision 0049): one row per connection, drawn the
// same way for every connector: its name, its connector and what it reads,
// its state (synced, syncing, a problem, signed out), what its last sync left
// out, and what a person sets on it: its name in the window, its connector's
// own options, whether it may propose changes, and how often it syncs. Each
// applies at once, with an Undo, and the next sync reads with it. A mapping
// shows in its connector's review step, which the person edits and applies
// (OA-232).
// Disconnect asks first. Then Add a connection, which lists every connector
// and draws its steps.
import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ConnectSteps, ReviewStep } from "./connect-steps.tsx";
import { type ConnectionsModel, type ConnectionsMsg, formOf, settingOf } from "./connections.ts";
import type { Connectors } from "./connectors.ts";
import { type Dispatch, plural, useStamp } from "./parts.tsx";
import { Switch } from "./provider-row.tsx";
import { Choices } from "./settings-page.tsx";
import type { ConnectionView, ConnectorView, OptionField } from "./view.ts";

// How often a connection syncs while Oriel is open, by minutes.
const everyNames: { value: string; label: string }[] = [
  { value: "start", label: "When Oriel starts, and when you ask" },
  { value: "5", label: "Every 5 minutes" },
  { value: "15", label: "Every 15 minutes" },
  { value: "60", label: "Every hour" },
];

export function Connections(props: {
  connections: ConnectionsModel;
  connectors: Connectors;
  dispatch: Dispatch;
}) {
  const { connections, connectors, dispatch } = props;
  const view = connections.view;
  if (view === null) return <p class="loading">Loading…</p>;
  return (
    <>
      <section class="settings-section" aria-labelledby="settings-connections">
        <h2 id="settings-connections" class="settings-title">
          Connections
        </h2>
        <p class="settings-lede">
          Everything Oriel reads, one row each. A change applies at once, and the next sync reads
          with it.
        </p>
        {view.connections.length === 0 ? (
          <p class="settings-field-about">Nothing is connected yet.</p>
        ) : (
          <ul class="provider-rows connection-rows">
            {view.connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                connector={connectors[connection.kind]}
                connections={connections}
                dispatch={dispatch}
              />
            ))}
          </ul>
        )}
      </section>
      <AddConnection connections={connections} connectors={connectors} dispatch={dispatch} />
    </>
  );
}

function ConnectionRow(props: {
  connection: ConnectionView;
  connector: ConnectorView | undefined;
  connections: ConnectionsModel;
  dispatch: Dispatch;
}) {
  const { connection, connector, connections, dispatch } = props;
  const send = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const synced = useStamp();
  const setting = settingOf(connections, connection.id);
  const syncing = connections.syncing.includes(connection.id);
  const problem = connections.problems[connection.id] ?? connection.problem;
  const open = connection.state === "open";
  const waiting = connection.state === "waiting";
  // One waiting for options that fit its source is set as an open one is.
  const settable = (open || waiting) && !connection.flagged;
  // The last change says what it set, and its own problem, beside the
  // option it changed; any other problem says itself here.
  const besideChange = setting.said !== null && settable;
  const saidBeside = besideChange && setting.problem === problem;
  const connectorName = connector?.name ?? connection.kind;
  return (
    <li
      class="provider-row connection-row"
      id={`connection-${connection.id}`}
      data-status={open && problem === null ? "ready" : undefined}
    >
      <span class="provider-icon" aria-hidden="true">
        {connector?.connect?.offer.mark ?? connectorName.charAt(0)}
      </span>
      <div class="provider-main">
        <span class="provider-name">{connection.name}</span>
        <span class="provider-about">
          {connection.named ? `${connectorName} · ${connection.about}` : connection.about}
        </span>
        <span class="provider-status">
          <span class="provider-mark" aria-hidden="true" />
          <span class="provider-state">
            {waiting
              ? "Waiting for options that fit"
              : !open
                ? "Signed out"
                : syncing
                  ? "Syncing…"
                  : problem !== null
                    ? "A problem"
                    : connection.syncedAt === null
                      ? "Not synced yet"
                      : `Synced ${synced(connection.syncedAt)}`}
          </span>
          {open && <span>· {plural(connection.items, "item")}</span>}
        </span>
        {(open || waiting) && problem !== null && !syncing && !saidBeside && (
          <p class="connection-problem" role="alert">
            {problem}
          </p>
        )}
        {connection.state === "signed-out" && (
          <p class="settings-field-about">
            {connectorName} turned Oriel away when it started. Connect it again below, or disconnect
            it.
          </p>
        )}
        {connection.report.length > 0 && (
          <ul class="connection-report" aria-label="What its last sync didn't read">
            {connection.report.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {connection.flagged && (
          <p class="settings-field-about">
            A flag of pnpm dev makes this connection at every start, so it's set there.
          </p>
        )}
        {settable && connector && (
          <Options
            connection={connection}
            connector={connector}
            connections={connections}
            send={send}
          />
        )}
        {!besideChange && <Said connection={connection} connections={connections} send={send} />}
        <Disconnect
          connection={connection}
          connector={connector}
          connections={connections}
          dispatch={dispatch}
        />
      </div>
      <div class="provider-side">
        {open && (
          <button
            type="button"
            class="button"
            disabled={syncing}
            onClick={() => send({ type: "syncClicked", connection: connection.id })}
          >
            Sync
          </button>
        )}
      </div>
    </li>
  );
}

// What the last change set, with its Undo; or why it didn't work, or why
// what it set doesn't fit the source, with the Undo right there to put the
// old options back. Settings draws it beside the option it changed.
function Said(props: {
  connection: ConnectionView;
  connections: ConnectionsModel;
  send(msg: ConnectionsMsg): void;
}) {
  const { connection, connections, send } = props;
  const setting = settingOf(connections, connection.id);
  const { said } = setting;
  if (!said && !setting.problem) return null;
  return (
    <div class="connection-said" role={setting.problem ? "alert" : "status"}>
      {said && (
        <span>
          {setting.pending ? `Setting ${said.what}…` : `Set ${said.what}.`}
          {said.undo !== null && !setting.pending && (
            <>
              {" "}
              <button
                type="button"
                class="quiet-action"
                onClick={() => send({ type: "undoClicked", connection: connection.id })}
              >
                Undo
              </button>
            </>
          )}
        </span>
      )}
      {setting.problem && <p class="connection-problem">{setting.problem}</p>}
    </div>
  );
}

// Disconnect, which asks first, saying what goes. A connection a flag makes
// is made again at every start, so it has none.
export function Disconnect(props: {
  connection: ConnectionView;
  connector: ConnectorView | undefined;
  connections: ConnectionsModel;
  dispatch: Dispatch;
}) {
  const { connection, connector, connections, dispatch } = props;
  const send = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const { disconnect } = settingOf(connections, connection.id);
  if (connection.flagged) return null;
  if (disconnect === null)
    return (
      <span class="cli-actions">
        <button
          type="button"
          class="quiet-action"
          onClick={() => send({ type: "disconnectClicked", connection: connection.id })}
        >
          Disconnect {connection.name}
        </button>
      </span>
    );
  return (
    <div
      class="cli-box"
      data-tone="warn"
      role="alertdialog"
      aria-label={`Disconnect ${connection.name}?`}
    >
      <p>
        <strong>Disconnect {connection.name}?</strong> Its {plural(connection.items, "item")} leave
        the window, with what Oriel keeps to sign in to it. Workstreams keep them as items Oriel no
        longer has, and threads keep what was said. Nothing changes in{" "}
        {connector?.inSentence ?? connection.name}.
      </p>
      <div class="cli-actions">
        <button
          type="button"
          class="button danger"
          disabled={disconnect === "disconnecting"}
          onClick={() => send({ type: "disconnectAnswered", connection: connection.id, yes: true })}
        >
          {disconnect === "disconnecting" ? "Disconnecting…" : "Disconnect"}
        </button>
        <button
          type="button"
          class="button"
          disabled={disconnect === "disconnecting"}
          onClick={() =>
            send({ type: "disconnectAnswered", connection: connection.id, yes: false })
          }
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// What a person sets on a connection, drawn the same way for every one.
function Options(props: {
  connection: ConnectionView;
  connector: ConnectorView;
  connections: ConnectionsModel;
  send(msg: ConnectionsMsg): void;
}) {
  const { connection, connector, connections, send } = props;
  const setting = settingOf(connections, connection.id);
  const set = (options: Record<string, unknown>, what: string) =>
    send({
      type: "configured",
      connection: connection.id,
      options,
      what,
      field: Object.keys(options)[0] ?? "",
    });
  // The last change's word, beside the option it changed.
  const beside = (field: string) =>
    setting.said?.field === field && (
      <Said connection={connection} connections={connections} send={send} />
    );
  const typed = setting.name ?? (connection.named ? connection.name : "");
  const named = () => {
    const name = typed.trim() === "" ? null : typed.trim();
    if (name !== (connection.named ? connection.name : null)) set({ name }, "its name");
  };
  return (
    <div class="connection-options">
      <label class="settings-field">
        <span class="settings-field-name">Name</span>
        <span class="settings-field-about">How the window names it.</span>
        <input
          class="input"
          value={typed}
          placeholder={connector.name}
          maxLength={60}
          disabled={setting.pending}
          onInput={(event) =>
            send({ type: "nameTyped", connection: connection.id, name: event.currentTarget.value })
          }
          onBlur={named}
          onKeyDown={(event) => {
            if (event.key === "Enter") named();
          }}
        />
      </label>
      {beside("name")}
      {connector.options.map((field) => (
        <Fragment key={field.name}>
          {field.kind === "mapping" ? (
            <MappingOption
              field={field}
              connection={connection}
              connector={connector}
              connections={connections}
              send={send}
            />
          ) : field.kind === "pick" ? (
            <PickOption
              field={field}
              connection={connection}
              connections={connections}
              send={send}
              onPick={(value) => set({ [field.name]: value }, `its ${field.label.toLowerCase()}`)}
            />
          ) : field.kind === "list" ? (
            <ListOption
              field={field}
              connection={connection}
              disabled={setting.pending}
              onSet={(names) => set({ [field.name]: names }, `its ${field.label.toLowerCase()}`)}
            />
          ) : (
            <ReadOnly
              connection={connection}
              connector={connector}
              onChange={(on) =>
                set({ [field.name]: !on }, on ? "it to propose changes" : "it to read only")
              }
            />
          )}
          {beside(field.name)}
        </Fragment>
      ))}
      <Choices
        name="How often it syncs"
        group={`connection-${connection.id}-every`}
        about="While Oriel is open. Sync in the sidebar reads it any time."
        options={everyNames}
        value={connection.every === null ? "start" : String(connection.every)}
        onPick={(value) =>
          set({ every: value === "start" ? null : Number(value) }, "how often it syncs")
        }
      />
      {beside("every")}
    </div>
  );
}

// How a connection's tables feed Oriel's fields (OA-232): its connector's
// review step, the one a connect shows, filled with the mapping it reads
// with now, or, while it waits for one, the draft or guess to apply. A
// change is the person's own, applied with an Undo, and the step says
// before then what it does to the items the connection has.
function MappingOption(props: {
  field: Extract<OptionField, { kind: "mapping" }>;
  connection: ConnectionView;
  connector: ConnectorView;
  connections: ConnectionsModel;
  send(msg: ConnectionsMsg): void;
}) {
  const { field, connection, connector, connections, send } = props;
  const review = connections.reviews[connection.id] ?? null;
  const setting = settingOf(connections, connection.id);
  // Drawn again whenever its options change, wherever they were set.
  const options = JSON.stringify(connection.options);
  useEffect(() => {
    send({ type: "reviewAsked", kind: connection.kind, connection: connection.id });
  }, [connection.id, options]);
  const step = connector.connect?.steps.find((each) => each.kind === "review");
  // One just made shows it in its connect steps, below, until it applies.
  if (step?.kind !== "review" || formOf(connections, connection.kind).made === connection.id)
    return null;
  return (
    <div class="settings-field connection-mapping">
      <span class="settings-field-name">{field.label}</span>
      <span class="settings-field-about">{field.about}</span>
      <ReviewStep
        connector={connector}
        step={step}
        connection={connection.id}
        review={review}
        editing={connections.edits[connection.id] ?? null}
        pending={setting.pending}
        problem={review === null ? setting.unread : null}
        send={send}
        beside={field.name}
      />
    </div>
  );
}

// Names the person types, with commas between them, set as they leave the
// field or press Enter.
function ListOption(props: {
  field: Extract<OptionField, { kind: "list" }>;
  connection: ConnectionView;
  disabled: boolean;
  onSet(names: string[]): void;
}) {
  const { field, connection } = props;
  const now = connection.options[field.name];
  const names = Array.isArray(now) ? now.map(String) : [];
  const [typed, type] = useState<string | null>(null);
  const done = () => {
    if (typed === null) return;
    const next = typed
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    type(null);
    if (next.join(",") !== names.join(",")) props.onSet(next);
  };
  return (
    <label class="settings-field">
      <span class="settings-field-name">{field.label}</span>
      <span class="settings-field-about">{field.about}</span>
      <input
        class="input"
        value={typed ?? names.join(", ")}
        disabled={props.disabled}
        spellcheck={false}
        onInput={(event) => type(event.currentTarget.value)}
        onBlur={done}
        onKeyDown={(event) => {
          if (event.key === "Enter") done();
        }}
      />
    </label>
  );
}

// Whether Oriel may propose changes to a connection, its connector's
// `readOnly` option turned round. One its source lets the person only view
// is read-only whatever it says: locked, with why.
function ReadOnly(props: {
  connection: ConnectionView;
  connector: ConnectorView;
  onChange(on: boolean): void;
}) {
  const { connection, connector } = props;
  const locked = connection.viewOnly?.all === true;
  return (
    <div class="settings-field settings-switch" data-locked={locked || undefined}>
      <span class="settings-field-name">Oriel may propose changes</span>
      <span class="settings-field-about">
        {locked
          ? connection.viewOnly?.why
          : `Off, Oriel only reads ${connector.inSentence}, and the agent can't propose a change to it. On, nothing changes there until you approve it.`}
        {!locked && connection.viewOnly && ` ${connection.viewOnly.why}`}
      </span>
      <Switch
        on={!locked && !connection.readOnly}
        label={`Oriel may propose changes to ${connection.name}`}
        disabled={locked}
        onChange={props.onChange}
      />
    </div>
  );
}

// One of a connector's options picked from the list its source gives, for
// the connection's own account: what it is now, and Change, which lists.
function PickOption(props: {
  field: Extract<OptionField, { kind: "pick" }>;
  connection: ConnectionView;
  connections: ConnectionsModel;
  send(msg: ConnectionsMsg): void;
  onPick(value: string): void;
}) {
  const { field, connection, connections, send } = props;
  const setting = settingOf(connections, connection.id);
  const [listing, list] = useState(false);
  const now = connection.options[field.name];
  const current = typeof now === "string" ? now : "";
  return (
    <fieldset class="settings-field">
      <legend class="settings-field-name">{field.label}</legend>
      <span class="settings-field-about">
        {current}{" "}
        {!listing && (
          <button
            type="button"
            class="quiet-action"
            disabled={setting.pending}
            onClick={() => {
              list(true);
              send({ type: "choicesAsked", connection: connection.id, query: "" });
            }}
          >
            Change
          </button>
        )}
      </span>
      {listing && setting.choices !== null && (
        <div class="choices">
          {(setting.more || setting.query !== "") && (
            <input
              class="input"
              type="search"
              value={setting.query}
              aria-label={`Find a ${field.label.toLowerCase()}`}
              onChange={(event) =>
                send({
                  type: "choicesAsked",
                  connection: connection.id,
                  query: event.currentTarget.value,
                })
              }
            />
          )}
          {setting.choices.map((choice) => (
            <label key={choice.value} class="choice">
              <input
                type="radio"
                name={`connection-${connection.id}-${field.name}`}
                value={choice.value}
                checked={choice.value === current}
                disabled={setting.pending}
                onChange={() => {
                  list(false);
                  props.onPick(choice.value);
                }}
              />
              {choice.name} ({choice.value})
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

// Every connector, and whether the window may connect it now, or why not;
// one picked shows its steps beneath it.
function AddConnection(props: {
  connections: ConnectionsModel;
  connectors: Connectors;
  dispatch: Dispatch;
}) {
  const { connections, connectors, dispatch } = props;
  const view = connections.view;
  if (view === null) return null;
  const send = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  return (
    <section class="settings-section" aria-labelledby="settings-add-connection">
      <h2 id="settings-add-connection" class="settings-title">
        Add a connection
      </h2>
      <ul class="provider-rows">
        {Object.values(connectors).map((connector) => {
          const offer = connector.connect?.offer;
          const connectable = view.connectable.includes(connector.kind);
          const why = view.refused[connector.kind];
          // One just made stays open on its review step, until it applies.
          const form = formOf(connections, connector.kind);
          const open = (connectable || form.made !== null) && form.open;
          return (
            <li key={connector.kind} class="provider-row">
              <span class="provider-icon" aria-hidden="true">
                {offer?.mark ?? connector.name.charAt(0)}
              </span>
              <div class="provider-main">
                <span class="provider-name">{connector.name}</span>
                {offer && <span class="provider-about">{offer.about}</span>}
                {!connectable && !open && why && <span class="settings-field-about">{why}</span>}
                {open && (
                  <ConnectSteps
                    connector={connector}
                    connections={connections}
                    dispatch={dispatch}
                    onCancel={() => send({ type: "closed", kind: connector.kind })}
                  />
                )}
              </div>
              {connectable && !open && (
                <div class="provider-side">
                  <button
                    type="button"
                    class="button"
                    onClick={() => send({ type: "opened", kind: connector.kind })}
                  >
                    Connect
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
