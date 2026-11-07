// The desktop app's first run (decision 0038), on a page of its own: Your AI,
// then Your work, then reading it, then the overview. Each step has a way to
// set it up later. The words follow the prototype the walkthroughs read:
// plans before product names, what installs and where the work goes, what's
// happening while it does, and a failure that keeps its help on screen.
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { ClaudeCodeRow, CodexRow } from "./cli-row.tsx";
import { BrowserStep, FieldsStep, PickStep, readingName, ReviewStep } from "./connect-steps.tsx";
import {
  type ConnectionsMsg,
  connectState,
  folderStep,
  formOf,
  offered,
  standingIn,
  openOf,
  stepOf,
} from "./connections.ts";
import { type Dispatch, Mark, plural } from "./parts.tsx";
import type { Model } from "./root.ts";
import type { SetupMsg, SetupScreen } from "./setup.ts";

export function SetupPage(props: { model: Model; dispatch: Dispatch }) {
  const { model, dispatch } = props;
  const { setup } = model;
  const send = (msg: SetupMsg) => dispatch({ type: "setup", msg });
  const show = (screen: SetupScreen, kind?: string) =>
    send({ type: "screenShown", screen, ...(kind ? { kind } : {}) });
  const step = ["ai", "key", "other-ways"].includes(setup.screen) ? 1 : 2;
  return (
    <div class="setup-page">
      <header class="setup-brand">
        <Mark />
        Oriel
      </header>
      <div class="frame" aria-hidden="true" />
      <main class="setup" aria-busy={setup.view === null}>
        {setup.screen !== "reading" && (
          <Steps current={step} aiDone={setup.view?.firstRun?.steps.ai != null} />
        )}
        {setup.view === null ? (
          <p class="setup-lede">{setup.problem ?? "Looking for Claude Code on this Mac…"}</p>
        ) : setup.screen === "ai" ? (
          <YourAi model={model} send={send} show={show} />
        ) : setup.screen === "key" ? (
          <ApiKey model={model} send={send} show={show} />
        ) : setup.screen === "other-ways" ? (
          <OtherWays model={model} send={send} show={show} dispatch={dispatch} />
        ) : setup.screen === "connect" ? (
          <Connect model={model} dispatch={dispatch} show={show} />
        ) : setup.screen === "reading" ? (
          <Reading model={model} dispatch={dispatch} send={send} show={show} />
        ) : (
          <YourWork model={model} dispatch={dispatch} send={send} show={show} />
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
  // Claude Code is picked whenever it's ready; Codex, a preview, only when
  // it's the one ready (decision 0048).
  const ai = ready ? "claude-code" : codexCli?.state === "ready" ? "codex" : null;
  const name = ai === "codex" ? "Codex" : "Claude Code";
  const tested = ai === "codex" ? codexCli?.failed?.what === "test" : cli?.failed?.what === "test";
  // Why Claude Code, said only while it isn't on this Mac yet.
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
            onKey={() => show("key")}
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
            onKey={() => show("key")}
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
          With a ChatGPT plan, sign in to Codex above and Oriel runs on it, as a preview. Or{" "}
          {link("pay Anthropic per question", () => show("key"))}: nothing to install.
        </p>
      ) : (
        !codex &&
        missing && (
          <p class="setup-note">
            Only have ChatGPT? Oriel runs on Codex, OpenAI's assistant, as a preview once it's on
            this Mac. The shortest way in is to{" "}
            {link("pay Anthropic per question", () => show("key"))}: nothing to install.
          </p>
        )
      )}
      <Foot
        links={
          <>
            <span>
              No Claude plan? {link("Pay Anthropic per question instead", () => show("key"))}
            </span>
            {link("Set up later", () => send({ type: "skipClicked", step: "ai" }), setup.sending)}
          </>
        }
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

function ApiKey(props: { model: Model; send(msg: SetupMsg): void; show(s: SetupScreen): void }) {
  const { model, send, show } = props;
  const { setup } = model;
  return (
    <form
      class="setup-form"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: "keySaved" });
      }}
    >
      <h1 class="setup-title">Pay Anthropic per question</h1>
      <p class="setup-lede">
        Without a Claude plan, Oriel can use a key from Anthropic. Anthropic bills you for each
        question Oriel asks, and you can set a monthly limit there.
      </p>
      <div class="setup-card">
        <label class="connect-field">
          <span class="connect-label">API key</span>
          <input
            class="input"
            type="password"
            name="key"
            value={setup.key}
            placeholder="Paste it here"
            spellcheck={false}
            autoComplete="off"
            aria-invalid={setup.keyProblem ? true : undefined}
            onInput={(event) => send({ type: "keyTyped", text: event.currentTarget.value })}
          />
        </label>
        {setup.keyProblem && (
          <p class="connect-problem" role="alert">
            {setup.keyProblem}
          </p>
        )}
        <p class="cli-note">
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            Get a key from Anthropic
          </a>
          : make an account there (it's separate from claude.ai), add a card, click{" "}
          <strong>Create Key</strong>, and copy it.
        </p>
        <p class="cli-small">
          Oriel keeps it encrypted on this Mac and sends it only to Anthropic.
        </p>
      </div>
      <Foot links={link("Back", () => show("ai"))}>
        <button
          type="submit"
          class="button primary setup-next"
          disabled={setup.sending || setup.key.trim() === ""}
        >
          {setup.sending ? "Checking it with Anthropic…" : "Save and continue"}
        </button>
      </Foot>
    </form>
  );
}

// Claude Code's own way, in Terminal, written out step by step: only if
// Oriel's way keeps failing (decision 0038).
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
      <p class="setup-note">
        Rather not?{" "}
        {log.length > 0 && (
          <>
            Send{" "}
            {link("what Oriel tried", () =>
              send({
                type: "detailsCopied",
                text: log.join("\n"),
                what: install ? "install" : "sign-in",
              }),
            )}{" "}
            to whoever helps you with your Mac, or{" "}
          </>
        )}
        {link(
          log.length > 0
            ? "pay Anthropic per question instead"
            : "Pay Anthropic per question instead",
          () => show("key"),
        )}
        .
      </p>
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

// Where nothing changes until the person approves it, as each source the
// first run offers says it, joined with "or".
const changesIn = (model: Model) =>
  [
    ...standingIn(model.connectors, model.connections).map(({ standIn }) => standIn.offer.changes),
    ...offered(model.connectors, model.connections).map(
      (connector) => connector.connect?.offer.changes,
    ),
  ].join(" or ");

// A source as a row: its mark, name and what it brings, its state, and the
// one thing to do next.
function SourceRow(props: {
  // Ids the row's name and about take, `<id>-name` and `<id>-about`, for
  // what's in it to be labelled by them.
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

// A stand-in's, which is the person's already (decision 0059).
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

// One source the first run offers, as Your work and Reading your work draw
// it: its connector, its words, its steps and its state.
function sourceOf(model: Model, kind: string) {
  const connector = model.connectors[kind];
  const offer = connector?.connect?.offer;
  const steps = connector?.connect?.steps ?? [];
  if (!connector || !offer) return null;
  const form = formOf(model.connections, kind);
  return {
    connector,
    offer,
    steps,
    form,
    // A folder step is its first; one with a pick step reads what it picked;
    // one that signs in on its source's page waits there first, and one with
    // a review step shows it in its row once connected.
    chooses: steps[0]?.kind === folderStep ? steps[0] : null,
    picks: steps.some((step) => step.kind === "pick"),
    signsIn: steps.find((step) => step.kind === "browser") ?? null,
    reviews: steps.find((step) => step.kind === "review") ?? null,
    open: openOf(model.connections, kind),
    state: connectState(model.connections, kind),
  };
}
type Source = NonNullable<ReturnType<typeof sourceOf>>;

const sources = (model: Model): Source[] =>
  offered(model.connectors, model.connections).flatMap(
    (connector) => sourceOf(model, connector.kind) ?? [],
  );

function YourWork(props: {
  model: Model;
  dispatch: Dispatch;
  send(msg: SetupMsg): void;
  show(s: SetupScreen, kind?: string): void;
}) {
  const { model, dispatch, send, show } = props;
  const { setup } = model;
  const sendConnections = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const reading = setup.view?.firstRun?.reading ?? null;
  const all = sources(model);
  // A stand-in on is the person's work already (decision 0059).
  const standing = standingIn(model.connectors, model.connections);
  const anything =
    standing.length > 0 ||
    all.some(
      (source) =>
        source.state === "read" || (source.state === "reading" && source.chooses === null),
    );
  const ai = setup.view?.firstRun?.steps.ai;
  return (
    <>
      <h1 class="setup-title">
        {setup.resumed ? "Welcome back" : "Connect where your work lives"}
      </h1>
      <p class="setup-lede">
        {setup.resumed
          ? `${ai === "done" ? "Your AI is set up. " : ""}Connect your work to finish; Oriel picked up where you left off.`
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
          const { connector, offer, form, chooses, open, state, signsIn, reviews } = source;
          const unavailable = model.connections.view?.refused[connector.kind];
          return (
            <SourceRow
              key={connector.kind}
              mark={offer.mark}
              name={offer.title}
              about={offer.about}
              state={
                state === "read" && open ? (
                  connected(`${open.reads} · ${plural(open.items, offer.counts)}`)
                ) : state === "reading" && (chooses || signsIn?.kind === "browser") ? (
                  <span class="cli-line cli-waiting" role="status">
                    <span class="spinner" aria-hidden="true" />
                    {chooses?.waiting ?? (signsIn?.kind === "browser" ? signsIn.waiting : "")}
                  </span>
                ) : state === null && unavailable && !open ? (
                  <span class="cli-line">{unavailable}</span>
                ) : state === "reading" ? (
                  <ReadingLine
                    text={`Reading ${readingName(form) ?? offer.title}`}
                    read={reading?.read ?? 0}
                    total={reading?.total ?? null}
                    noun={offer.counts}
                  />
                ) : null
              }
              side={
                chooses ? (
                  state !== "reading" && (
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
                ) : state === null && !(unavailable && !open) ? (
                  <button
                    type="button"
                    class="button"
                    onClick={() => show("connect", connector.kind)}
                  >
                    Connect
                  </button>
                ) : null
              }
            >
              {state === "review" && reviews?.kind === "review" && (
                <ReviewStep
                  connector={connector}
                  step={reviews}
                  connection={form.made ?? ""}
                  review={model.connections.reviews[form.made ?? ""] ?? null}
                  editing={model.connections.edits[form.made ?? ""] ?? null}
                  pending={form.pending !== null}
                  problem={form.problem}
                  send={sendConnections}
                />
              )}
              <Failed source={source} model={model} dispatch={dispatch} send={send} show={show} />
            </SourceRow>
          );
        })}
      </ul>
      <Foot
        links={!anything && link("Skip for now", () => send({ type: "skipClicked", step: "work" }))}
      >
        <button
          type="button"
          class="button primary setup-next"
          disabled={!anything}
          onClick={() => send({ type: "workDone" })}
        >
          Continue
        </button>
      </Foot>
    </>
  );
}

// The bar is named by the line over it.
function ReadingLine(props: { text: string; read: number; total: number | null; noun: string }) {
  const { read, total } = props;
  const id = useId();
  return (
    <span class="setup-reading">
      <span class="cli-line" role="status" id={id}>
        {props.text}:{" "}
        {total !== null ? `${read} of ${plural(total, props.noun)}` : plural(read, props.noun)}
      </span>
      <progress
        class="setup-progress"
        max={total ?? undefined}
        value={total !== null ? read : undefined}
        aria-labelledby={id}
      />
    </span>
  );
}

// Why a source didn't connect. One with a pick step stopped in its first
// sync: what's known, Try again, Change, which goes back to its first step,
// and Copy details. Another says why in a line.
function Failed(props: {
  source: Source;
  model: Model;
  dispatch: Dispatch;
  send(msg: SetupMsg): void;
  show(s: SetupScreen, kind?: string): void;
}) {
  const { source, model, dispatch, send, show } = props;
  const { connector, offer, form, steps } = source;
  if (form.problem === null || source.state === "reading") return null;
  if (!source.picks || source.state !== "failed")
    return source.state === "read" || form.tried === null ? null : (
      <p class="connect-problem" role="alert">
        {form.problem}
      </p>
    );
  const reading = model.setup.view?.firstRun?.reading;
  const sendConnections = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  const stopped =
    reading?.stopped && reading.total !== null
      ? `Stopped after ${reading.read} of ${plural(reading.total, offer.counts)}: `
      : "";
  return (
    <div class="cli-box" data-tone="danger" role="alert">
      <p>
        <strong>
          {stopped}
          {form.problem}
        </strong>
      </p>
      <div class="cli-actions">
        <button
          type="button"
          class="button primary"
          onClick={() => sendConnections({ type: "connectClicked", kind: connector.kind, steps })}
        >
          Try again
        </button>
        <button
          type="button"
          class="button"
          onClick={() => {
            sendConnections({ type: "backClicked", kind: connector.kind });
            show("connect", connector.kind);
          }}
        >
          Change
        </button>
        <button
          type="button"
          class="button"
          onClick={() =>
            send({
              type: "detailsCopied",
              text: [
                `${offer.title} · ${form.tried ?? ""}`,
                `${stopped}${form.problem ?? ""}`,
              ].join("\n"),
              what: connector.kind,
            })
          }
        >
          Copy details
        </button>
      </div>
    </div>
  );
}

// A connector's steps, one screen each: its fields, then its list to pick
// from, in its own words.
function Connect(props: { model: Model; dispatch: Dispatch; show(s: SetupScreen): void }) {
  const { model, dispatch, show } = props;
  const kind = model.setup.kind ?? "";
  const connector = model.connectors[kind];
  const steps = connector?.connect?.steps ?? [];
  const form = formOf(model.connections, kind);
  const step = stepOf(steps, form);
  const send = (msg: ConnectionsMsg) => dispatch({ type: "connections", msg });
  if (!connector || !step || step.kind === folderStep || step.kind === "review") return null;
  if (step.kind === "browser")
    return (
      <>
        <h1 class="setup-title">{step.title}</h1>
        <p class="setup-lede">{step.lede}</p>
        <div class="setup-card">
          <BrowserStep
            connector={connector}
            step={step}
            form={form}
            send={send}
            actions={link("Back", () => show("work"))}
          />
        </div>
      </>
    );
  if (step.kind === "fields")
    return (
      <>
        <h1 class="setup-title">{step.title}</h1>
        <p class="setup-lede">{step.lede}</p>
        <div class="setup-card">
          <FieldsStep
            connector={connector}
            step={step}
            form={form}
            send={send}
            actions={link("Back", () => show("work"))}
          />
        </div>
      </>
    );
  return (
    <>
      <h1 class="setup-title">{step.title}</h1>
      <p class="setup-lede">{step.lede}</p>
      <PickStep
        connector={connector}
        step={step}
        form={form}
        send={send}
        actions={link("Back", () => send({ type: "backClicked", kind }))}
      />
    </>
  );
}

// The first sync: each source's progress, then the overview, as soon as one
// is read. One that fails says why, with Try again and Change.
function Reading(props: {
  model: Model;
  dispatch: Dispatch;
  send(msg: SetupMsg): void;
  show(s: SetupScreen, kind?: string): void;
}) {
  const { model, dispatch, send, show } = props;
  const reading = model.setup.view?.firstRun?.reading ?? null;
  const all = sources(model).filter((source) => source.state !== null);
  const standing = standingIn(model.connectors, model.connections);
  const failed = all.filter((source) => source.state === "failed");
  const ready = all.filter((source) => source.state === "read");
  const done = (
    <span class="provider-status" data-connected>
      <span class="provider-mark" aria-hidden="true" />
      <span class="provider-state">Done</span>
    </span>
  );
  return (
    <>
      <h1 class="setup-title">Reading your work</h1>
      <p class="setup-lede">Usually under a minute. Oriel shows your work when it's done.</p>
      <ul class="provider-rows setup-rows">
        {standing.map(({ kind, standIn: { offer } }) => (
          <SourceRow
            key={kind}
            mark={offer.mark}
            name={offer.title}
            about={offer.about}
            state={done}
            side={null}
          />
        ))}
        {all.map((source) => {
          const { connector, offer, form, open, state, picks } = source;
          // One that picks is named with what it picked; another, by what it
          // reads once it's read.
          const name = picks
            ? `${offer.title} · ${open?.reads ?? readingName(form) ?? ""}`
            : (open?.reads ?? offer.title);
          return (
            <SourceRow
              key={connector.kind}
              id={`reading-${connector.kind}`}
              mark={offer.mark}
              name={name}
              about={
                state === "read" && open
                  ? plural(open.items, offer.counts)
                  : state === "reading" && picks
                    ? reading?.total != null
                      ? `${reading.read} of ${plural(reading.total, offer.counts)}`
                      : plural(reading?.read ?? 0, offer.counts)
                    : ""
              }
              state={
                state === "read" ? (
                  open?.items === 0 ? (
                    <span class="cli-line">{offer.empty}</span>
                  ) : (
                    done
                  )
                ) : state === "reading" && picks ? (
                  <progress
                    class="setup-progress"
                    max={reading?.total ?? undefined}
                    value={reading?.total != null ? reading.read : undefined}
                    aria-labelledby={`reading-${connector.kind}-name reading-${connector.kind}-about`}
                  />
                ) : null
              }
            >
              <Failed source={source} model={model} dispatch={dispatch} send={send} show={show} />
            </SourceRow>
          );
        })}
      </ul>
      {failed.length > 0 && (
        <Foot
          links={
            <span class="setup-note">
              {ready.length > 0
                ? `${ready.map((source) => source.offer.ready).join(" ")} ${failed.map((source) => source.offer.catchUp).join(" ")}`
                : "Try again, or change what you connected."}
            </span>
          }
        >
          {ready.length > 0 ? (
            <button
              type="button"
              class="button primary setup-next"
              onClick={() => send({ type: "finished" })}
            >
              Open with what's ready
            </button>
          ) : (
            <button type="button" class="button setup-next" onClick={() => show("work")}>
              Back
            </button>
          )}
        </Foot>
      )}
    </>
  );
}
