// Every connection in the window (decision 0049), as the server lists them,
// read once and shared by the sidebar, the first run, the overview and
// Settings: syncing any of them, or all, on demand; making one through its
// connector's steps, which the page draws from its declaration, the same way
// for every connector; and, in Settings, setting one's options and
// disconnecting it. A connection's review step, its mapping, is the same
// wherever it shows: the person edits it there, and it applies as their own
// action (OA-232). A sync that fails keeps what the window had, and says why
// on its connection until its next sync works. Nothing typed into a
// connector's steps stays in the page once its connection is made.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { Connectors } from "./connectors.ts";
import type {
  ConnectionsView,
  ConnectionView,
  ConnectorView,
  ConnectStep,
  OptionsReviewView,
  PickChoiceView,
  ReviewEdit,
  ReviewRedrawn,
} from "./view.ts";

// One connector's steps as the person goes through them: the step showing,
// by its place; what they typed; the pick step's list once the source gave
// it, which `more` says is longer, and `query` narrowed; the one picked;
// what's being asked of the server: the list, the folder picker,
// or the connection; what the last connect tried, for its progress and Try
// again; and why the last step didn't work, with the fields it named.
// `open`: shown in Settings' Add a connection, until it's made or cancelled.
// `signIn`: a browser step's sign-in, begun, by the source's page and the ID
// that finishes it. `made`: the connection made, while its review step
// shows, until its options apply.
export type ConnectForm = {
  open: boolean;
  step: number;
  typed: Readonly<Record<string, string>>;
  choices: PickChoiceView[] | null;
  more: boolean;
  query: string;
  picked: string | null;
  signIn: { url: string; attempt: string } | null;
  made: string | null;
  pending: "listing" | "choosing" | "starting" | "connecting" | "applying" | null;
  tried: string | null;
  problem: string | null;
  fields: readonly string[];
};

// One connection in Settings: its name as typed and not yet set; its pick
// step's list, once asked for; whether a change is on its way, and what the
// last one changed, by the option it changed, with its Undo; why it didn't
// work, or why the options it set don't fit the source; why its review step
// couldn't read the source; and Disconnect, asked and then answered.
export type ConnectionSetting = {
  name: string | null;
  choices: PickChoiceView[] | null;
  more: boolean;
  query: string;
  pending: boolean;
  said: { what: string; field: string; undo: unknown } | null;
  problem: string | null;
  unread: string | null;
  disconnect: "asked" | "disconnecting" | null;
};

// A review step's draft as the person edits it: the agent's held draft it
// began as, by where it's held, or null for Oriel's guess or the options the
// connection has; then as the server last drew it with their edits; and
// whether an edit is on its way. `only`: the one table edited by hand in
// Settings, by its place (OA-232).
export type ReviewEditing = {
  held: { thread: string; seq: number } | null;
  only: string | null;
  redrawn: ReviewRedrawn;
  pending: boolean;
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
  // Each waiting connection's review step, by its ID, as the server last
  // drew it (decision 0051).
  reviews: Readonly<Record<string, OptionsReviewView>>;
  // Each review step the person is editing, by its connection's ID.
  edits: Readonly<Record<string, ReviewEditing>>;
  // A kind being turned on or off now, and why the last turning didn't
  // work (decision 0059).
  switching: string | null;
  switchProblem: string | null;
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
  // A browser step showing, which begins its sign-in; and its link to the
  // source's page followed, which connects once the person finishes there.
  | { type: "browserShown"; kind: string }
  | { type: "browserOpened"; kind: string; steps: readonly ConnectStep[] }
  // A review step's draft, read again while the agent drafts; and applied:
  // the agent's, held in its thread, or Oriel's guess.
  | { type: "reviewAsked"; kind: string; connection: string; fresh?: true }
  // In Settings, one of a connection's tables: edited by hand, or asked of
  // Oriel in the window chat, by its place (OA-232).
  | { type: "handEditClicked"; kind: string; connection: string; tab: string }
  | { type: "askOrielClicked"; connection: string; tab: string }
  // In Settings, `beside` names the option it sets, where its Undo shows.
  | { type: "reviewApplied"; kind: string; connection: string; beside?: string }
  // A review step edited: begun from what it shows, one change made, which
  // the server draws again, or left as it was.
  | { type: "reviewEditClicked"; connection: string }
  | { type: "reviewEdited"; connection: string; edit: ReviewEdit }
  | { type: "reviewEditCancelled"; connection: string }
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
  | { type: "choicesAsked"; connection: string; query: string; field?: string }
  | { type: "undoClicked"; connection: string }
  | { type: "disconnectClicked"; connection: string }
  | { type: "disconnectAnswered"; connection: string; yes: boolean }
  // Source servers (decision 0059): a kind turned on, through the server
  // Oriel found for it, or off; the overview's card dismissed; Oriel's look
  // at the agent's servers asked for again; and how often sync runs.
  | { type: "kindSwitched"; kind: string; on: boolean; server?: string }
  | { type: "foundDismissed" }
  | { type: "serversLookAsked" }
  | { type: "serversSyncPicked"; every: number | null };

// The folder step's kind (decision 0049), which names the step, not a
// source.
export const folderStep = "folder" as const;
export type FolderKind = typeof folderStep;

export const loadConnections: Effect = get("/api/connections", { kind: "connections" });

// Oriel's look at the person's servers, again, as Sync asks (decision 0059).
export const lookForServers: Effect = post("/api/servers/look", {}, { kind: "connections" });

export function initConnections(): ConnectionsModel {
  return {
    view: null,
    syncing: [],
    problems: {},
    forms: {},
    settings: {},
    reviews: {},
    edits: {},
    switching: null,
    switchProblem: null,
  };
}

export const blankForm: ConnectForm = {
  open: false,
  step: 0,
  typed: {},
  choices: null,
  more: false,
  query: "",
  picked: null,
  signIn: null,
  made: null,
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
  unread: null,
  disconnect: null,
};

// What a connection's review step shows, as its draft in its connector's
// form: the agent's, else Oriel's guess, else the options it reads with now.
export const reviewShown = (
  review: OptionsReviewView,
): { held: { thread: string; seq: number } | null; given: Record<string, unknown> } | null =>
  review.draft
    ? { held: { thread: review.draft.thread, seq: review.draft.seq }, given: review.draft.given }
    : review.guess
      ? { held: null, given: review.guess.given }
      : review.current
        ? { held: null, given: review.current.given }
        : null;

// Whether an edited review step may apply now: the agent's draft once it
// settles; anything else once it settles into options, which it doesn't
// before a change.
export const appliesEdited = (editing: ReviewEditing): boolean =>
  !editing.pending &&
  editing.redrawn.problem === null &&
  (editing.held !== null || editing.redrawn.options !== null);

const withEditing = (
  model: ConnectionsModel,
  id: string,
  editing: ReviewEditing | null,
): ConnectionsModel => {
  const { [id]: _was, ...edits } = model.edits;
  return { ...model, edits: editing ? { ...edits, [id]: editing } : edits };
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

// The kinds the window doesn't offer to connect, as another does their
// work (decision 0059): those a stand-in on now stands in for, and, while
// one of a stand-in's kinds is open, as through its source server, the
// others it stands in for: one of them is the person's already. One that's
// open itself is never among them, so its row still shows it connected.
export const replacedKinds = (connectors: Connectors, model: ConnectionsModel): Set<string> =>
  new Set(
    [
      ...standingIn(connectors, model).flatMap(({ standIn }) => standIn.for),
      ...Object.values(connectors).flatMap(({ standIn }) =>
        standIn?.for.some((kind) => openOf(model, kind)) ? standIn.for : [],
      ),
    ].filter((kind) => !openOf(model, kind)),
  );

// The connectors the first run offers, in their declared order: none
// another does the work of (`replacedKinds`).
export const offered = (connectors: Connectors, model: ConnectionsModel): ConnectorView[] => {
  const replaced = replacedKinds(connectors, model);
  const off = turnedOff(model);
  return Object.values(connectors)
    .filter((connector) => connector.connect?.offer.firstRun !== undefined)
    .filter((connector) => !replaced.has(connector.kind) && !off.includes(connector.kind))
    .toSorted((a, b) => (a.connect?.offer.firstRun ?? 0) - (b.connect?.offer.firstRun ?? 0));
};

// The kinds a person or the agent turned off (decision 0059): nothing of
// them shows, not even greyed out.
export const turnedOff = (model: ConnectionsModel): string[] =>
  (model.view?.servers.kinds ?? []).flatMap((each) => (each.offBy === null ? [] : [each.kind]));

// The stand-ins on now, each with what it stands in for and its offer.
export const standingIn = (
  connectors: Connectors,
  model: ConnectionsModel,
): (ConnectorView & { standIn: NonNullable<ConnectorView["standIn"]> })[] =>
  (model.view?.standingIn ?? []).flatMap((kind) => {
    const connector = connectors[kind];
    return connector?.standIn ? [{ ...connector, standIn: connector.standIn }] : [];
  });

// What a connector's first run row is doing: read, reading, its options
// under review, failed, or nothing yet. One with a pick step fails in a box
// with Try again; another says why in a line.
export function connectState(
  model: ConnectionsModel,
  kind: string,
): "read" | "reading" | "review" | "failed" | null {
  if (openOf(model, kind)) return "read";
  if (formOf(model, kind).made !== null) return "review";
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

// How often a review step asks again while the agent drafts.
export const reviewEveryMs = 1500;

const reviewing = (kind: string, connection: string, fresh = false): Effect =>
  get(`/api/connections/${connection}/review${fresh ? "?fresh=1" : ""}`, {
    kind: "reviewed",
    of: kind,
    connection,
  });

// What Settings' Ask Oriel tells a person who has no AI to ask.
export const noAiToAsk = "Set up your AI to ask Oriel, or edit by hand.";

// A connect's tag, with where its review step is, if it has one, which a
// connection that waits for its options goes on to.
const connectedTag = (kind: string, steps: readonly ConnectStep[]) => {
  const review = steps.findIndex((step) => step.kind === "review");
  return { kind: "connected" as const, of: kind, ...(review >= 0 ? { review } : {}) };
};

// What the steps gave, with the pick, connected.
const connecting = (kind: string, steps: readonly ConnectStep[], form: ConnectForm): Effect => {
  const pick = steps.find((step) => step.kind === "pick");
  const given =
    pick?.kind === "pick" && form.tried !== null
      ? { ...form.typed, [pick.field]: form.tried }
      : form.typed;
  return post("/api/connections", { kind, given }, connectedTag(kind, steps));
};

export function updateConnections(
  model: ConnectionsModel,
  msg: ConnectionsMsg,
): [ConnectionsModel, Effect[]] {
  switch (msg.type) {
    // A Sync looks for the person's servers again too (decision 0059).
    case "syncClicked":
    case "syncAllClicked": {
      const [next, effects] = syncing(model, msg);
      return [next, [...effects, lookForServers]];
    }
    case "serversLookAsked":
      return [model, [lookForServers]];
    case "foundDismissed":
      return [
        model.view
          ? { ...model, view: { ...model.view, servers: { ...model.view.servers, card: null } } }
          : model,
        [post("/api/servers/dismiss", {}, { kind: "connections" })],
      ];
    case "kindSwitched": {
      if (model.switching !== null) return [model, []];
      const input = { kind: msg.kind, ...(msg.server ? { server: msg.server } : {}) };
      return [
        { ...model, switching: msg.kind, switchProblem: null },
        [
          post(`/api/actions/source.${msg.on ? "on" : "off"}`, input, {
            kind: "kindSwitched",
            of: msg.kind,
          }),
        ],
      ];
    }
    case "serversSyncPicked":
      return [model, [post("/api/settings", { sourceSync: msg.every }, { kind: "serversSync" })]];
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
    case "browserShown": {
      const form = formOf(model, msg.kind);
      if (form.pending || form.signIn) return [model, []];
      return withForm(model, msg.kind, { ...form, pending: "starting", problem: null }, [
        post(
          "/api/connections/browser",
          { kind: msg.kind },
          { kind: "browserBegun", of: msg.kind },
        ),
      ]);
    }
    case "browserOpened": {
      const form = formOf(model, msg.kind);
      if (form.pending || !form.signIn) return [model, []];
      const tried = { ...form, pending: "connecting" as const, tried: "", problem: null };
      return withForm(model, msg.kind, tried, [
        post(
          "/api/connections",
          { kind: msg.kind, given: { attempt: form.signIn.attempt } },
          connectedTag(msg.kind, msg.steps),
        ),
      ]);
    }
    case "reviewAsked":
      return [model, [reviewing(msg.kind, msg.connection, msg.fresh)]];
    case "reviewApplied": {
      const form = formOf(model, msg.kind);
      const review = model.reviews[msg.connection];
      const editing = model.edits[msg.connection];
      // The connect steps' own review step, or Settings' (OA-232).
      const connecting = form.made === msg.connection;
      const setting = settingOf(model, msg.connection);
      if ((connecting ? form.pending : setting.pending) || !review) return [model, []];
      const tag = {
        kind: "reviewApplied" as const,
        of: msg.kind,
        connection: msg.connection,
        ...(msg.beside ? { beside: msg.beside } : {}),
      };
      // In Settings, only the option it sets, merged over the rest as they
      // are then, so a switch changed meanwhile stays as it was set.
      const options = (options: Record<string, unknown> | null) =>
        post(
          `/api/connections/${msg.connection}/options`,
          { options: msg.beside ? { [msg.beside]: options?.[msg.beside] } : options },
          tag,
        );
      const held = (at: { thread: string; seq: number }, edited?: Record<string, unknown>) =>
        post(
          `/api/threads/${at.thread}/held/${at.seq}/apply`,
          edited ? { edit: { options: edited } } : {},
          tag,
        );
      // Edited, the agent's draft applies as edited, in its own form;
      // anything else, as the options it settles into.
      const applying = editing
        ? appliesEdited(editing)
          ? editing.held
            ? held(editing.held, editing.redrawn.given)
            : options(editing.redrawn.options)
          : null
        : review.draft
          ? held(review.draft)
          : review.guess
            ? options(review.guess.options)
            : null;
      if (!applying) return [model, []];
      if (connecting)
        return withForm(model, msg.kind, { ...form, pending: "applying", problem: null }, [
          applying,
        ]);
      const said = msg.beside ? { what: "its mapping", field: msg.beside, undo: null } : null;
      return withSetting(
        model,
        msg.connection,
        { ...setting, pending: true, problem: null, said },
        [applying],
      );
    }
    case "handEditClicked":
      return [
        withEditing(model, msg.connection, null),
        [
          get(`/api/connections/${msg.connection}/review?tab=${encodeURIComponent(msg.tab)}`, {
            kind: "reviewed",
            of: msg.kind,
            connection: msg.connection,
            tab: msg.tab,
          }),
        ],
      ];
    case "askOrielClicked": {
      const setting = settingOf(model, msg.connection);
      if (setting.pending) return [model, []];
      return withSetting(model, msg.connection, { ...setting, problem: null }, [
        post(
          `/api/connections/${msg.connection}/draft`,
          { tab: msg.tab },
          { kind: "orielAsked", connection: msg.connection },
        ),
      ]);
    }
    case "reviewEditClicked": {
      const review = model.reviews[msg.connection];
      const shown = review && reviewShown(review);
      if (!review || !shown || model.edits[msg.connection]) return [model, []];
      const begun = review.draft ?? review.guess ?? review.current;
      const redrawn: ReviewRedrawn = {
        given: shown.given,
        tables: begun?.tables ?? [],
        // Nothing to apply until something changes, but a draft or a guess
        // applies as it is.
        options: review.guess && !shown.held ? review.guess.options : null,
        said: review.draft?.said ?? review.guess?.said ?? [],
        problem: null,
      };
      return [
        withEditing(model, msg.connection, {
          held: shown.held,
          only: null,
          redrawn,
          pending: false,
        }),
        [],
      ];
    }
    case "reviewEdited": {
      const editing = model.edits[msg.connection];
      if (!editing || editing.pending) return [model, []];
      return [
        withEditing(model, msg.connection, { ...editing, pending: true }),
        [
          post(
            `/api/connections/${msg.connection}/review`,
            { given: editing.redrawn.given, edit: msg.edit },
            { kind: "reviewRedrawn", connection: msg.connection },
          ),
        ],
      ];
    }
    case "reviewEditCancelled":
      return [withEditing(model, msg.connection, null), []];
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
          { query: msg.query, ...(msg.field ? { field: msg.field } : {}) },
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
  // A stand-in's items are Oriel's own: nothing syncs them.
  const open = openConnections(model).filter((connection) => !connection.own);
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
): { model: ConnectionsModel; synced: boolean; effects?: Effect[] } {
  const { tag } = msg;
  switch (tag.kind) {
    case "browserBegun": {
      const form = formOf(model, tag.of);
      const begun = msg.ok
        ? { ...form, pending: null, signIn: msg.body as { url: string; attempt: string } }
        : { ...form, pending: null, problem: errorOf(msg.body) };
      return { model: withForm(model, tag.of, begun)[0], synced: false };
    }
    // Its onboarding turn started, or none could: its review asks either way.
    case "onboarded":
      return { model, synced: false, effects: [reviewing(tag.of, tag.connection)] };
    case "reviewed": {
      if (!msg.ok) {
        // In its connect steps, or Settings' (OA-232).
        const form = formOf(model, tag.of);
        const problem = errorOf(msg.body);
        return {
          model:
            form.made === tag.connection
              ? withForm(model, tag.of, { ...form, problem })[0]
              : withSetting(model, tag.connection, {
                  ...settingOf(model, tag.connection),
                  unread: problem,
                })[0],
          synced: false,
        };
      }
      const review = msg.body as OptionsReviewView;
      const reviews = { ...model.reviews, [tag.connection]: review };
      // Asked to edit one table by hand: its editor opens on it, as it reads.
      const hand: ReviewEditing | null =
        "tab" in tag && tag.tab !== undefined && review.current
          ? {
              held: null,
              only: tag.tab,
              pending: false,
              redrawn: {
                given: review.current.given,
                tables: review.current.tables,
                options: null,
                said: [],
                problem: null,
              },
            }
          : null;
      const unread = model.settings[tag.connection]?.unread ?? null;
      const settings =
        unread === null
          ? model.settings
          : {
              ...model.settings,
              [tag.connection]: { ...settingOf(model, tag.connection), unread: null },
            };
      const form = formOf(model, tag.of);
      // Its options applied elsewhere, as in the window chat: done here too.
      const done = !review.waits && form.made === tag.connection;
      const next = {
        ...(hand ? withEditing(model, tag.connection, hand) : model),
        reviews,
        settings,
        ...(done ? { forms: { ...model.forms, [tag.of]: blankForm } } : {}),
      };
      return {
        model: next,
        synced: done,
        effects:
          review.drafting && form.made === tag.connection
            ? [
                {
                  type: "after",
                  ms: reviewEveryMs,
                  msg: {
                    type: "connections",
                    msg: { type: "reviewAsked", kind: tag.of, connection: tag.connection },
                  },
                },
              ]
            : [],
      };
    }
    case "reviewApplied": {
      const form = formOf(model, tag.of);
      // The connect steps' own review step, or Settings' (OA-232), which
      // says what it set beside the option, with its Undo, or what went
      // wrong.
      const connecting = form.made === tag.connection;
      const body = (msg.body ?? {}) as {
        connection?: ConnectionView;
        problem?: string;
        undo?: unknown;
      };
      const said = (problem: string | null) => {
        if (connecting) return withForm(model, tag.of, { ...form, pending: null, problem })[0];
        const setting = settingOf(model, tag.connection);
        const undo =
          msg.ok && setting.said && body.undo ? { ...setting.said, undo: body.undo } : null;
        return withSetting(model, tag.connection, {
          ...setting,
          pending: false,
          said: msg.ok ? undo : null,
          problem,
        })[0];
      };
      if (!msg.ok) return { model: said(errorOf(msg.body)), synced: false };
      // Applied, but its first sync says what didn't fit: still to review.
      const applied = withEditing(said(body.problem ?? null), tag.connection, null);
      if (body.problem)
        return { model: applied, synced: true, effects: [reviewing(tag.of, tag.connection)] };
      const formed = connecting ? withForm(applied, tag.of, blankForm)[0] : applied;
      return {
        model: body.connection
          ? { ...formed, view: withConnection(formed.view, body.connection) }
          : formed,
        synced: true,
      };
    }
    // Asked in the window chat: the overview opens on it. With no AI to ask,
    // the person is told to edit it by hand.
    case "orielAsked": {
      const setting = settingOf(model, tag.connection);
      const thread = msg.ok ? (msg.body as { thread: string | null }).thread : null;
      if (thread === null)
        return {
          model: withSetting(model, tag.connection, {
            ...setting,
            problem: msg.ok ? noAiToAsk : errorOf(msg.body),
          })[0],
          synced: false,
        };
      return {
        model,
        synced: false,
        effects: [
          { type: "navigate", route: { page: "overview" } },
          { type: "after", ms: 0, msg: { type: "chat", msg: { type: "openClicked" } } },
        ],
      };
    }
    case "reviewRedrawn": {
      const editing = model.edits[tag.connection];
      if (!editing) return { model, synced: false };
      // A change refused keeps the draft as it was, and says why.
      const redrawn = msg.ok
        ? (msg.body as ReviewRedrawn)
        : { ...editing.redrawn, problem: errorOf(msg.body) };
      return {
        model: withEditing(model, tag.connection, { ...editing, redrawn, pending: false }),
        synced: false,
      };
    }
    case "connections":
      return {
        model: msg.ok ? { ...model, view: msg.body as ConnectionsView } : model,
        synced: false,
      };
    // What's on changed, so what the window shows did, and the list.
    case "kindSwitched":
      return {
        model: {
          ...model,
          switching: null,
          switchProblem: msg.ok ? null : errorOf(msg.body),
        },
        synced: msg.ok,
      };
    case "serversSync":
      return { model, synced: false, effects: [loadConnections] };
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
      // A sign-in finishes once, so another begins on Try again.
      if (!msg.ok)
        return {
          model: withForm(model, tag.of, {
            ...form,
            pending: null,
            signIn: null,
            problem: errorOf(msg.body),
          })[0],
          synced: false,
        };
      // Cancelled in the system's picker: nothing changed.
      if (!("connection" in (msg.body as object)))
        return { model: withForm(model, tag.of, { ...form, pending: null })[0], synced: false };
      // Once connected, nothing typed is kept, and the connection shows at
      // once, until the list loads again. One that waits for its options
      // goes on to its review step, and its onboarding turn starts.
      const { connection } = msg.body as { connection: ConnectionView };
      const review = "review" in tag ? tag.review : undefined;
      const next =
        review !== undefined && connection.state === "waiting"
          ? { ...blankForm, open: form.open, step: review, made: connection.id }
          : blankForm;
      // What a sync asked for before said is past: this connect read it.
      const { [connection.id]: _past, ...problems } = model.problems;
      const formed = withForm({ ...model, problems }, tag.of, next)[0];
      return {
        model: { ...formed, view: withConnection(formed.view, connection) },
        synced: true,
        effects:
          next.made === null
            ? []
            : [
                post(
                  `/api/connections/${connection.id}/draft`,
                  {},
                  { kind: "onboarded", of: tag.of, connection: connection.id },
                ),
              ],
      };
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
  syncable: number;
  syncedAt: string | null;
  syncing: boolean;
  problem: boolean;
} {
  const view = openConnections(model);
  // A stand-in's items are Oriel's own, so it never syncs (decision 0059).
  const syncable = view.filter((connection) => !connection.own);
  const times = syncable.map((connection) => connection.syncedAt);
  return {
    count: view.length,
    syncable: syncable.length,
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
