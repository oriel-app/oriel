// Every connection in the window (decision 0049), as the server lists them,
// read once and shared by the sidebar, the first run, the overview and
// Settings: syncing any of them, or all, on demand; making one through its
// connector's steps, which the page draws from its declaration, the same way
// for every connector; and, in Settings, setting one's options and
// disconnecting it. A sync that fails keeps what the window had, and says why
// on its connection until its next sync works. Nothing typed into a
// connector's steps stays in the page once its connection is made.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { Connectors } from "./connectors.ts";
import type {
  ConnectionsView,
  ConnectionView,
  ConnectorView,
  ConnectStep,
  PickChoiceView,
} from "./view.ts";

// One connector's steps as the person goes through them: the step showing,
// by its place; what they typed; the pick step's list once the source gave
// it, which `more` says is longer, and `query` narrowed; the one picked;
// what's being asked of the server: the list, the folder picker,
// or the connection; what the last connect tried, for its progress and Try
// again; and why the last step didn't work, with the fields it named.
// `open`: shown in Settings' Add a connection, until it's made or cancelled.
export type ConnectForm = {
  open: boolean;
  step: number;
  typed: Readonly<Record<string, string>>;
  choices: PickChoiceView[] | null;
  more: boolean;
  query: string;
  picked: string | null;
  pending: "listing" | "choosing" | "connecting" | null;
  tried: string | null;
  problem: string | null;
  fields: readonly string[];
};

// One connection in Settings: its name as typed and not yet set; its pick
// step's list, once asked for; whether a change is on its way, and what the
// last one changed, by the option it changed, with its Undo; why it didn't
// work, or why the options it set don't fit the source; and Disconnect,
// asked and then answered.
export type ConnectionSetting = {
  name: string | null;
  choices: PickChoiceView[] | null;
  more: boolean;
  query: string;
  pending: boolean;
  said: { what: string; field: string; undo: unknown } | null;
  problem: string | null;
  disconnect: "asked" | "disconnecting" | null;
};

export type ConnectionsModel = {
  // As the server has them; null before they load.
  view: ConnectionsView | null;
  // The connections syncing now, by ID.
  syncing: readonly string[];
  // Why a connection's last sync asked for didn't work, by ID, until one does.
  problems: Readonly<Record<string, string>>;
  // Each connector's steps, by its kind, once the person starts them.
  forms: Readonly<Record<string, ConnectForm>>;
  // Settings' connections, by ID, once the person changes one.
  settings: Readonly<Record<string, ConnectionSetting>>;
};

export type ConnectionsMsg =
  | { type: "syncClicked"; connection: string }
  | { type: "syncAllClicked" }
  // A connector's steps, by its kind.
  | { type: "fieldChanged"; kind: string; field: string; value: string }
  // A fields step is done: the next step's list, or the connection.
  | { type: "nextClicked"; kind: string; steps: readonly ConnectStep[] }
  | { type: "queryChanged"; kind: string; steps: readonly ConnectStep[]; query: string }
  | { type: "choicePicked"; kind: string; value: string }
  // The pick step's Use, or Try again after a first sync that stopped.
  | { type: "connectClicked"; kind: string; steps: readonly ConnectStep[] }
  // A folder step: the folder picker, or the path typed.
  | { type: "chooseClicked"; kind: string }
  // Back to the step before, which keeps what was typed; into them in
  // Settings, or out of them.
  | { type: "backClicked"; kind: string }
  | { type: "opened"; kind: string }
  | { type: "closed"; kind: string }
  // Settings, by a connection's ID.
  | { type: "nameTyped"; connection: string; name: string }
  | {
      type: "configured";
      connection: string;
      options: Record<string, unknown>;
      // What changed, in words, and the option the person changed.
      what: string;
      field: string;
    }
  | { type: "choicesAsked"; connection: string; query: string }
  | { type: "undoClicked"; connection: string }
  | { type: "disconnectClicked"; connection: string }
  | { type: "disconnectAnswered"; connection: string; yes: boolean };

// The folder step's kind (decision 0049), which names the step, not a
// source.
export const folderStep = "folder" as const;
export type FolderKind = typeof folderStep;

export const loadConnections: Effect = get("/api/connections", { kind: "connections" });

export function initConnections(): ConnectionsModel {
  return { view: null, syncing: [], problems: {}, forms: {}, settings: {} };
}

export const blankForm: ConnectForm = {
  open: false,
  step: 0,
  typed: {},
  choices: null,
  more: false,
  query: "",
  picked: null,
  pending: null,
  tried: null,
  problem: null,
  fields: [],
};

const blankSetting: ConnectionSetting = {
  name: null,
  choices: null,
  more: false,
  query: "",
  pending: false,
  said: null,
  problem: null,
  disconnect: null,
};

// The open connections, as the sidebar lists them.
export const openConnections = (model: ConnectionsModel): ConnectionView[] =>
  (model.view?.connections ?? []).filter((connection) => connection.state === "open");

// A kind's open connection, its first.
export const openOf = (model: ConnectionsModel, kind: string): ConnectionView | null =>
  openConnections(model).find((connection) => connection.kind === kind) ?? null;

export const formOf = (model: ConnectionsModel, kind: string): ConnectForm =>
  model.forms[kind] ?? blankForm;

export const settingOf = (model: ConnectionsModel, id: string): ConnectionSetting =>
  model.settings[id] ?? blankSetting;

// Whether a fields step has every field typed.
export const typedAll = (form: ConnectForm, step: ConnectStep): boolean =>
  step.kind !== "fields" || step.fields.every((field) => (form.typed[field.name] ?? "").trim());

// The step a connector's form is on.
export const stepOf = (steps: readonly ConnectStep[], form: ConnectForm): ConnectStep | null =>
  steps[Math.min(form.step, steps.length - 1)] ?? null;

// The choice the person picked, as the list showed it.
export const pickedChoice = (form: ConnectForm): PickChoiceView | null =>
  form.choices?.find((choice) => choice.value === (form.tried ?? form.picked)) ?? null;

// The connectors the first run offers, in their declared order.
export const offered = (connectors: Connectors): ConnectorView[] =>
  Object.values(connectors)
    .filter((connector) => connector.connect?.offer.firstRun !== undefined)
    .toSorted((a, b) => (a.connect?.offer.firstRun ?? 0) - (b.connect?.offer.firstRun ?? 0));

// What a connector's first run row is doing: read, reading, failed, or
// nothing yet. One with a pick step fails in a box with Try again; another
// says why in a line.
export function connectState(
  model: ConnectionsModel,
  kind: string,
): "read" | "reading" | "failed" | null {
  if (openOf(model, kind)) return "read";
  const form = formOf(model, kind);
  if (form.pending === "connecting" || form.pending === "choosing") return "reading";
  return form.problem !== null && form.tried !== null ? "failed" : null;
}

const withForm = (
  model: ConnectionsModel,
  kind: string,
  form: ConnectForm,
  effects: Effect[] = [],
): [ConnectionsModel, Effect[]] => [{ ...model, forms: { ...model.forms, [kind]: form } }, effects];

const withSetting = (
  model: ConnectionsModel,
  id: string,
  setting: ConnectionSetting,
  effects: Effect[] = [],
): [ConnectionsModel, Effect[]] => [
  { ...model, settings: { ...model.settings, [id]: setting } },
  effects,
];

// The given across the steps up to the pick step: what was typed.
const listing = (kind: string, form: ConnectForm): Effect =>
  post(
    "/api/connections/pick",
    { kind, given: form.typed, query: form.query },
    {
      kind: "connectChoices",
      of: kind,
    },
  );

// What the steps gave, with the pick, connected.
const connecting = (kind: string, steps: readonly ConnectStep[], form: ConnectForm): Effect => {
  const pick = steps.find((step) => step.kind === "pick");
  const given =
    pick?.kind === "pick" && form.tried !== null
      ? { ...form.typed, [pick.field]: form.tried }
      : form.typed;
  return post("/api/connections", { kind, given }, { kind: "connected", of: kind });
};

export function updateConnections(
  model: ConnectionsModel,
  msg: ConnectionsMsg,
): [ConnectionsModel, Effect[]] {
  switch (msg.type) {
    case "syncClicked":
    case "syncAllClicked":
      return syncing(model, msg);
    case "fieldChanged": {
      const form = formOf(model, msg.kind);
      return withForm(model, msg.kind, {
        ...form,
        typed: { ...form.typed, [msg.field]: msg.value },
        fields: form.fields.filter((field) => field !== msg.field),
      });
    }
    case "nextClicked": {
      const form = formOf(model, msg.kind);
      const step = stepOf(msg.steps, form);
      if (form.pending || !step || !typedAll(form, step)) return [model, []];
      const next = msg.steps[form.step + 1];
      const asked = { ...form, query: "", pending: null, problem: null, fields: [] };
      if (next?.kind === "pick")
        return withForm(model, msg.kind, { ...asked, pending: "listing" }, [
          listing(msg.kind, asked),
        ]);
      const tried = { ...asked, pending: "connecting" as const, tried: "" };
      return withForm(model, msg.kind, tried, [connecting(msg.kind, msg.steps, tried)]);
    }
    case "queryChanged": {
      const form = { ...formOf(model, msg.kind), query: msg.query };
      return withForm(model, msg.kind, { ...form, pending: "listing", problem: null }, [
        listing(msg.kind, form),
      ]);
    }
    case "choicePicked":
      return withForm(model, msg.kind, { ...formOf(model, msg.kind), picked: msg.value });
    case "connectClicked": {
      const form = formOf(model, msg.kind);
      if (form.pending || form.picked === null) return [model, []];
      const tried = { ...form, pending: "connecting" as const, tried: form.picked, problem: null };
      return withForm(model, msg.kind, tried, [connecting(msg.kind, msg.steps, tried)]);
    }
    case "chooseClicked": {
      const form = formOf(model, msg.kind);
      if (form.pending) return [model, []];
      return withForm(model, msg.kind, { ...form, pending: "choosing", tried: "", problem: null }, [
        post(
          "/api/connections/picker",
          { kind: msg.kind },
          { kind: "connectPicked", of: msg.kind },
        ),
      ]);
    }
    case "backClicked": {
      const form = formOf(model, msg.kind);
      return withForm(model, msg.kind, {
        ...form,
        step: Math.max(form.step - 1, 0),
        choices: null,
        picked: null,
        problem: null,
      });
    }
    case "opened":
      return withForm(model, msg.kind, { ...formOf(model, msg.kind), open: true });
    case "closed":
      return withForm(model, msg.kind, blankForm);
    case "nameTyped":
      return withSetting(model, msg.connection, {
        ...settingOf(model, msg.connection),
        name: msg.name,
      });
    case "configured": {
      const setting = settingOf(model, msg.connection);
      if (setting.pending) return [model, []];
      return withSetting(
        model,
        msg.connection,
        {
          ...setting,
          pending: true,
          problem: null,
          said: { what: msg.what, field: msg.field, undo: null },
        },
        [
          post(
            `/api/connections/${msg.connection}/options`,
            { options: msg.options },
            { kind: "configured", connection: msg.connection },
          ),
        ],
      );
    }
    case "choicesAsked": {
      const setting = { ...settingOf(model, msg.connection), query: msg.query };
      return withSetting(model, msg.connection, setting, [
        post(
          `/api/connections/${msg.connection}/pick`,
          { query: msg.query },
          { kind: "connectionChoices", connection: msg.connection },
        ),
      ]);
    }
    case "undoClicked": {
      const setting = settingOf(model, msg.connection);
      if (setting.pending || !setting.said?.undo) return [model, []];
      const { input } = setting.said.undo as { input: unknown };
      return withSetting(model, msg.connection, { ...setting, pending: true, problem: null }, [
        post("/api/actions/source.configure", input, {
          kind: "configureUndone",
          connection: msg.connection,
        }),
      ]);
    }
    case "disconnectClicked":
      return withSetting(model, msg.connection, {
        ...settingOf(model, msg.connection),
        disconnect: "asked",
        problem: null,
      });
    case "disconnectAnswered": {
      const setting = settingOf(model, msg.connection);
      if (!msg.yes) return withSetting(model, msg.connection, { ...setting, disconnect: null });
      if (setting.disconnect !== "asked") return [model, []];
      return withSetting(model, msg.connection, { ...setting, disconnect: "disconnecting" }, [
        post(
          `/api/connections/${msg.connection}/disconnect`,
          {},
          { kind: "disconnected", connection: msg.connection },
        ),
      ]);
    }
  }
}

function syncing(
  model: ConnectionsModel,
  msg: Extract<ConnectionsMsg, { type: "syncClicked" | "syncAllClicked" }>,
): [ConnectionsModel, Effect[]] {
  const open = openConnections(model);
  const ids =
    msg.type === "syncAllClicked"
      ? open.map((connection) => connection.id)
      : open.some((connection) => connection.id === msg.connection)
        ? [msg.connection]
        : [];
  const asked = ids.filter((id) => !model.syncing.includes(id));
  if (asked.length === 0) return [model, []];
  const problems = Object.fromEntries(
    Object.entries(model.problems).filter(([id]) => !asked.includes(id)),
  );
  return [
    { ...model, syncing: [...model.syncing, ...asked], problems },
    asked.map((id) =>
      post(`/api/connections/${id}/sync`, {}, { kind: "sourceSynced", connection: id }),
    ),
  ];
}

// A reply about connections. `synced` says the index changed, so what's on
// screen, and the list itself, should load again; `connected`, the kind a
// connect just made.
export function connectionsReplied(
  model: ConnectionsModel,
  msg: Replied,
): { model: ConnectionsModel; synced: boolean } {
  const { tag } = msg;
  switch (tag.kind) {
    case "connections":
      return {
        model: msg.ok ? { ...model, view: msg.body as ConnectionsView } : model,
        synced: false,
      };
    case "sourceSynced": {
      const syncing = model.syncing.filter((id) => id !== tag.connection);
      if (!msg.ok)
        return {
          model: {
            ...model,
            syncing,
            problems: { ...model.problems, [tag.connection]: errorOf(msg.body) },
          },
          synced: false,
        };
      return { model: { ...model, syncing }, synced: true };
    }
    case "connectChoices": {
      const form = formOf(model, tag.of);
      if (!msg.ok) {
        const { fields } = (msg.body ?? {}) as { fields?: string[] };
        const failed = { ...form, pending: null, problem: errorOf(msg.body), fields: fields ?? [] };
        return { model: withForm(model, tag.of, failed)[0], synced: false };
      }
      const { choices, more } = msg.body as { choices: PickChoiceView[]; more: boolean };
      // The likeliest is the one changed last, which the list puts first.
      const picked = choices.some((choice) => choice.value === form.picked)
        ? form.picked
        : (choices[0]?.value ?? null);
      const step = form.choices === null ? form.step + 1 : form.step;
      return {
        model: withForm(model, tag.of, { ...form, step, pending: null, choices, more, picked })[0],
        synced: false,
      };
    }
    case "connected":
    case "connectPicked": {
      const form = formOf(model, tag.of);
      if (!msg.ok)
        return {
          model: withForm(model, tag.of, { ...form, pending: null, problem: errorOf(msg.body) })[0],
          synced: false,
        };
      // Cancelled in the system's picker: nothing changed.
      if (!("connection" in (msg.body as object)))
        return { model: withForm(model, tag.of, { ...form, pending: null })[0], synced: false };
      // Once connected, nothing typed is kept, and the connection shows at
      // once, until the list loads again.
      const { connection } = msg.body as { connection: ConnectionView };
      const formed = withForm(model, tag.of, blankForm)[0];
      return { model: { ...formed, view: withConnection(formed.view, connection) }, synced: true };
    }
    case "configured":
    case "configureUndone": {
      const setting = settingOf(model, tag.connection);
      const body = (msg.body ?? {}) as { undo?: unknown; problem?: string };
      if (!msg.ok)
        return {
          model: withSetting(model, tag.connection, {
            ...setting,
            pending: false,
            said: null,
            problem: errorOf(msg.body),
          })[0],
          synced: false,
        };
      // Its Undo stays beside it, the more so when the options set don't
      // fit the source, so one click puts the old ones back.
      const said =
        tag.kind === "configured" && setting.said && body.undo
          ? { ...setting.said, undo: body.undo }
          : null;
      return {
        model: withSetting(model, tag.connection, {
          ...setting,
          name: null,
          pending: false,
          said,
          problem: body.problem ?? null,
        })[0],
        synced: true,
      };
    }
    case "connectionChoices": {
      const setting = settingOf(model, tag.connection);
      if (!msg.ok)
        return {
          model: withSetting(model, tag.connection, { ...setting, problem: errorOf(msg.body) })[0],
          synced: false,
        };
      const { choices, more } = msg.body as { choices: PickChoiceView[]; more: boolean };
      return {
        model: withSetting(model, tag.connection, { ...setting, choices, more, problem: null })[0],
        synced: false,
      };
    }
    case "disconnected": {
      const setting = settingOf(model, tag.connection);
      if (!msg.ok)
        return {
          model: withSetting(model, tag.connection, {
            ...setting,
            disconnect: null,
            problem: errorOf(msg.body),
          })[0],
          synced: false,
        };
      const settings = Object.fromEntries(
        Object.entries(model.settings).filter(([id]) => id !== tag.connection),
      );
      return { model: { ...model, settings }, synced: true };
    }
    default:
      return { model, synced: false };
  }
}

// The list with a connection the server just gave, in place of the one with
// its ID or another of its kind it took the place of.
function withConnection(
  view: ConnectionsView | null,
  connection: ConnectionView,
): ConnectionsView | null {
  if (view === null) return null;
  const others = view.connections.filter(
    (each) =>
      each.id !== connection.id && !(each.kind === connection.kind && each.state === "open"),
  );
  return { ...view, connections: [...others, connection] };
}

// What a source's last sync changed, as its row says it: only the counts
// that aren't zero, such as "3 new · 1 changed". Null when it changed
// nothing.
export function syncChanges(counts: ConnectionView["lastSync"]): string | null {
  const said = [
    counts.new && `${counts.new} new`,
    counts.changed && `${counts.changed} changed`,
    counts.removed && `${counts.removed} removed`,
  ].filter(Boolean);
  return said.length ? said.join(" · ") : null;
}

// The sources folded to one line: how many, when the longest ago of them
// last synced, and whether any is syncing or has a problem.
export function sourcesLine(model: ConnectionsModel): {
  count: number;
  syncedAt: string | null;
  syncing: boolean;
  problem: boolean;
} {
  const view = openConnections(model);
  const times = view.map((connection) => connection.syncedAt);
  return {
    count: view.length,
    // A source never synced makes the whole line "not synced yet".
    syncedAt: times.some((at) => at === null) ? null : (times.toSorted()[0] ?? null),
    syncing: model.syncing.length > 0,
    problem: view.some((connection) => model.problems[connection.id] !== undefined),
  };
}

// A connection that read nothing, which the window says, so an empty window
// doesn't look as if it isn't connected: only once a sync has read it, as
// before that, Oriel doesn't know it's empty.
export const emptyConnections = (model: ConnectionsModel): ConnectionView[] =>
  openConnections(model).filter(
    (connection) => connection.items === 0 && connection.syncedAt !== null,
  );
