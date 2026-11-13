import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { Connectors } from "./connectors.ts";
import type {
  ConnectionPick,
  ConnectionsView,
  ConnectionView,
  ConnectorView,
  ConnectStep,
  OptionField,
  OptionsReviewView,
  PickChoiceView,
  ReviewEdit,
  ReviewRedrawn,
} from "./view.ts";

export type ConnectForm = {
  open: boolean;
  step: number;
  typed: Readonly<Record<string, string>>;
  pending: "choosing" | "connecting" | null;
  tried: string | null;
  problem: string | null;
};

export type ConnectionSetting = {
  name: string | null;
  choices: PickChoiceView[] | null;
  more: boolean;
  query: string;
  listing: boolean;
  pending: boolean;
  said: { what: string; field: string; undo: unknown } | null;
  problem: string | null;
  unread: string | null;
  disconnect: "asked" | "disconnecting" | null;
};

export type ReviewEditing = {
  held: { thread: string; seq: number } | null;
  only: string | null;
  redrawn: ReviewRedrawn;
  pending: boolean;
};

export type ConnectionsModel = {
  view: ConnectionsView | null;
  syncing: readonly string[];
  problems: Readonly<Record<string, string>>;
  forms: Readonly<Record<string, ConnectForm>>;
  settings: Readonly<Record<string, ConnectionSetting>>;
  reviews: Readonly<Record<string, OptionsReviewView>>;
  edits: Readonly<Record<string, ReviewEditing>>;
  switches: Readonly<Record<string, KindSwitch>>;
  switchProblems: Readonly<Record<string, string>>;
};

// One turning a kind at a time: a later click waits for it and goes next.
export type KindSwitch = { on: boolean; sent: boolean; server?: string; loads: number | null };

export type ConnectionsMsg =
  | { type: "syncClicked"; connection: string }
  | { type: "syncAllClicked" }
  | { type: "fieldChanged"; kind: string; field: string; value: string }
  | { type: "nextClicked"; kind: string; steps: readonly ConnectStep[] }
  | { type: "chooseClicked"; kind: string }
  | { type: "reviewAsked"; kind: string; connection: string; fresh?: true }
  | { type: "handEditClicked"; kind: string; connection: string; tab: string }
  | { type: "askOrielClicked"; connection: string; tab: string }
  | { type: "reviewApplied"; kind: string; connection: string; beside?: string }
  | { type: "reviewEditClicked"; connection: string }
  | { type: "reviewEdited"; connection: string; edit: ReviewEdit }
  | { type: "reviewEditCancelled"; connection: string }
  | { type: "opened"; kind: string }
  | { type: "closed"; kind: string }
  | { type: "nameTyped"; connection: string; name: string }
  | {
      type: "configured";
      connection: string;
      options: Record<string, unknown>;
      what: string;
      field: string;
    }
  | { type: "choicesAsked"; connection: string; query: string; field?: string; opened?: true }
  | { type: "undoClicked"; connection: string }
  | { type: "disconnectClicked"; connection: string }
  | { type: "disconnectAnswered"; connection: string; yes: boolean }
  | { type: "kindSwitched"; kind: string; on: boolean; server?: string }
  | { type: "foundDismissed" }
  | { type: "serversLookAsked" }
  | { type: "serversSyncPicked"; every: number | null };

export const folderStep = "folder" as const;
export type FolderKind = typeof folderStep;

export const loadConnections: Effect = get("/api/connections", { kind: "connections" });

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
    switches: {},
    switchProblems: {},
  };
}

export const blankForm: ConnectForm = {
  open: false,
  step: 0,
  typed: {},
  pending: null,
  tried: null,
  problem: null,
};

const blankSetting: ConnectionSetting = {
  name: null,
  choices: null,
  more: false,
  query: "",
  listing: false,
  pending: false,
  said: null,
  problem: null,
  unread: null,
  disconnect: null,
};

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

export const openConnections = (model: ConnectionsModel): ConnectionView[] =>
  (model.view?.connections ?? []).filter((connection) => connection.state === "open");

export const openOf = (model: ConnectionsModel, kind: string): ConnectionView | null =>
  openConnections(model).find((connection) => connection.kind === kind) ?? null;

export const formOf = (model: ConnectionsModel, kind: string): ConnectForm =>
  model.forms[kind] ?? blankForm;

export const settingOf = (model: ConnectionsModel, id: string): ConnectionSetting =>
  model.settings[id] ?? blankSetting;

export const stepOf = (steps: readonly ConnectStep[], form: ConnectForm): ConnectStep | null =>
  steps[Math.min(form.step, steps.length - 1)] ?? null;

export function settableOf(
  connection: ConnectionView,
  connector: ConnectorView | undefined,
): { settable: boolean; mappings: Extract<OptionField, { kind: "mapping" }>[] } {
  const mappings = (connector?.options ?? []).filter(
    (field): field is Extract<OptionField, { kind: "mapping" }> => field.kind === "mapping",
  );
  const through = connection.through !== null;
  const settable =
    (connection.state === "open" || connection.state === "waiting") &&
    !connection.flagged &&
    !connection.own &&
    (!through || connection.picks.length > 0 || mappings.length > 0);
  const picked = connection.picks.every((pick) => pick.picked.length > 0);
  return { settable, mappings: settable && through && picked ? mappings : [] };
}

export function pickSaid(pick: ConnectionPick): { current: string; none: boolean; said: string } {
  const current = pick.many ? "" : (pick.picked[0] ?? "");
  const none = pick.picked.length === 0;
  return {
    current,
    none,
    said:
      none && pick.unpicked
        ? `Reading ${pick.unpicked}; pick yours.`
        : pick.many
          ? `${pick.picked.length} picked.`
          : current,
  };
}

export const replacedKinds = (connectors: Connectors, model: ConnectionsModel): Set<string> =>
  new Set(
    [
      ...standingIn(connectors, model).flatMap(({ standIn }) => standIn.for),
      ...Object.values(connectors).flatMap(({ standIn }) =>
        standIn?.for.some((kind) => openOf(model, kind)) ? standIn.for : [],
      ),
    ].filter((kind) => !openOf(model, kind)),
  );

export const offered = (connectors: Connectors, model: ConnectionsModel): ConnectorView[] => {
  const replaced = replacedKinds(connectors, model);
  const off = turnedOff(model);
  const turnable = new Set(
    (model.view?.servers.found ?? []).flatMap((each) => (each.on ? [] : [each.kind])),
  );
  return Object.values(connectors)
    .filter((connector) => connector.offer?.firstRun !== undefined)
    .filter(
      (connector) =>
        (!replaced.has(connector.kind) || turnable.has(connector.kind)) &&
        !off.includes(connector.kind),
    )
    .toSorted((a, b) => (a.offer?.firstRun ?? 0) - (b.offer?.firstRun ?? 0));
};

export const turnedOff = (model: ConnectionsModel): string[] =>
  (model.view?.servers.kinds ?? []).flatMap((each) => (each.offBy === null ? [] : [each.kind]));

export const standingIn = (
  connectors: Connectors,
  model: ConnectionsModel,
): (ConnectorView & { standIn: NonNullable<ConnectorView["standIn"]> })[] =>
  (model.view?.standingIn ?? []).flatMap((kind) => {
    const connector = connectors[kind];
    return connector?.standIn ? [{ ...connector, standIn: connector.standIn }] : [];
  });

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

export const reviewEveryMs = 1500;

const reviewing = (kind: string, connection: string, fresh = false): Effect =>
  get(`/api/connections/${connection}/review${fresh ? "?fresh=1" : ""}`, {
    kind: "reviewed",
    of: kind,
    connection,
  });

export const noAiToAsk = "Set up your AI to ask Oriel, or edit by hand.";

const onboarding = (kind: string, connection: string): Effect =>
  post(`/api/connections/${connection}/draft`, {}, { kind: "onboarded", of: kind, connection });

const turning = (kind: string, wanted: KindSwitch): Effect =>
  post(
    `/api/actions/source.${wanted.on ? "on" : "off"}`,
    { kind, ...(wanted.server ? { server: wanted.server } : {}) },
    { kind: "kindSwitched", of: kind },
  );

export const kindOn = (view: ConnectionsView | null, kind: string): boolean =>
  view?.servers.kinds.find((each) => each.kind === kind)?.on ?? false;

// A switch settles on the second load after its answer, as a load asked before the answer
// may have come after it.
function settled(
  switches: ConnectionsModel["switches"],
  view: ConnectionsView,
): ConnectionsModel["switches"] {
  return Object.fromEntries(
    Object.entries(switches).flatMap(([kind, each]) =>
      each.loads === null
        ? [[kind, each]]
        : kindOn(view, kind) === each.on || each.loads >= 1
          ? []
          : [[kind, { ...each, loads: each.loads + 1 }]],
    ),
  );
}

export const switchedOn = (model: ConnectionsModel, kind: string, listed: boolean): boolean =>
  model.switches[kind]?.on ?? listed;

export function updateConnections(
  model: ConnectionsModel,
  msg: ConnectionsMsg,
): [ConnectionsModel, Effect[]] {
  switch (msg.type) {
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
      const { [msg.kind]: _past, ...switchProblems } = model.switchProblems;
      const now = model.switches[msg.kind];
      const wanted: KindSwitch = {
        on: msg.on,
        sent: now?.sent ?? msg.on,
        ...(msg.server ? { server: msg.server } : {}),
        loads: null,
      };
      const switched = {
        ...model,
        switches: { ...model.switches, [msg.kind]: wanted },
        switchProblems,
      };
      if (now && now.loads === null) return [switched, []];
      return [
        {
          ...switched,
          switches: { ...switched.switches, [msg.kind]: { ...wanted, sent: msg.on } },
        },
        [turning(msg.kind, wanted)],
      ];
    }
    case "serversSyncPicked":
      return [model, [post("/api/settings", { sourceSync: msg.every }, { kind: "serversSync" })]];
    case "fieldChanged": {
      const form = formOf(model, msg.kind);
      return withForm(model, msg.kind, {
        ...form,
        typed: { ...form.typed, [msg.field]: msg.value },
      });
    }
    case "nextClicked": {
      const form = formOf(model, msg.kind);
      if (form.pending || !stepOf(msg.steps, form)) return [model, []];
      const tried = { ...form, pending: "connecting" as const, tried: "", problem: null };
      return withForm(model, msg.kind, tried, [
        post(
          "/api/connections",
          { kind: msg.kind, given: form.typed },
          { kind: "connected", of: msg.kind },
        ),
      ]);
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
    case "reviewAsked":
      return [model, [reviewing(msg.kind, msg.connection, msg.fresh)]];
    case "reviewApplied": {
      const review = model.reviews[msg.connection];
      const editing = model.edits[msg.connection];
      const setting = settingOf(model, msg.connection);
      if (setting.pending || !review) return [model, []];
      const tag = {
        kind: "reviewApplied" as const,
        of: msg.kind,
        connection: msg.connection,
        ...(msg.beside ? { beside: msg.beside } : {}),
      };
      // Only the option it sets, merged over the rest as they are then, so a switch changed
      // meanwhile stays as it was set.
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
      const asked = { ...settingOf(model, msg.connection), query: msg.query, listing: true };
      const setting = msg.opened ? { ...asked, choices: null, more: false } : asked;
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

export function connectionsReplied(
  model: ConnectionsModel,
  msg: Replied,
): { model: ConnectionsModel; synced: boolean; effects?: Effect[] } {
  const { tag } = msg;
  switch (tag.kind) {
    case "onboarded":
      return { model, synced: false, effects: [reviewing(tag.of, tag.connection)] };
    case "reviewed": {
      if (!msg.ok)
        return {
          model: withSetting(model, tag.connection, {
            ...settingOf(model, tag.connection),
            unread: errorOf(msg.body),
          })[0],
          synced: false,
        };
      const review = msg.body as OptionsReviewView;
      const reviews = { ...model.reviews, [tag.connection]: review };
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
      // Its options were applied elsewhere, as in the window chat, while it waited.
      const done = !review.waits && model.reviews[tag.connection]?.waits === true;
      const next = {
        ...(hand ? withEditing(model, tag.connection, hand) : model),
        reviews,
        settings,
      };
      return {
        model: next,
        synced: done,
        effects:
          review.waits && review.drafting
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
      const body = (msg.body ?? {}) as {
        connection?: ConnectionView;
        problem?: string;
        undo?: unknown;
      };
      const said = (problem: string | null) => {
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
      const applied = withEditing(said(body.problem ?? null), tag.connection, null);
      if (body.problem)
        return { model: applied, synced: true, effects: [reviewing(tag.of, tag.connection)] };
      return {
        model: body.connection
          ? { ...applied, view: withConnection(applied.view, body.connection) }
          : applied,
        synced: true,
      };
    }
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
      const redrawn = msg.ok
        ? (msg.body as ReviewRedrawn)
        : { ...editing.redrawn, problem: errorOf(msg.body) };
      return {
        model: withEditing(model, tag.connection, { ...editing, redrawn, pending: false }),
        synced: false,
      };
    }
    case "connections": {
      if (!msg.ok) return { model, synced: false };
      const view = msg.body as ConnectionsView;
      return { model: { ...model, view, switches: settled(model.switches, view) }, synced: false };
    }
    case "kindSwitched": {
      const now = model.switches[tag.of];
      const { [tag.of]: _done, ...others } = model.switches;
      if (!msg.ok)
        return {
          model: {
            ...model,
            switches: others,
            switchProblems: { ...model.switchProblems, [tag.of]: errorOf(msg.body) },
          },
          synced: false,
          effects: [loadConnections],
        };
      if (now && now.on !== now.sent)
        return {
          model: { ...model, switches: { ...others, [tag.of]: { ...now, sent: now.on } } },
          synced: true,
          effects: [turning(tag.of, now)],
        };
      return {
        model: now ? { ...model, switches: { ...others, [tag.of]: { ...now, loads: 0 } } } : model,
        synced: true,
      };
    }
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
    case "connected":
    case "connectPicked": {
      const form = formOf(model, tag.of);
      if (!msg.ok)
        return {
          model: withForm(model, tag.of, { ...form, pending: null, problem: errorOf(msg.body) })[0],
          synced: false,
        };
      if (!("connection" in (msg.body as object)))
        return { model: withForm(model, tag.of, { ...form, pending: null })[0], synced: false };
      const { connection } = msg.body as { connection: ConnectionView };
      const { [connection.id]: _past, ...problems } = model.problems;
      const formed = withForm({ ...model, problems }, tag.of, blankForm)[0];
      return {
        model: { ...formed, view: withConnection(formed.view, connection) },
        synced: true,
      };
    }
    case "configured":
    case "configureUndone": {
      const setting = settingOf(model, tag.connection);
      const body = (msg.body ?? {}) as {
        connection?: ConnectionView;
        undo?: unknown;
        problem?: string;
      };
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
        effects:
          tag.kind === "configured" &&
          body.connection?.state === "waiting" &&
          body.connection.through !== null
            ? [onboarding(body.connection.kind, body.connection.id)]
            : [],
      };
    }
    case "connectionChoices": {
      const setting = settingOf(model, tag.connection);
      if (!msg.ok)
        return {
          model: withSetting(model, tag.connection, {
            ...setting,
            listing: false,
            problem: errorOf(msg.body),
          })[0],
          synced: false,
        };
      const { choices, more } = msg.body as { choices: PickChoiceView[]; more: boolean };
      return {
        model: withSetting(model, tag.connection, {
          ...setting,
          choices,
          more,
          listing: false,
          problem: null,
        })[0],
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

export function syncChanges(counts: ConnectionView["lastSync"]): string | null {
  const said = [
    counts.new && `${counts.new} new`,
    counts.changed && `${counts.changed} changed`,
    counts.removed && `${counts.removed} removed`,
  ].filter(Boolean);
  return said.length ? said.join(" · ") : null;
}

export function sourcesLine(model: ConnectionsModel): {
  count: number;
  syncable: number;
  syncedAt: string | null;
  syncing: boolean;
  problem: boolean;
} {
  const view = openConnections(model);
  const syncable = view.filter((connection) => !connection.own);
  const times = syncable.map((connection) => connection.syncedAt);
  return {
    count: view.length,
    syncable: syncable.length,
    syncedAt: times.some((at) => at === null) ? null : (times.toSorted()[0] ?? null),
    syncing: model.syncing.length > 0,
    problem: view.some((connection) => model.problems[connection.id] !== undefined),
  };
}

export const emptyConnections = (model: ConnectionsModel): ConnectionView[] =>
  openConnections(model).filter(
    (connection) => connection.items === 0 && connection.syncedAt !== null,
  );
