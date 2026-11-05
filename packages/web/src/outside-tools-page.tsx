// Settings, Outside tools (OA-72): programs such as Claude Code and Codex,
// connected to Oriel's MCP door. A program signs in from itself, and the
// person lets it in here, matching the code its browser page shows; or the
// person adds one by hand and pastes the token, shown once. Each connected
// tool shows its mode, how it signs in and when it was last used, with
// Revoke. The spike reads its own route and looks again every two seconds,
// so an ask shows while the page is open; the story moves it onto the
// workspace stream.
import { useEffect, useState } from "preact/hooks";
import { when } from "./time.ts";
import type {
  HowToView,
  OutsideToolsView,
  OutsideToolView,
  ToolAddedView,
  ToolAskView,
} from "./view.ts";

type Mode = OutsideToolView["mode"];
const modeNames: Record<Mode, string> = {
  read: "Read only",
  act: "Read and act",
};
const modeAbout: Record<Mode, string> = {
  read: "It reads workstreams, threads and items. It changes nothing.",
  act: "It also changes workstreams and threads, as Oriel's agent does, each with Undo. Its words in a thread wait for you to send them.",
};

const post = (path: string, body: unknown) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export function OutsideTools() {
  const [view, setView] = useState<OutsideToolsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<ToolAddedView | null>(null);
  const load = async () => {
    const response = await fetch("/api/outside-tools");
    if (response.ok) setView((await response.json()) as OutsideToolsView);
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 2_000);
    return () => clearInterval(timer);
  }, []);
  const said = async (response: Response) => {
    if (response.ok) {
      setProblem(null);
      await load();
      return true;
    }
    setProblem(((await response.json()) as { error?: string }).error ?? "That didn't work.");
    return false;
  };
  const live = view?.tools.filter((tool) => tool.revokedAt === null) ?? [];
  return (
    <section class="settings-section" aria-labelledby="settings-tools">
      <h2 id="settings-tools" class="settings-title">
        Outside tools
      </h2>
      <p class="settings-lede">
        Programs such as Claude Code and Codex can read Oriel, and change workstreams and threads if
        you let them, as Oriel's own agent does. Each shows as itself, with Undo. None can approve a
        change set or write to a source: only you can.
      </p>
      {problem && (
        <p class="settings-problem" role="alert">
          {problem}
        </p>
      )}
      {view === null ? (
        <p class="loading">Loading…</p>
      ) : view.door === null ? (
        <p class="settings-field-about">
          Oriel's door for outside tools isn't open.{view.problem ? ` ${view.problem}` : ""}
        </p>
      ) : (
        <>
          {view.asks.map((ask) => (
            <AskRow
              key={ask.id}
              ask={ask}
              onAnswer={async (answer) => {
                await said(await post(`/api/outside-tools/asks/${ask.id}`, answer));
              }}
            />
          ))}
          <div class="settings-field">
            <span class="settings-field-name">Connect a program</span>
            <span class="settings-field-about">
              It signs in from the program, and asks you here. No token to copy.
            </span>
            {view.signIn.map((how) => (
              <HowTo key={how.client} how={how} />
            ))}
          </div>
          {added ? (
            <Added added={added} onDone={() => setAdded(null)} />
          ) : (
            <AddForm
              onAdd={async (name, mode) => {
                const response = await post("/api/outside-tools", { name, mode });
                if (!response.ok) return void (await said(response));
                setAdded((await response.json()) as ToolAddedView);
                await load();
              }}
            />
          )}
          <div class="settings-field">
            <span class="settings-field-name">Connected</span>
            {live.length === 0 ? (
              <span class="settings-field-about">No program is connected yet.</span>
            ) : (
              <ul class="outside-tools">
                {live.map((tool) => (
                  <ToolRow
                    key={tool.id}
                    tool={tool}
                    onRevoke={async () => {
                      await said(await post(`/api/outside-tools/${tool.id}/revoke`, {}));
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// Read only or read and act, as Settings' other choices look.
function ModePick(props: { name: string; mode: Mode; onPick(mode: Mode): void }) {
  return (
    <fieldset class="settings-field">
      <legend class="settings-field-name">What it may do</legend>
      <span class="settings-field-about">{modeAbout[props.mode]}</span>
      <div class="choices">
        {(["read", "act"] as const).map((mode) => (
          <label key={mode} class="choice">
            <input
              type="radio"
              name={props.name}
              value={mode}
              checked={props.mode === mode}
              onChange={() => props.onPick(mode)}
            />
            {modeNames[mode]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// A client that asked to sign in: the person matches its code, names it,
// picks what it may do, and lets it in, or turns it away.
function AskRow(props: {
  ask: ToolAskView;
  onAnswer(answer: { name: string; mode: Mode } | { deny: true }): Promise<void>;
}) {
  const { ask } = props;
  const [name, setName] = useState(ask.says);
  const [mode, setMode] = useState<Mode>("read");
  return (
    <form
      class="outside-tool-ask"
      aria-label={`${ask.says} asks to sign in`}
      onSubmit={(event) => {
        event.preventDefault();
        void props.onAnswer({ name, mode });
      }}
    >
      <p class="settings-field-name">A program asks to sign in</p>
      <p class="settings-field-about">
        It calls itself <b>{ask.says}</b>. Its browser page shows the code{" "}
        <b class="outside-tool-code">{ask.code}</b>. If the codes differ, or you didn't start this,
        turn it away.
      </p>
      <label class="settings-field">
        <span class="settings-field-name">Name</span>
        <span class="settings-field-about">How Oriel names what it does, everywhere.</span>
        <input
          class="input"
          value={name}
          maxLength={60}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <ModePick name={`ask-${ask.id}`} mode={mode} onPick={setMode} />
      <div class="provider-key-actions">
        <button type="submit" class="button" disabled={name.trim() === ""}>
          Let it in
        </button>
        <button
          type="button"
          class="quiet-action"
          onClick={() => void props.onAnswer({ deny: true })}
        >
          Turn it away
        </button>
      </div>
    </form>
  );
}

function AddForm(props: { onAdd(name: string, mode: Mode): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("read");
  if (!open)
    return (
      <button type="button" class="quiet-action" onClick={() => setOpen(true)}>
        Add a program with a token instead
      </button>
    );
  return (
    <form
      class="settings-field"
      onSubmit={(event) => {
        event.preventDefault();
        void props.onAdd(name, mode);
      }}
    >
      <label class="settings-field">
        <span class="settings-field-name">Name</span>
        <span class="settings-field-about">How Oriel names what it does, everywhere.</span>
        <input
          class="input"
          value={name}
          maxLength={60}
          placeholder="Claude Code"
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <ModePick name="add-mode" mode={mode} onPick={setMode} />
      <div class="provider-key-actions">
        <button type="submit" class="button" disabled={name.trim() === ""}>
          Add
        </button>
        <button type="button" class="quiet-action" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// The token, once, in what to paste into each client.
function Added(props: { added: ToolAddedView; onDone(): void }) {
  return (
    <div class="settings-field outside-tool-added">
      <span class="settings-field-name">{props.added.tool.name} is connected</span>
      <span class="settings-field-about">
        Paste one of these into it now. Oriel keeps only a fingerprint of its token, so this is the
        only time it shows. Anyone who has the token is {props.added.tool.name} to Oriel, so keep it
        only in that program's config.
      </span>
      {props.added.howTo.map((how) => (
        <HowTo key={how.client} how={how} />
      ))}
      <div class="provider-key-actions">
        <button type="button" class="button" onClick={props.onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function HowTo(props: { how: HowToView }) {
  const { how } = props;
  const [copied, setCopied] = useState(false);
  return (
    <div class="outside-tool-how">
      <span class="settings-field-name">{how.client}</span>
      {how.steps.map((step) => (
        <span key={step} class="settings-field-about">
          {step}
        </span>
      ))}
      {how.command !== null && (
        <>
          <pre class="outside-tool-command">{how.command}</pre>
          <button
            type="button"
            class="quiet-action"
            onClick={() =>
              void navigator.clipboard.writeText(how.command ?? "").then(() => setCopied(true))
            }
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </>
      )}
    </div>
  );
}

function ToolRow(props: { tool: OutsideToolView; onRevoke(): Promise<void> }) {
  const { tool } = props;
  return (
    <li class="outside-tool">
      <span class="settings-field-name">{tool.name}</span>
      <span class="settings-field-about">
        {modeNames[tool.mode]}.{" "}
        {tool.how === "signed-in"
          ? `Signed in from Oriel's window${tool.says && tool.says !== tool.name ? `, calling itself ${tool.says}` : ""}.`
          : "Uses a token."}{" "}
        {tool.usedAt ? `Last used ${when(tool.usedAt)}.` : "Not used yet."}
      </span>
      <button type="button" class="button danger" onClick={() => void props.onRevoke()}>
        Revoke
      </button>
    </li>
  );
}
