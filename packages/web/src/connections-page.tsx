// Settings' Connections (decision 0049): one row per connection, drawn the
// same way for every connector: its name, its connector and what it reads,
// its state (synced, syncing, a problem, not open), what its last sync left
// out, and what a person sets on it: its name in the window, its connector's
// own options, whether it may propose changes, and how often it syncs; or,
// through a source server, what the person picks through it (decision 0059).
// Each applies at once, with an Undo, and the next sync reads with it. A
// mapping shows in its connector's review step, which the person edits and
// applies (OA-232), through a source server too. Disconnect asks first. Then
// Add a connection, which lists each connector the window connects itself,
// and draws its steps.
import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ConnectSteps, ReviewStep } from "./connect-steps.tsx";
import { SourceServers } from "./found.tsx";
import {
  type ConnectionsModel,
  type ConnectionsMsg,
  pickSaid,
  settableOf,
  settingOf,
  turnedOff,
} from "./connections.ts";
import type { Connectors } from "./connectors.ts";
import { type Dispatch, Folded, plural, useStamp } from "./parts.tsx";
import { Switch } from "./provider-row.tsx";
import { Choices } from "./settings-page.tsx";
import type {
  ConnectionPick,
  ConnectionView,
  ConnectorView,
  OptionField,
  PickChoiceView,
  ReviewOutline,
} from "./view.ts";

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
        <p class="settings-lede">A change applies at once, and the next sync reads with it.</p>
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
      <SourceServers connections={connections} connectors={connectors} dispatch={dispatch} />
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
  // One waiting for options that fit its source is set as an open one is;
  // one through a source server, by what the person picks through it, and
  // its mapping, if its connector reads one (decision 0059).
  const { settable, mappings } = settableOf(connection, connector);
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
        {connector?.offer?.mark ?? connectorName.charAt(0)}
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
                ? "Not open"
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
        {connection.state === "shut" && (
          <p class="settings-field-about">
            Oriel couldn't read {connectorName} when it started. Its items stay here, and it opens
            again once Oriel can read it.
          </p>
        )}
        {connection.report.length > 0 && (
          <ul class="connection-report" aria-label="What its last sync didn't read">
            {connection.report.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {connection.own && (
          <p class="settings-field-about">
            Oriel keeps these itself, on this Mac, until you turn on another.
          </p>
        )}
        {connection.through !== null && (
          <p class="settings-field-about">
            Oriel reads it through {connection.through}, a server in your agent. Turn it off under
            Source servers.
          </p>
        )}
        {settable && connection.through !== null && (
          <ServerPicks connection={connection} connections={connections} send={send} />
        )}
        {connector &&
          mappings.map((field) => (
            <Fragment key={field.name}>
              <MappingOption
                field={field}
                connection={connection}
                connector={connector}
                connections={connections}
                send={send}
              />
              {setting.said?.field === mappingPlace(field.name) && (
                <Said connection={connection} connections={connections} send={send} />
              )}
            </Fragment>
          ))}
        {connection.flagged && (
          <p class="settings-field-about">
            A flag of pnpm dev makes this connection at every start, so it's set there.
          </p>
        )}
        {settable && connection.through === null && connector && (
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
        {open && !connection.own && (
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
  if (connection.flagged || connection.own || connection.through !== null) return null;
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
        the window. Workstreams keep them as items Oriel no longer has, and threads keep what was
        said. Nothing changes in {connector?.inSentence ?? connection.name}.
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
          {beside(field.kind === "mapping" ? mappingPlace(field.name) : field.name)}
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

// How a connection's tables feed Oriel's fields (OA-232): while it waits,
// its connector's review step, the one a connect shows, with the draft or
// guess to apply. Once it reads, one line a table it reads, each with Ask
// Oriel, which drafts a change in the window chat, and Edit by hand, which
// opens the review step's editor on that table alone; the tables it doesn't
// read fold into one line. A change is the person's own, applied with an
// Undo, and says before then what it does to the items the connection has.
// Where a mapping's last change is said: its own place, apart from a pick
// that keeps the same option, for an option that is both picked through
// its server and mapped.
const mappingPlace = (name: string) => `${name}:mapping`;

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
  const editing = connections.edits[connection.id] ?? null;
  // Drawn again whenever its options change, wherever they were set.
  const options = JSON.stringify(connection.options);
  useEffect(() => {
    send({ type: "reviewAsked", kind: connection.kind, connection: connection.id });
  }, [connection.id, options]);
  const step = connector.review;
  if (step === null) return null;
  const reviewStep = (
    <ReviewStep
      connector={connector}
      step={step}
      connection={connection.id}
      review={review}
      editing={editing}
      pending={setting.pending}
      problem={review === null ? setting.unread : null}
      send={send}
      beside={mappingPlace(field.name)}
    />
  );
  const outline = review?.outline ?? null;
  const tab = (entry: ReviewOutline, ask: string) => (
    <>
      <span class="mapping-tab">
        <span class="mapping-name">{entry.name}</span>
        {entry.reads && <span class="mapping-reads">{entry.reads}</span>}
      </span>
      <span class="mapping-actions">
        <button
          type="button"
          class="quiet-action"
          disabled={setting.pending}
          onClick={() =>
            send({ type: "askOrielClicked", connection: connection.id, tab: entry.at })
          }
        >
          {ask}
        </button>
        <button
          type="button"
          class="quiet-action"
          disabled={setting.pending}
          onClick={() =>
            send({
              type: "handEditClicked",
              kind: connection.kind,
              connection: connection.id,
              tab: entry.at,
            })
          }
        >
          Edit by hand
        </button>
      </span>
      {editing?.only === entry.at && reviewStep}
    </>
  );
  const read = outline?.filter((entry) => entry.reads !== null) ?? [];
  const unread = outline?.filter((entry) => entry.reads === null) ?? [];
  return (
    <div class="settings-field connection-mapping">
      <span class="settings-field-name">{field.label}</span>
      <span class="settings-field-about">{field.about}</span>
      {outline === null ? (
        reviewStep
      ) : (
        <>
          {read.length === 0 ? (
            <p class="settings-field-about">No tab is read yet.</p>
          ) : (
            <ul class="mapping-tabs">
              {read.map((entry) => (
                <li key={entry.at}>{tab(entry, "Ask Oriel to fix this")}</li>
              ))}
            </ul>
          )}
          <Folded
            label={`${unread.length} ${unread.length === 1 ? "tab" : "tabs"} Oriel isn't reading`}
            entries={unread}
            find="Find a tab"
          >
            {(entry) => <div class="mapping-row">{tab(entry, "Ask Oriel to set it up")}</div>}
          </Folded>
        </>
      )}
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

// What a person picks on a connection through its source server (decision
// 0059), such as a project or channels, from the lists the
// server gives, each with the last change's word beside it. With nothing
// picked, each says what the connection reads instead. Settings draws it
// in the connection's row, and the first run under what Oriel found, where
// each names its source (`of`), as its connector names it, and says itself
// why a list didn't come, as no row says it there.
export function ServerPicks(props: {
  connection: ConnectionView;
  connections: ConnectionsModel;
  send(msg: ConnectionsMsg): void;
  of?: string;
}) {
  const { connection, connections, send } = props;
  const setting = settingOf(connections, connection.id);
  return (
    <div class="connection-options">
      {props.of && setting.said === null && (setting.problem ?? connection.problem) && (
        <p class="connection-problem" role="alert">
          {setting.problem ?? connection.problem}
        </p>
      )}
      {connection.picks.map((pick) => (
        <Fragment key={pick.name}>
          <PickOption
            pick={props.of ? { ...pick, label: `${props.of} ${pick.label.toLowerCase()}` } : pick}
            connection={connection}
            connections={connections}
            send={send}
            onPick={(value) =>
              send({
                type: "configured",
                connection: connection.id,
                options: { [pick.name]: value },
                what: `its ${pick.label.toLowerCase()}`,
                field: pick.name,
              })
            }
          />
          {setting.said?.field === pick.name && (
            <Said connection={connection} connections={connections} send={send} />
          )}
        </Fragment>
      ))}
    </div>
  );
}

// What a person picks on a connection through its source server, from the
// list the server gives: what's picked now, as the server reads it from the
// connection's options, and Change, which lists. One of several is ticked,
// then used together, up to `most`; with none picked, it says what the
// connection reads instead.
function PickOption(props: {
  pick: ConnectionPick;
  connection: ConnectionView;
  connections: ConnectionsModel;
  send(msg: ConnectionsMsg): void;
  onPick(value: string | string[]): void;
}) {
  const { pick: field, connection, connections, send } = props;
  const setting = settingOf(connections, connection.id);
  const [listing, list] = useState(false);
  const { picked, many } = field;
  const { current, none, said } = pickSaid(field);
  // Those ticked, while listing several.
  const [ticked, tick] = useState<string[]>(picked);
  const most = field.most ?? Number.POSITIVE_INFINITY;
  return (
    <fieldset class="settings-field">
      <legend class="settings-field-name">{field.label}</legend>
      <span class="settings-field-about">
        {said} {/* Again, while no list came, as when the source didn't give one. */}
        {(!listing || setting.choices === null) && (
          // Listing asks the person's agent, which takes a while: the button
          // says so at once, and takes no second click.
          <button
            type="button"
            class="quiet-action pick-open"
            disabled={setting.pending || (listing && setting.listing)}
            aria-pressed={listing && setting.listing ? true : undefined}
            onClick={() => {
              list(true);
              tick(picked);
              send({
                type: "choicesAsked",
                connection: connection.id,
                query: "",
                field: field.name,
                opened: true,
              });
            }}
          >
            {listing && setting.listing ? (
              <>
                <span class="spinner" aria-hidden="true" />
                Listing…
              </>
            ) : none && field.unpicked ? (
              "Pick"
            ) : (
              "Change"
            )}
          </button>
        )}
      </span>
      {listing && setting.choices !== null && (
        // The list scrolls; Find above it and its actions below stay in
        // sight, however long it is.
        <div class="pick-list">
          {(setting.more || setting.query !== "") && (
            <input
              class="input"
              type="search"
              value={setting.query}
              placeholder="Find…"
              aria-label={`Find a ${field.label.toLowerCase()}`}
              onChange={(event) =>
                send({
                  type: "choicesAsked",
                  connection: connection.id,
                  query: event.currentTarget.value,
                  field: field.name,
                })
              }
            />
          )}
          <div class="choices">
            {setting.choices.map((choice) =>
              many ? (
                <label key={choice.value} class={choiceClass(choice)}>
                  <input
                    type="checkbox"
                    value={choice.value}
                    checked={ticked.includes(choice.value)}
                    disabled={
                      setting.pending || (!ticked.includes(choice.value) && ticked.length >= most)
                    }
                    onChange={(event) =>
                      tick(
                        event.currentTarget.checked
                          ? [...ticked, choice.value]
                          : ticked.filter((each) => each !== choice.value),
                      )
                    }
                  />
                  <ChoiceName choice={choice} pick={field} />
                </label>
              ) : (
                <label key={choice.value} class={choiceClass(choice)}>
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
                  <ChoiceName choice={choice} pick={field} />
                </label>
              ),
            )}
          </div>
          <div class="cli-actions">
            {many && (
              <button
                type="button"
                class="button primary"
                // Unticking every one picked, the connection reads what it
                // reads with none, where it says.
                disabled={setting.pending || (ticked.length === 0 && (none || !field.unpicked))}
                onClick={() => {
                  list(false);
                  props.onPick(ticked);
                }}
              >
                {ticked.length === 0
                  ? field.unpicked && !none
                    ? "Use none"
                    : "Use these"
                  : `Use these ${ticked.length}`}
              </button>
            )}
            <button type="button" class="button" onClick={() => list(false)}>
              Cancel
            </button>
            {many && Number.isFinite(most) && (
              <span class="settings-field-about">At most {most}.</span>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

// A choice in a pick's list, by its name, with its value where one is
// picked alone; one picked that the list didn't give says why, in its
// pick's words, under its name.
function ChoiceName(props: { choice: PickChoiceView; pick: ConnectionPick }) {
  const { choice, pick } = props;
  const name = pick.many ? choice.name : `${choice.name} (${choice.value})`;
  if (!choice.unlisted) return <>{name}</>;
  return (
    <span class="choice-text">
      {name}
      <span class="settings-field-about">
        {pick.unlisted ?? "Picked, but no longer in the list."}
      </span>
    </span>
  );
}

const choiceClass = (choice: PickChoiceView) =>
  choice.unlisted ? "choice choice-unlisted" : "choice";

// Every connector the window connects itself, what's on this Mac, and whether it
// may connect it now, or why not; one picked shows its steps beneath it. The
// rest come through source servers, above (decision 0059).
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
        {Object.values(connectors)
          // A kind turned off doesn't show at all (decision 0059).
          .filter((connector) => connector.connect !== null)
          .filter((connector) => !turnedOff(connections).includes(connector.kind))
          .map((connector) => {
            const { offer } = connector;
            const connectable = view.connectable.includes(connector.kind);
            const why = view.refused[connector.kind];
            const open = connectable && (connections.forms[connector.kind]?.open ?? false);
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
