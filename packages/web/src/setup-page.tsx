// The desktop app's first run (decision 0038), on a page of its own: Your AI,
// then Your work, then reading it, then the overview. Each step has a way to
// set it up later. The words follow the prototype the walkthroughs read:
// plans before product names, what installs and where the work goes, what's
// happening while it does, and a failure that keeps its help on screen.
import type { ComponentChildren } from "preact";
import { ClaudeCodeRow, CodexRow } from "./cli-row.tsx";
import type { FolderMsg } from "./folder.ts";
import { JiraDetails, JiraProjects } from "./jira-connect.tsx";
import { type JiraMsg, pickedProject } from "./jira.ts";
import { type Dispatch, Mark, plural } from "./parts.tsx";
import type { Model } from "./root.ts";
import type { SetupMsg, SetupScreen } from "./setup.ts";

export function SetupPage(props: { model: Model; dispatch: Dispatch }) {
  const { model, dispatch } = props;
  const { setup } = model;
  const send = (msg: SetupMsg) => dispatch({ type: "setup", msg });
  const show = (screen: SetupScreen) => send({ type: "screenShown", screen });
  const step = ["ai", "key", "other-ways"].includes(setup.screen) ? 1 : 2;
  return (
    <div class="setup-page">
      <header class="setup-brand">
        <Mark />
        Oriel
      </header>
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
        ) : setup.screen === "jira" || setup.screen === "projects" ? (
          <ConnectJira model={model} dispatch={dispatch} show={show} />
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
        Oriel answers your questions and drafts changes through Claude, on the Claude plan you
        already pay for. Nothing changes in Jira or your files until you approve it.
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
        <label class="jira-field">
          <span class="jira-label">API key</span>
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
          <p class="jira-problem" role="alert">
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

// A source as a row: its mark, name and what it brings, its state, and the
// one thing to do next.
function SourceRow(props: {
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
        <span class="provider-name">{props.name}</span>
        <span class="provider-about">{props.about}</span>
        {props.state}
        {props.children}
      </div>
      {props.side && <div class="provider-side">{props.side}</div>}
    </li>
  );
}

const connected = (text: string) => (
  <span class="provider-status" data-connected>
    <span class="provider-mark" aria-hidden="true" />
    <span class="provider-state">Connected</span>
    <span>· {text}</span>
  </span>
);

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

// What each source is doing, for Your work and Reading your work.
function sourceStates(model: Model) {
  const { jira, folder, setup } = model;
  const reading = setup.view?.firstRun?.reading ?? null;
  const project = pickedProject(jira);
  const jiraState = jira.view?.connected
    ? ("read" as const)
    : jira.pending === "connecting"
      ? ("reading" as const)
      : jira.connecting !== null && jira.problem !== null
        ? ("failed" as const)
        : null;
  const folderState = folder.view
    ? ("read" as const)
    : folder.pending
      ? ("reading" as const)
      : folder.problem !== null
        ? ("failed" as const)
        : null;
  return { jiraState, folderState, reading, project };
}

function YourWork(props: {
  model: Model;
  dispatch: Dispatch;
  send(msg: SetupMsg): void;
  show(s: SetupScreen): void;
}) {
  const { model, dispatch, send, show } = props;
  const { jira, folder, setup } = model;
  const sendFolder = (msg: FolderMsg) => dispatch({ type: "folder", msg });
  const { jiraState, folderState, reading, project } = sourceStates(model);
  const anything = jiraState === "read" || jiraState === "reading" || folderState === "read";
  const ai = setup.view?.firstRun?.steps.ai;
  return (
    <>
      <h1 class="setup-title">
        {setup.resumed ? "Welcome back" : "Connect where your work lives"}
      </h1>
      <p class="setup-lede">
        {setup.resumed
          ? `${ai === "done" ? "Your AI is set up. " : ""}Connect your work to finish; Oriel picked up where you left off.`
          : "Oriel shows it all in one place and keeps it on this Mac. Only what a question needs goes to your AI. Nothing changes in Jira or your files until you approve it."}
      </p>
      <ul class="provider-rows setup-rows">
        <SourceRow
          mark="J"
          name="Jira"
          about="Epics, stories and their details"
          state={
            jiraState === "read" && jira.view?.connected ? (
              connected(
                `${jira.view.connected.project} · ${plural(jira.view.connected.items, "issue")}`,
              )
            ) : jiraState === "reading" ? (
              <ReadingLine
                text={`Reading ${project?.name ?? jira.connecting ?? "Jira"}`}
                read={reading?.read ?? 0}
                total={reading?.total ?? null}
                noun="issue"
              />
            ) : null
          }
          side={
            jiraState === null ? (
              <button
                type="button"
                class="button"
                onClick={() => show(jira.projects ? "projects" : "jira")}
              >
                Connect
              </button>
            ) : null
          }
        >
          {jiraState === "failed" && (
            <JiraFailed model={model} dispatch={dispatch} send={send} show={show} />
          )}
        </SourceRow>
        <SourceRow
          mark="F"
          name="A folder"
          about="Notes saved as files on this Mac, and its folders. Oriel only reads them."
          state={
            folder.view ? (
              connected(`${folderName(folder.view.path)} · ${plural(folder.view.items, "file")}`)
            ) : folderState === "reading" ? (
              <span class="cli-line cli-waiting" role="status">
                <span class="spinner" aria-hidden="true" />
                Waiting for the folder you choose…
              </span>
            ) : null
          }
          side={
            folderState !== "reading" && (
              <button
                type="button"
                class="button"
                onClick={() => sendFolder({ type: "pickClicked" })}
              >
                {folder.view ? "Choose another" : "Choose a folder"}
              </button>
            )
          }
        >
          {folder.problem && (
            <p class="jira-problem" role="alert">
              {folder.problem}
            </p>
          )}
        </SourceRow>
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

function ReadingLine(props: { text: string; read: number; total: number | null; noun: string }) {
  const { read, total } = props;
  return (
    <span class="setup-reading">
      <span class="cli-line" role="status">
        {props.text}:{" "}
        {total !== null ? `${read} of ${plural(total, props.noun)}` : plural(read, props.noun)}
      </span>
      <progress
        class="setup-progress"
        max={total ?? undefined}
        value={total !== null ? read : undefined}
      />
    </span>
  );
}

// Jira's first sync stopped: what's known, Try again, and Change, which goes
// back to the details.
function JiraFailed(props: {
  model: Model;
  dispatch: Dispatch;
  send(msg: SetupMsg): void;
  show(s: SetupScreen): void;
}) {
  const { model, dispatch, send, show } = props;
  const { jira } = model;
  const reading = model.setup.view?.firstRun?.reading;
  const sendJira = (msg: JiraMsg) => dispatch({ type: "jira", msg });
  const stopped =
    reading?.stopped && reading.total !== null
      ? `Stopped after ${reading.read} of ${plural(reading.total, "issue")}: `
      : "";
  return (
    <div class="cli-box" data-tone="danger" role="alert">
      <p>
        <strong>
          {stopped}
          {jira.problem}
        </strong>
      </p>
      <div class="cli-actions">
        <button
          type="button"
          class="button primary"
          onClick={() => sendJira({ type: "connectClicked" })}
        >
          Try again
        </button>
        <button
          type="button"
          class="button"
          onClick={() => {
            sendJira({ type: "changeClicked" });
            show("jira");
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
              text: [`Jira · ${jira.connecting ?? ""}`, `${stopped}${jira.problem ?? ""}`].join(
                "\n",
              ),
              what: "jira",
            })
          }
        >
          Copy details
        </button>
      </div>
    </div>
  );
}

function ConnectJira(props: { model: Model; dispatch: Dispatch; show(s: SetupScreen): void }) {
  const { model, dispatch, show } = props;
  const { jira } = model;
  const sendJira = (msg: JiraMsg) => dispatch({ type: "jira", msg });
  if (jira.projects === null)
    return (
      <>
        <h1 class="setup-title">Connect Jira</h1>
        <p class="setup-lede">
          Three things from your Jira account. Oriel keeps them encrypted on this Mac.
        </p>
        <div class="setup-card">
          <JiraDetails jira={jira} send={sendJira} actions={link("Back", () => show("work"))} />
        </div>
      </>
    );
  return (
    <>
      <h1 class="setup-title">Which Jira project?</h1>
      <p class="setup-lede">Jira accepted your details. Pick the project you work in.</p>
      <JiraProjects
        jira={jira}
        send={sendJira}
        actions={link("Back", () => {
          sendJira({ type: "changeClicked" });
          show("jira");
        })}
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
  show(s: SetupScreen): void;
}) {
  const { model, dispatch, send, show } = props;
  const { jira, folder } = model;
  const { jiraState, folderState, reading, project } = sourceStates(model);
  const failed = jiraState === "failed" || folderState === "failed";
  const ready = jiraState === "read" || folderState === "read";
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
        {jiraState !== null && (
          <SourceRow
            mark="J"
            name={`Jira · ${jira.view?.connected?.project ?? project?.name ?? jira.connecting ?? ""}`}
            about={
              jiraState === "read" && jira.view?.connected
                ? plural(jira.view.connected.items, "issue")
                : jiraState === "reading"
                  ? reading?.total != null
                    ? `${reading.read} of ${plural(reading.total, "issue")}`
                    : plural(reading?.read ?? 0, "issue")
                  : ""
            }
            state={
              jiraState === "read" ? (
                jira.view?.connected?.items === 0 ? (
                  <span class="cli-line">This project has no issues yet.</span>
                ) : (
                  done
                )
              ) : jiraState === "reading" ? (
                <progress
                  class="setup-progress"
                  max={reading?.total ?? undefined}
                  value={reading?.total != null ? reading.read : undefined}
                />
              ) : null
            }
          >
            {jiraState === "failed" && (
              <JiraFailed model={model} dispatch={dispatch} send={send} show={show} />
            )}
          </SourceRow>
        )}
        {folderState !== null && (
          <SourceRow
            mark="F"
            name={folder.view ? folderName(folder.view.path) : "A folder"}
            about={folder.view ? plural(folder.view.items, "file") : ""}
            state={
              folder.view ? (
                folder.view.items === 0 ? (
                  <span class="cli-line">This folder has no notes Oriel reads.</span>
                ) : (
                  done
                )
              ) : null
            }
          >
            {folder.problem && (
              <p class="jira-problem" role="alert">
                {folder.problem}
              </p>
            )}
          </SourceRow>
        )}
      </ul>
      {failed && (
        <Foot
          links={
            <span class="setup-note">
              {ready
                ? `${folderState === "read" ? "Your notes are" : "Jira is"} ready. ${jiraState === "failed" ? "Jira" : "The folder"} can catch up later.`
                : "Try again, or change what you connected."}
            </span>
          }
        >
          {ready ? (
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
