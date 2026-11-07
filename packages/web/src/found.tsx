// What Oriel found in the person's agent (decision 0059), wherever it shows:
// the overview's card when it changes, the first run's "see what Oriel
// found", and Settings' Source servers. Each found server Oriel knows says
// what it would turn on, with a click to turn that on; only a person turns
// one on. Oriel never adds, removes, signs in or signs out of a server, so
// nothing here does: a kind with none found names the server that would
// turn it on, and links to its vendor's own instructions.
import { type ConnectionsModel, type ConnectionsMsg, turnedOff } from "./connections.ts";
import type { Connectors } from "./connectors.ts";
import type { Dispatch } from "./parts.tsx";
import { Switch } from "./provider-row.tsx";
import { Choices } from "./settings-page.tsx";
import type { FoundServerView, SourceServersView } from "./view.ts";

const nameOf = (connectors: Connectors, kind: string) => connectors[kind]?.name ?? kind;
const markOf = (connectors: Connectors, kind: string) =>
  connectors[kind]?.connect?.offer.mark ??
  connectors[kind]?.standIn?.offer.mark ??
  nameOf(connectors, kind).charAt(0);

// "your agent" until Oriel has asked one.
const agentOf = (servers: SourceServersView) => servers.agent ?? "your agent";

// Found servers, each with what it turns on: a button while its kind is
// off, and "On" once it is.
export function FoundRows(props: {
  found: readonly FoundServerView[];
  connections: ConnectionsModel;
  connectors: Connectors;
  dispatch: Dispatch;
}) {
  const { connections, connectors, dispatch } = props;
  const send = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  return (
    <ul class="found-rows">
      {props.found.map((each) => {
        const kind = nameOf(connectors, each.kind);
        return (
          <li key={`${each.kind}:${each.server}`} class="found-row">
            <span class="provider-icon" aria-hidden="true">
              {markOf(connectors, each.kind)}
            </span>
            <span class="found-what">
              <span class="found-server">{each.server}</span>
              <span class="found-turns">
                {each.known} · turns on {kind}
              </span>
            </span>
            {each.on ? (
              <span class="found-on">On</span>
            ) : (
              <button
                type="button"
                class="button"
                disabled={connections.switching !== null}
                onClick={() =>
                  send({ type: "kindSwitched", kind: each.kind, on: true, server: each.server })
                }
              >
                Turn on {kind}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// The overview's card, once what Oriel finds in the agent changes: what
// appeared, with a click to turn each on, and what went. Dismissed, it
// doesn't come back for the same change.
export function FoundCard(props: {
  connections: ConnectionsModel;
  connectors: Connectors;
  dispatch: Dispatch;
}) {
  const { connections, connectors, dispatch } = props;
  const servers = connections.view?.servers;
  const card = servers?.card;
  if (!servers || !card) return null;
  const send = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const agent = agentOf(servers);
  return (
    <section class="found-card" aria-labelledby="found-card-title">
      <h2 id="found-card-title">
        {card.appeared.length > 0
          ? `Oriel found ${card.appeared.length === 1 ? "a source server" : "source servers"} in ${agent}`
          : `A source server went from ${agent}`}
      </h2>
      {card.appeared.length > 0 && (
        <>
          <p class="connect-note">
            Turned on, Oriel reads that source through it. Nothing turns on until you say.
          </p>
          <FoundRows
            found={card.appeared}
            connections={connections}
            connectors={connectors}
            dispatch={dispatch}
          />
        </>
      )}
      {card.gone.map((each) => (
        <p key={`${each.kind}:${each.server}`} class="connect-note">
          {each.on
            ? `${each.server} isn't in ${agent} any more. ${nameOf(connectors, each.kind)} stays on.`
            : `${each.server} isn't in ${agent} any more, so ${nameOf(connectors, each.kind)} is off until it's back.`}
        </p>
      ))}
      {connections.switchProblem && (
        <p class="connection-problem" role="alert">
          {connections.switchProblem}
        </p>
      )}
      <div class="found-actions">
        <button type="button" class="quiet-action" onClick={() => send({ type: "foundDismissed" })}>
          Dismiss
        </button>
      </div>
    </section>
  );
}

// How often sync runs, by minutes.
const syncChoices: { value: string; label: string }[] = [
  { value: "open", label: "When Oriel opens, and when you press Sync" },
  { value: "15", label: "Every 15 minutes" },
  { value: "60", label: "Every hour" },
];

// Settings' Source servers: the person's servers that Oriel knows, each
// with its kind and a switch; each kind on through its own connection, or
// turned off; for each kind with none found, the server that would turn it
// on; and how often sync runs.
export function SourceServers(props: {
  connections: ConnectionsModel;
  connectors: Connectors;
  dispatch: Dispatch;
}) {
  const { connections, connectors, dispatch } = props;
  const servers = connections.view?.servers;
  if (!servers) return null;
  const send = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const agent = agentOf(servers);
  const off = turnedOff(connections);
  // Every kind with a row: those on or turned off, then those a server
  // found would turn on.
  const rows = [
    ...servers.kinds.map((each) => ({
      kind: each.kind,
      on: each.on,
      server: each.server,
      problem: each.problem ?? null,
      about:
        each.offBy !== null
          ? `Off${each.offBy === "agent" ? ", as you asked Oriel" : ""}. Its items stay in Oriel for when it's on again.`
          : each.server !== null
            ? `Through ${each.server} in ${agent}`
            : "Through its own connection",
    })),
    ...servers.found
      .filter((each) => !servers.kinds.some((kind) => kind.kind === each.kind))
      .map((each) => ({
        kind: each.kind,
        on: false,
        server: each.server,
        problem: null,
        about: `${each.known}, found in ${agent} as ${each.server}`,
      })),
  ];
  const every = servers.sync.every;
  return (
    <section class="settings-section" aria-labelledby="settings-source-servers">
      <h2 id="settings-source-servers" class="settings-title">
        Source servers
      </h2>
      <p class="settings-lede">
        Oriel reads your sources through the MCP servers in {agent}. It never adds, removes or signs
        in to one: you do that in {agent}.
      </p>
      {servers.problem && (
        <p class="connection-problem" role="alert">
          {servers.problem}
        </p>
      )}
      {connections.switchProblem && (
        <p class="connection-problem" role="alert">
          {connections.switchProblem}
        </p>
      )}
      {rows.length === 0 ? (
        <p class="settings-field-about">
          {servers.looking
            ? `Looking in ${agent}…`
            : `Oriel hasn't found a source server it knows in ${agent}.`}
        </p>
      ) : (
        <ul class="provider-rows">
          {rows.map((row) => {
            const name = nameOf(connectors, row.kind);
            return (
              <li key={row.kind} class="provider-row" data-status={row.on ? "ready" : undefined}>
                <span class="provider-icon" aria-hidden="true">
                  {markOf(connectors, row.kind)}
                </span>
                <div class="provider-main">
                  <span class="provider-name">{name}</span>
                  <span class="provider-about">{row.about}</span>
                  {row.problem && (
                    <p class="connection-problem" role="alert">
                      {row.problem}
                    </p>
                  )}
                </div>
                <div class="provider-side">
                  <Switch
                    on={row.on}
                    label={`${name} ${row.on ? "on" : "off"}`}
                    disabled={connections.switching !== null}
                    onChange={(on) =>
                      send({
                        type: "kindSwitched",
                        kind: row.kind,
                        on,
                        ...(on && row.server && !off.includes(row.kind)
                          ? { server: row.server }
                          : {}),
                      })
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {servers.missing.length > 0 && (
        <ul class="found-missing" aria-label={`Not found in ${agent}`}>
          {servers.missing.map((each) => (
            <li key={each.kind}>
              {nameOf(connectors, each.kind)}: add {each.server} to {agent}.{" "}
              <a href={each.instructions} target="_blank" rel="noreferrer">
                How to add it
              </a>
            </li>
          ))}
        </ul>
      )}
      <div class="cli-actions">
        <button
          type="button"
          class="button"
          disabled={servers.looking}
          onClick={() => send({ type: "serversLookAsked" })}
        >
          {servers.looking ? "Looking…" : "Look again"}
        </button>
      </div>
      <Choices
        name="Sync"
        group="settings-source-sync"
        about={
          servers.sync.plan
            ? `When Oriel reads your sources through ${agent}. On Claude Code, each sync spends a little of your plan.`
            : `When Oriel reads your sources through ${agent}.`
        }
        options={syncChoices}
        value={every === null ? "open" : String(every)}
        onPick={(value) =>
          send({ type: "serversSyncPicked", every: value === "open" ? null : Number(value) })
        }
      />
    </section>
  );
}
