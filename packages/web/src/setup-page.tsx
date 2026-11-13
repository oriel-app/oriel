import type { ComponentChildren } from "preact";
import { ClaudeCodeRow, CodexRow } from "./cli-row.tsx";
import {
  type ConnectionsMsg,
  connectState,
  folderStep,
  formOf,
  offered,
  standingIn,
  openOf,
} from "./connections.ts";
import { ServerPicks } from "./connections-page.tsx";
import { FoundRows } from "./found.tsx";
import { type Dispatch, Mark, plural } from "./parts.tsx";
import type { Model } from "./root.ts";
import type { SetupMsg, SetupScreen } from "./setup.ts";

export function SetupPage(props: { model: Model; dispatch: Dispatch }) {
  const { model, dispatch } = props;
  const { setup } = model;
  const send = (msg: SetupMsg) => dispatch({ type: "setup", msg });
  const show = (screen: SetupScreen) => send({ type: "screenShown", screen });
  const step = ["ai", "other-ways"].includes(setup.screen) ? 1 : 2;
  return (
    <div class="setup-page">
      <header class="setup-brand">
        <Mark />
        Oriel
      </header>
      <div class="frame" aria-hidden="true" />
      <main class="setup" aria-busy={setup.view === null}>
        <Steps current={step} aiDone={setup.view?.firstRun?.steps.ai != null} />
        {setup.view === null ? (
          <p class="setup-lede">{setup.problem ?? "Looking for Claude Code on this Mac…"}</p>
        ) : setup.screen === "ai" ? (
          <YourAi model={model} send={send} show={show} />
        ) : setup.screen === "other-ways" ? (
          <OtherWays model={model} send={send} show={show} dispatch={dispatch} />
        ) : setup.screen === "found" ? (
          <Found model={model} dispatch={dispatch} show={show} />
        ) : (
          <YourWork model={model} dispatch={dispatch} send={send} />
        )}
        {setup.problem && setup.view !== null && (
          <p class="setup-problem" role="alert">
            {setup.problem}
          </p>
        )}
      </main>
    </div>
  );
}

function Steps(props: { current: 1 | 2; aiDone: boolean }) {
  const step = (n: 1 | 2, name: string, done: boolean) => (
    <li
      class="setup-step"
      aria-current={props.current === n ? "step" : undefined}
      data-done={done || undefined}
    >
      <span class="setup-step-mark" aria-hidden="true">
        {done ? "✓" : n}
      </span>
      {name}
    </li>
  );
  return (
    <ol class="setup-steps" aria-label="Setup">
      {step(1, "Your AI", props.current === 2 && props.aiDone)}
      {step(2, "Your work", false)}
    </ol>
  );
}

function Foot(props: { children: ComponentChildren; links?: ComponentChildren }) {
  return (
    <footer class="setup-foot">
      <div class="setup-links">{props.links}</div>
      {props.children}
    </footer>
  );
}

const link = (label: string, onClick: () => void, disabled = false) => (
  <button type="button" class="link-action" disabled={disabled} onClick={onClick}>
    {label}
  </button>
);

function YourAi(props: { model: Model; send(msg: SetupMsg): void; show(s: SetupScreen): void }) {
  const { model, send, show } = props;
  const { setup } = model;
  const view = setup.view;
  const claude = view?.providers.find((p) => p.kind === "claude-code");
  const codex = view?.providers.find((p) => p.kind === "codex");
  const cli = view?.cli;
  const codexCli = view?.codex ?? null;
  const ready = cli?.state === "ready";
  const missing = cli?.state === "missing";
  const ai = ready ? "claude-code" : codexCli?.state === "ready" ? "codex" : null;
  const name = ai === "codex" ? "Codex" : "Claude Code";
  const tested = ai === "codex" ? codexCli?.failed?.what === "test" : cli?.failed?.what === "test";
  const explain = missing || cli?.state === "checking";
  return (
    <>
      <h1 class="setup-title">Set up the AI Oriel uses</h1>
      <p class="setup-lede">
        {`Oriel answers your questions and drafts changes through Claude, on the Claude plan you already pay for. Nothing changes in ${changesIn(model)} until you approve it.`}
      </p>
      <ul class="provider-rows setup-rows">
        {claude && cli && (
          <ClaudeCodeRow
            provider={claude}
            cli={cli}
            model={setup}
            send={send}
            picked={ai === "claude-code"}
            onOtherWays={() => show("other-ways")}
          />
        )}
        {codex && codexCli && (
          <CodexRow
            provider={codex}
            cli={codexCli}
            model={setup}
            send={send}
            picked={ai === "codex"}
          />
        )}
      </ul>
      {explain && (
        <p class="setup-note">
          Oriel can't use claude.ai in your browser, so it works through Claude Code, Anthropic's
          free assistant for your Mac, which uses the same plan. Oriel installs it for you: no admin
          password, and nothing outside your own folder.
        </p>
      )}
      {codex && missing && ai !== "codex" ? (
        <p class="setup-note">
          With a ChatGPT plan, sign in to Codex above and Oriel runs on it, as a preview.
        </p>
      ) : (
        !codex &&
        missing && (
          <p class="setup-note">
            Only have ChatGPT? Oriel runs on Codex, OpenAI's assistant, as a preview once it's on
            this Mac.
          </p>
        )
      )}
      <Foot
        links={link("Set up later", () => send({ type: "skipClicked", step: "ai" }), setup.sending)}
      >
        <button
          type="button"
          class="button primary setup-next"
          disabled={ai === null || setup.sending || tested}
          onClick={() =>
            send({ type: "continueClicked", ...(ai === "codex" ? { ai: "codex" as const } : {}) })
          }
        >
          {setup.testing
            ? `Checking that ${name} answers…`
            : ai
              ? `Continue with ${name}`
              : "Continue"}
        </button>
      </Foot>
    </>
  );
}

function OtherWays(props: {
  model: Model;
  send(msg: SetupMsg): void;
  show(s: SetupScreen): void;
  dispatch: Dispatch;
}) {
  const { model, send, show } = props;
  const cli = model.setup.view?.cli;
  const install = cli?.state === "missing" || cli?.failed?.what === "install";
  const line = install ? "curl -fsSL https://claude.ai/install.sh | bash" : "claude auth login";
  const log = cli?.failed?.log ?? [];
  return (
    <>
      <h1 class="setup-title">
        {install ? "Install Claude Code yourself" : "Sign in to Claude Code yourself"}
      </h1>
      <p class="setup-lede">
        Only if {install ? "installing" : "signing in"} from Oriel keeps failing. Terminal is the
        Mac's app for typing commands; this one line starts Anthropic's own{" "}
        {install ? "installer" : "sign-in"} and changes nothing else.
      </p>
      <ol class="setup-card setup-terminal">
        <li>
          Open Terminal: press <strong>⌘ Space</strong>, type <strong>Terminal</strong>, and press{" "}
          <strong>Return</strong>.
        </li>
        <li>
          Copy this line, paste it into Terminal, and press <strong>Return</strong>:
          <span class="setup-command">
            <code>{line}</code>
            <button
              type="button"
              class="button"
              onClick={() => send({ type: "lineCopied", text: line })}
            >
              Copy
            </button>
          </span>
        </li>
        {install ? (
          <li>
            When it says <strong>Installation complete</strong>, come back here and check again.
          </li>
        ) : (
          <>
            <li>
              Your browser opens claude.ai. Sign in and click <strong>Authorize</strong>. If the
              page shows a code, copy it into Terminal and press <strong>Return</strong>.
            </li>
            <li>
              When Terminal says <strong>Login successful</strong>, come back here.
            </li>
          </>
        )}
      </ol>
      {log.length > 0 && (
        <p class="setup-note">
          Rather not? Send{" "}
          {link("what Oriel tried", () =>
            send({
              type: "detailsCopied",
              text: log.join("\n"),
              what: install ? "install" : "sign-in",
            }),
          )}{" "}
          to whoever helps you with your Mac.
        </p>
      )}
      <Foot links={link("Back", () => show("ai"))}>
        <button
          type="button"
          class="button primary setup-next"
          disabled={model.setup.sending}
          onClick={() => {
            send({ type: "commandClicked", command: "check" });
            show("ai");
          }}
        >
          Check again
        </button>
      </Foot>
    </>
  );
}

const changesIn = (model: Model) =>
  [
    ...standingIn(model.connectors, model.connections).map(({ standIn }) => standIn.offer.changes),
    ...offered(model.connectors, model.connections).map((connector) => connector.offer?.changes),
  ].join(" or ");

function SourceRow(props: {
  id?: string;
  mark: string;
  name: string;
  about: string;
  state?: ComponentChildren;
  side?: ComponentChildren;
  children?: ComponentChildren;
}) {
  return (
    <li class="provider-row">
      <span class="provider-icon" aria-hidden="true">
        {props.mark}
      </span>
      <div class="provider-main">
        <span class="provider-name" id={props.id && `${props.id}-name`}>
          {props.name}
        </span>
        <span class="provider-about" id={props.id && `${props.id}-about`}>
          {props.about}
        </span>
        {props.state}
        {props.children}
      </div>
      {props.side && <div class="provider-side">{props.side}</div>}
    </li>
  );
}

const ready = (text: string) => (
  <span class="provider-status" data-connected>
    <span class="provider-mark" aria-hidden="true" />
    <span class="provider-state">Ready</span>
    <span>· {text}</span>
  </span>
);

const connected = (text: string) => (
  <span class="provider-status" data-connected>
    <span class="provider-mark" aria-hidden="true" />
    <span class="provider-state">Connected</span>
    <span>· {text}</span>
  </span>
);

function sourceOf(model: Model, kind: string) {
  const connector = model.connectors[kind];
  const offer = connector?.offer;
  if (!connector || !offer) return null;
  const first = connector.connect?.steps[0];
  return {
    connector,
    offer,
    form: formOf(model.connections, kind),
    chooses: first?.kind === folderStep ? first : null,
    open: openOf(model.connections, kind),
    waits:
      model.connections.view?.connections.some(
        (each) => each.kind === kind && each.state === "waiting",
      ) ?? false,
    state: connectState(model.connections, kind),
  };
}
function Found(props: { model: Model; dispatch: Dispatch; show(s: SetupScreen): void }) {
  const { model, dispatch, show } = props;
  const servers = model.connections.view?.servers ?? null;
  const agent = servers?.agent ?? "your AI";
  const sendConnections = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const picking = (model.connections.view?.connections ?? [])
    .filter(
      (each) =>
        each.through !== null && each.picks.length > 0 && each.state !== "shut" && !each.flagged,
    )
    .toSorted(
      (a, b) =>
        (servers?.found.findIndex((each) => each.kind === a.kind) ?? 0) -
        (servers?.found.findIndex((each) => each.kind === b.kind) ?? 0),
    );
  return (
    <>
      <h1 class="setup-title">See what Oriel found</h1>
      <p class="setup-lede">
        Oriel reads your work through the MCP servers already in {agent}. It never adds or signs in
        to one; turn on what you want Oriel to read.
      </p>
      {servers?.noAgent && !servers.looking ? (
        <p class="setup-lede">
          No AI is on, so Oriel can't look for your servers yet. Set up your AI in Settings, under
          Providers.
        </p>
      ) : servers === null || (servers.looking && servers.found.length === 0) ? (
        <p class="cli-line cli-waiting" role="status">
          <span class="spinner" aria-hidden="true" />
          Looking in {agent}…
        </p>
      ) : servers.found.length > 0 ? (
        <>
          <FoundRows
            found={servers.found}
            connections={model.connections}
            connectors={model.connectors}
            dispatch={dispatch}
          />
          {picking.map((connection) => (
            <section
              key={connection.id}
              class="found-picks"
              aria-label={`What Oriel reads of ${model.connectors[connection.kind]?.name ?? connection.kind}`}
            >
              <ServerPicks
                connection={connection}
                connections={model.connections}
                send={sendConnections}
                of={model.connectors[connection.kind]?.name ?? connection.kind}
              />
            </section>
          ))}
        </>
      ) : (
        <p class="setup-lede">
          Oriel didn't find a server it knows in {agent}. You can add one later, in {agent}.
        </p>
      )}
      {servers?.problem && (
        <p class="setup-problem" role="alert">
          {servers.problem}
        </p>
      )}
      {Object.entries(model.connections.switchProblems).map(([kind, problem]) => (
        <p key={kind} class="setup-problem" role="alert">
          {problem}
        </p>
      ))}
      {servers && !servers.noAgent && servers.missing.length > 0 && (
        <ul class="found-missing" aria-label={`Not found in ${agent}`}>
          {servers.missing.map((each) => (
            <li key={each.kind}>
              {model.connectors[each.kind]?.name ?? each.kind}: add {each.server} to {agent}.{" "}
              <a href={each.instructions} target="_blank" rel="noreferrer">
                How to add it
              </a>
            </li>
          ))}
        </ul>
      )}
      <Foot>
        <button
          type="button"
          class="button primary setup-next"
          onClick={() => {
            // Seen here, so the overview's card doesn't say it again.
            if (servers?.card) sendConnections({ type: "foundDismissed" });
            show("work");
          }}
        >
          Continue
        </button>
      </Foot>
    </>
  );
}

type Source = NonNullable<ReturnType<typeof sourceOf>>;

const sources = (model: Model): Source[] =>
  offered(model.connectors, model.connections).flatMap(
    (connector) => sourceOf(model, connector.kind) ?? [],
  );

function YourWork(props: { model: Model; dispatch: Dispatch; send(msg: SetupMsg): void }) {
  const { model, dispatch, send } = props;
  const { setup } = model;
  const sendConnections = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const servers = model.connections.view?.servers ?? null;
  const agent = servers?.agent ?? "your AI";
  const all = sources(model);
  const standing = standingIn(model.connectors, model.connections);
  const shown = new Set([
    ...standing.map((each) => each.kind),
    ...all.map((source) => source.connector.kind),
  ]);
  const others = [
    ...(servers?.found ?? []).map((each) => each.kind),
    ...(servers?.missing ?? []).map((each) => each.kind),
  ].filter((kind, at, kinds) => !shown.has(kind) && kinds.indexOf(kind) === at);
  const unserved = (missing: { server: string; instructions: string }) =>
    servers?.noAgent ? (
      <span class="cli-line">
        No AI is on to read it.{" "}
        {link("Set up your AI", () => send({ type: "screenShown", screen: "ai" }))}
      </span>
    ) : (
      <span class="cli-line">
        Add {missing.server} to {agent} to see it here.{" "}
        <a href={missing.instructions} target="_blank" rel="noreferrer">
          How to add it
        </a>
      </span>
    );
  const turnOn = (kind: string, name: string, server: string) => (
    <button
      type="button"
      class="button"
      disabled={model.connections.switches[kind] !== undefined}
      onClick={() => sendConnections({ type: "kindSwitched", kind, on: true, server })}
    >
      {model.connections.switches[kind] ? "Turning on…" : `Turn on ${name}`}
    </button>
  );
  const anything = standing.length > 0 || all.some((source) => source.state === "read");
  const ai = setup.view?.firstRun?.steps.ai;
  return (
    <>
      <h1 class="setup-title">{setup.resumed ? "Welcome back" : "See your work in one place"}</h1>
      <p class="setup-lede">
        {setup.resumed
          ? `${ai === "done" ? "Your AI is set up. " : ""}See your work to finish; Oriel picked up where you left off.`
          : `Oriel shows it all in one place and keeps it on this Mac. Only what a question needs goes to your AI. Nothing changes in ${changesIn(model)} until you approve it.`}
      </p>
      <ul class="provider-rows setup-rows">
        {standing.map(({ kind, standIn: { offer } }) => (
          <SourceRow
            key={kind}
            mark={offer.mark}
            name={offer.title}
            about={offer.about}
            state={ready(offer.ready)}
            side={null}
          />
        ))}
        {all.map((source) => {
          const { connector, offer, form, chooses, open, state, waits } = source;
          const found = servers?.found.find((each) => each.kind === connector.kind && !each.on);
          const missing = servers?.missing.find((each) => each.kind === connector.kind);
          return (
            <SourceRow
              key={connector.kind}
              mark={offer.mark}
              name={offer.title}
              about={offer.about}
              state={
                state === "read" && open ? (
                  connected(
                    [open.reads, plural(open.items, offer.counts)].filter(Boolean).join(" · "),
                  )
                ) : state === "reading" && chooses ? (
                  <span class="cli-line cli-waiting" role="status">
                    <span class="spinner" aria-hidden="true" />
                    {chooses.waiting}
                  </span>
                ) : waits ? (
                  <span class="cli-line">
                    Oriel waits for how to read it. Review that in Settings, under Connections.
                  </span>
                ) : !chooses && missing ? (
                  unserved(missing)
                ) : null
              }
              side={
                chooses
                  ? state !== "reading" && (
                      <button
                        type="button"
                        class="button"
                        onClick={() =>
                          sendConnections({ type: "chooseClicked", kind: connector.kind })
                        }
                      >
                        {open ? chooses.another : chooses.choose}
                      </button>
                    )
                  : found && !open && !waits
                    ? turnOn(connector.kind, connector.name, found.server)
                    : null
              }
            >
              {state === "failed" && (
                <p class="connect-problem" role="alert">
                  {form.problem}
                </p>
              )}
            </SourceRow>
          );
        })}
        {others.map((kind) => {
          const connector = model.connectors[kind];
          const name = connector?.name ?? kind;
          const found = servers?.found.find((each) => each.kind === kind);
          const missing = servers?.missing.find((each) => each.kind === kind);
          const open = openOf(model.connections, kind);
          return (
            <SourceRow
              key={kind}
              mark={connector?.offer?.mark ?? name.charAt(0)}
              name={name}
              about={`Through ${found?.known ?? missing?.server ?? "its MCP server"}`}
              state={
                open ? connected(plural(open.items, "item")) : missing ? unserved(missing) : null
              }
              side={found && !found.on ? turnOn(kind, name, found.server) : null}
            />
          );
        })}
      </ul>
      <Foot
        links={!anything && link("Skip for now", () => send({ type: "skipClicked", step: "work" }))}
      >
        <button
          type="button"
          class="button primary setup-next"
          disabled={!anything || setup.finishing}
          onClick={() => send({ type: "workDone" })}
        >
          Continue
        </button>
      </Foot>
    </>
  );
}
