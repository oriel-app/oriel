// The first-run setup, as static screens (OA-190, OA-191). A prototype for
// looking at and for walkthroughs, not product code: `node build.ts` writes
// screens/*.html, and `node shoot.ts` photographs them.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "screens");

const page = (title: string, body: string, bodyClass = "setup-body") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="../../../packages/web/assets/window.css">
<link rel="stylesheet" href="../setup.css">
</head>
<body class="${bodyClass}">
${body}
</body>
</html>
`;

const top = `<header class="setup-top"><img src="../../../packages/web/assets/icon.svg" alt=""> Oriel</header>`;

type Step = 1 | 2;
const steps = (current: Step, done: Step[] = []) => {
  const item = (n: Step, name: string) =>
    `<li class="${done.includes(n) ? "done" : ""}"${current === n ? ' aria-current="step"' : ""}><span class="n">${done.includes(n) ? "✓" : n}</span>${name}</li>`;
  return `<ol class="setup-steps">${item(1, "Your AI")}${item(2, "Your work")}</ol>`;
};

const setup = (o: {
  step: Step;
  done?: Step[];
  title: string;
  lead: string;
  body: string;
  foot?: string;
}) =>
  `${top}<main class="setup">${steps(o.step, o.done)}<h1>${o.title}</h1><p class="setup-lead">${o.lead}</p>${o.body}${o.foot ?? ""}</main>`;

// One assistant, as the setup and Settings both show it.
type Provider = "claude" | "codex";
const who = {
  claude: {
    name: "Claude Code",
    mark: "C",
    sub: "Anthropic's assistant · uses your Claude Pro or Max plan",
    size: "about 310 MB",
    site: "claude.ai",
    plan: "Claude Pro",
    maker: "Anthropic",
  },
  codex: {
    name: "Codex",
    mark: "O",
    sub: "OpenAI's assistant · uses your ChatGPT plan",
    size: "about 170 MB",
    site: "chatgpt.com",
    plan: "ChatGPT Plus",
    maker: "OpenAI",
  },
};

const row = (p: Provider, state: string, action = "", more = "", picked = false) => `
<div class="setup-row"${picked ? " data-picked" : ""}>
  <div class="mark" aria-hidden="true">${who[p].mark}</div>
  <div><div class="row-name">${who[p].name}</div><div class="row-sub">${who[p].sub}</div><div class="row-state">${state}</div></div>
  <div class="row-action">${action}</div>
  ${more ? `<div class="row-more">${more}</div>` : ""}
</div>`;

const card = (...rows: string[]) => `<div class="setup-card">${rows.join("")}</div>`;
const button = (label: string, kind = "", extra = "") =>
  `<button class="button ${kind}" type="button" ${extra}>${label}</button>`;
const quiet = (label: string) => `<button class="quiet-action" type="button">${label}</button>`;
const link = (label: string) => `<span class="link">${label}</span>`;

const assistantLead =
  "Oriel asks your questions and drafts changes through Claude or ChatGPT, on the plan you already pay for. Nothing in your work changes until you approve it.";
const apiKeyLink = `<span class="faint">No Claude or ChatGPT plan? ${link("Use an Anthropic API key")}</span>`;
const later = link("Set up later");
const assistantFoot = (primary: string, enabled = true) =>
  `<footer class="setup-foot"><div class="left">${apiKeyLink}${later}</div>${button(primary, "primary big", enabled ? "" : "disabled")}</footer>`;

const missing = (p: Provider) =>
  row(
    p,
    `Not on this Mac yet.`,
    `<span class="faint small">Free, ${who[p].size}</span>${button("Install")}`,
  );
const ready = (p: Provider, picked: boolean, email = "maya@example.com") =>
  row(
    p,
    `<span class="ready">Ready</span> · ${who[p].plan} · ${email} · ${link("Not this account?")}`,
    `<span class="radio"${picked ? " data-on" : ""}></span>`,
    "",
    picked,
  );
const installing = (p: Provider, time: string) =>
  row(
    p,
    `<span class="spinner"></span> Installing from ${who[p].maker}… ${time}`,
    quiet("Cancel"),
    `<div class="progress moving"><span></span></div><div class="faint small">${who[p].size[0].toUpperCase()}${who[p].size.slice(1)}. Usually a minute or two. ${who[p].maker} makes it; Oriel runs ${who[p].maker}'s own installer.</div>`,
  );
const signIn = (p: Provider) =>
  row(
    p,
    `<strong>Installed.</strong> Now sign in with your ${p === "claude" ? "Claude" : "ChatGPT"} account.`,
    button("Sign in", "primary"),
    `<div class="faint small">Your browser opens ${who[p].site}. Oriel never sees your password.</div>`,
  );
const signingIn = (p: Provider) =>
  row(
    p,
    `<span class="spinner"></span> Waiting for you in your browser…`,
    quiet("Cancel"),
    `<div class="box"><p><strong>A tab opened on ${who[p].site}.</strong> Sign in there${p === "claude" ? ", click <strong>Authorize</strong>" : ""}, then come back here. This page moves on by itself.</p><p class="small">No tab opened? ${link("Try again")}</p></div>`,
  );

type Screen = { name: string; title: string; html: string; bodyClass?: string };
const screens: Screen[] = [];
const add = (name: string, title: string, html: string, bodyClass?: string) =>
  screens.push({ name, title, html, bodyClass });

// 1. The assistant.

add(
  "01-assistant-checking",
  "Looking for an assistant",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(
      row("claude", `<span class="spinner"></span> Looking for it on this Mac…`),
      row("codex", `<span class="spinner"></span> Looking for it on this Mac…`),
    ),
    foot: assistantFoot("Continue", false),
  }),
);

add(
  "02-assistant-ready",
  "Already installed and signed in",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(ready("claude", true), missing("codex")),
    foot: assistantFoot("Continue with Claude Code"),
  }),
);

add(
  "03-assistant-both",
  "Both are ready",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body:
      card(ready("claude", true), ready("codex", false)) +
      `<p class="setup-note">You have both. Pick one; you can switch in Settings any time.</p>`,
    foot: assistantFoot("Continue with Claude Code"),
  }),
);

add(
  "04-assistant-missing",
  "Neither is installed",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body:
      card(missing("claude"), missing("codex")) +
      `<p class="setup-note">Install the one whose plan you pay for. Oriel installs it from the company that makes it, and you sign in with your usual account.</p>`,
    foot: assistantFoot("Continue", false),
  }),
);

// The Claude path.
add(
  "05-claude-installing",
  "Installing Claude Code",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(installing("claude", "0:41"), missing("codex")),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "06-claude-sign-in",
  "Claude Code installed; sign in",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(signIn("claude"), missing("codex")),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "07-claude-signing-in",
  "Signing in to Claude",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(signingIn("claude"), missing("codex")),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "08-claude-ready",
  "Claude Code is ready",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(ready("claude", true), missing("codex")),
    foot: assistantFoot("Continue with Claude Code"),
  }),
);

// The Codex path.
add(
  "09-codex-installing",
  "Installing Codex",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(missing("claude"), installing("codex", "0:22")),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "10-codex-sign-in",
  "Codex installed; sign in",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(missing("claude"), signIn("codex")),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "11-codex-signing-in",
  "Signing in to ChatGPT",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(missing("claude"), signingIn("codex")),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "12-codex-ready",
  "Codex is ready",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(missing("claude"), ready("codex", true)),
    foot: assistantFoot("Continue with Codex"),
  }),
);

// What goes wrong.
add(
  "13-wrong-plan",
  "Signed in on a plan without Claude Code",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(
      row(
        "claude",
        `Signed in as maya@example.com`,
        "",
        `<div class="box warn"><p><strong>This account is on Claude's free plan, which doesn't include Claude Code.</strong> Claude Pro or Max does.</p><div class="actions">${button("See Claude plans")}${button("Use another account")}</div></div>`,
      ),
      missing("codex"),
    ),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "14-other-account",
  "Use another account",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(
      row(
        "claude",
        `<span class="ready">Ready</span> · Claude Max · maya@work-example.com`,
        "",
        `<div class="box"><p><strong>Sign Claude Code in with another account?</strong> Claude Code then uses the new account everywhere on this Mac, not only in Oriel.</p><div class="actions">${button("Sign in with another account", "primary")}${button("Keep this one")}</div></div>`,
        true,
      ),
      missing("codex"),
    ),
    foot: assistantFoot("Continue with Claude Code"),
  }),
);
add(
  "15-install-failed",
  "The install stopped",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(
      row(
        "claude",
        `Not on this Mac yet.`,
        "",
        `<div class="box bad"><p><strong>Claude Code didn't install: the download stopped.</strong> Check that you're online, then try again.</p><div class="actions">${button("Try again", "primary")}${button("Show details")}${link("Install it another way")}</div></div>`,
      ),
      missing("codex"),
    ),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "16-install-details",
  "The install's details",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(
      row(
        "claude",
        `Not on this Mac yet.`,
        "",
        `<div class="box bad"><p><strong>Claude Code didn't install: the download stopped.</strong> Check that you're online, then try again.</p><div class="actions">${button("Try again", "primary")}${button("Hide details")}${button("Copy details")}</div><pre class="log">Oriel 0.9.0 · macOS 26.1 · Apple silicon
23:14:02  Install Claude Code with Anthropic's installer
          https://claude.ai/install.sh (sha256 3a68d340…a944)
23:14:03  Downloading Claude Code 2.1.317…
23:14:51  curl: (56) Recv failure: Connection reset by peer
23:14:51  Download failed
23:14:51  The installer stopped (exit 1). Nothing was installed.</pre><p class="small faint">Send these to whoever helps you with your Mac. They hold no password or key.</p></div>`,
      ),
      missing("codex"),
    ),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "17-sign-in-unfinished",
  "Sign-in didn't finish",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(
      row(
        "claude",
        `<strong>Installed.</strong> Not signed in yet.`,
        "",
        `<div class="box bad"><p><strong>Sign-in didn't finish.</strong> Nothing came back from claude.ai. If you closed the tab, or it showed a code to paste, start again.</p><div class="actions">${button("Try again", "primary")}${link("Sign in another way")}</div></div>`,
      ),
      missing("codex"),
    ),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "18-another-way",
  "Sign in another way",
  setup({
    step: 1,
    title: "Sign in to Claude Code yourself",
    lead: "If signing in from Oriel doesn't work, you can do it in Terminal, the Mac's app for typing commands. It takes a minute, and you only do it once.",
    body:
      `<div class="setup-card form"><ol class="box" style="border:0;background:none;padding:0;margin:0 0 0 1.2rem;font-size:var(--text-lg);color:var(--text)">
<li>Open Terminal: press <strong>⌘ Space</strong>, type <strong>Terminal</strong>, and press <strong>Return</strong>.</li>
<li>Copy this line, paste it into Terminal, and press <strong>Return</strong>:<div class="code">claude auth login ${button("Copy")}</div></li>
<li>Your browser opens claude.ai. Sign in and click <strong>Authorize</strong>. If the page shows a code, copy it and paste it into Terminal.</li>
<li>When Terminal says <strong>Login successful</strong>, come back here.</li>
</ol></div>` +
      `<footer class="setup-foot"><div class="left">${link("Back")}</div>${button("Check again", "primary big")}</footer>`,
  }),
);
add(
  "19-needs-update",
  "Installed, but too old",
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body: card(
      row(
        "claude",
        `This Claude Code (2.0.4) is older than Oriel works with.`,
        button("Update", "primary"),
        `<div class="faint small">Updates it from Anthropic, the way Claude Code updates itself. Your sign-in stays.</div>`,
      ),
      missing("codex"),
    ),
    foot: assistantFoot("Continue", false),
  }),
);
add(
  "20-api-key",
  "Use an API key",
  setup({
    step: 1,
    title: "Use an Anthropic API key",
    lead: "Without a Claude or ChatGPT plan, Oriel can use a key from Anthropic instead. Anthropic then bills you for each question Oriel asks; a plan you already pay for costs nothing extra.",
    body: `<div class="setup-card form">
<label class="sfield"><span>API key</span><input type="password" value="sk-ant-api03-xxxxxxxxxxxxxxxxxxxx" data-focus><span class="hint">${link("Get a key from Anthropic")}: sign in, click <strong>Create Key</strong>, and copy it.</span></label>
<p class="faint small" style="margin:0">Oriel keeps the key in your Mac's keychain and sends it only to Anthropic.</p>
</div>`,
    foot: `<footer class="setup-foot"><div class="left">${link("Back")}</div>${button("Save and continue", "primary big")}</footer>`,
  }),
);

// 2. Your work.

const source = (mark: string, name: string, sub: string, state: string, action: string) => `
<div class="setup-row">
  <div class="mark" aria-hidden="true">${mark}</div>
  <div><div class="row-name">${name}</div><div class="row-sub">${sub}</div>${state ? `<div class="row-state">${state}</div>` : ""}</div>
  <div class="row-action">${action}</div>
</div>`;
const workLead =
  "Oriel shows it all in one place, so you can see and ask about it. It reads your work and changes nothing until you approve.";
const jiraRow = (state = "", action = button("Connect")) =>
  source("J", "Jira", "Epics, stories and estimates", state, action);
const slackRow = (state = "", action = button("Connect")) =>
  source("S", "Slack", "Conversations in channels you pick", state, action);
const folderRow = (state = "", action = button("Choose a folder")) =>
  source("F", "A folder", "Notes and documents on this Mac. Oriel only reads them.", state, action);
const workFoot = (enabled: boolean) =>
  `<footer class="setup-foot"><div class="left">${link("Skip for now")}</div>${button("Continue", "primary big", enabled ? "" : "disabled")}</footer>`;

add(
  "21-work",
  "Connect your work",
  setup({
    step: 2,
    done: [1],
    title: "Connect where your work lives",
    lead: workLead,
    body: card(jiraRow(), slackRow(), folderRow()),
    foot: workFoot(false),
  }),
);
add(
  "22-jira",
  "Connect Jira",
  setup({
    step: 2,
    done: [1],
    title: "Connect Jira",
    lead: "Three things from your Jira account. Oriel keeps them in your Mac's keychain.",
    body: `<div class="setup-card form">
<label class="sfield"><span>Your Jira address</span><input value="acme-team.atlassian.net"><span class="hint">The start of the address in your browser when Jira is open.</span></label>
<label class="sfield"><span>The email you sign in to Jira with</span><input value="maya@example.com"></label>
<label class="sfield"><span>API token</span><input type="password" value="" data-focus></label>
<div class="box"><p>Atlassian makes these so apps like Oriel can read Jira without your password.</p><ol><li>${link("Open Atlassian's page for them")} (it opens in your browser).</li><li>Click <strong>Create</strong>, name it <strong>Oriel</strong>, and click <strong>Create</strong> again.</li><li>Click <strong>Copy</strong>, then paste it above.</li></ol></div>
</div>`,
    foot: `<footer class="setup-foot"><div class="left">${link("Back")}</div>${button("Connect", "primary big")}</footer>`,
  }),
);
add(
  "23-jira-refused",
  "Jira refused",
  setup({
    step: 2,
    done: [1],
    title: "Connect Jira",
    lead: "Three things from your Jira account. Oriel keeps them in your Mac's keychain.",
    body: `<div class="setup-card form">
<label class="sfield"><span>Your Jira address</span><input value="acme-team.atlassian.net"></label>
<label class="sfield"><span>The email you sign in to Jira with</span><input value="maya@example.com"></label>
<label class="sfield"><span>API token</span><input type="password" value="xxxxxxxxxxxxxxxx" data-bad><span class="err">Jira didn't accept this with that email. Copy it again from Atlassian's page and paste it here.</span></label>
</div>`,
    foot: `<footer class="setup-foot"><div class="left">${link("Back")}</div>${button("Connect", "primary big")}</footer>`,
  }),
);
add(
  "24-jira-project",
  "Pick a Jira project",
  setup({
    step: 2,
    done: [1],
    title: "Which Jira project?",
    lead: "Jira accepted your details. Pick the project you work in; you can add another later.",
    body: `<div class="setup-card">
<div class="pick"><span class="radio" data-on></span><div><div class="row-name">Payments</div><div class="row-sub">PAY · 120 issues · 8 epics</div></div></div>
<div class="pick"><span class="radio"></span><div><div class="row-name">Mobile app</div><div class="row-sub">MOB · 64 issues · 5 epics</div></div></div>
<div class="pick"><span class="radio"></span><div><div class="row-name">Design requests</div><div class="row-sub">DES · 31 issues</div></div></div>
</div>`,
    foot: `<footer class="setup-foot"><div class="left">${link("Back")}</div>${button("Use Payments", "primary big")}</footer>`,
  }),
);
add(
  "25-folder-picker",
  "Choose a folder",
  setup({
    step: 2,
    done: [1],
    title: "Connect where your work lives",
    lead: workLead,
    body:
      card(
        jiraRow(`<span class="ready">Connected</span> · Payments · 120 issues`, ""),
        slackRow(),
        folderRow(),
      ) +
      `<div class="scrim"><div class="os-sheet"><div class="os-title">Choose a folder for Oriel to read</div><div class="os-body"><div class="os-side"><div><strong>Favourites</strong></div><div>Desktop</div><div>Documents</div><div>Downloads</div><div>iCloud Drive</div></div><div class="os-list"><div>Budget 2027</div><div class="sel">Launch notes</div><div>Meeting notes</div><div>Research</div></div></div><div class="os-foot"><span class="os-btn">Cancel</span><span class="os-btn def">Choose</span></div></div></div>`,
    foot: workFoot(true),
  }),
);
add(
  "26-slack-channels",
  "Pick Slack channels",
  setup({
    step: 2,
    done: [1],
    title: "Which Slack channels?",
    lead: "Slack approved Oriel in your browser. Pick the channels Oriel reads; it posts only when you approve a change.",
    body: `<div class="setup-card">
<div class="pick"><span class="check" data-on></span><div><div class="row-name">#checkout-launch</div><div class="row-sub">14 people</div></div></div>
<div class="pick"><span class="check" data-on></span><div><div class="row-name">#payments-team</div><div class="row-sub">22 people</div></div></div>
<div class="pick"><span class="check"></span><div><div class="row-name">#design-crit</div><div class="row-sub">9 people</div></div></div>
<div class="pick"><span class="check"></span><div><div class="row-name">#random</div><div class="row-sub">140 people</div></div></div>
</div>`,
    foot: `<footer class="setup-foot"><div class="left">${link("Back")}</div>${button("Use 2 channels", "primary big")}</footer>`,
  }),
);
add(
  "27-work-connected",
  "Work connected",
  setup({
    step: 2,
    done: [1],
    title: "Connect where your work lives",
    lead: workLead,
    body: card(
      jiraRow(`<span class="ready">Connected</span> · Payments · 120 issues`, ""),
      slackRow(),
      folderRow(`<span class="ready">Connected</span> · Launch notes · 23 files`, ""),
    ),
    foot: workFoot(true),
  }),
);
add(
  "28-reading",
  "Reading your work",
  `${top}<main class="setup"><h1>Reading your work</h1><p class="setup-lead">Usually under a minute. Your window opens when it's done.</p>${card(
    source(
      "J",
      "Jira · Payments",
      `84 of 120 issues`,
      `<div class="progress"><span style="width:70%"></span></div>`,
      "",
    ),
    source("F", "Launch notes", `23 files`, `<span class="ready">Done</span>`, ""),
  )}</main>`,
);

// The window, after the setup.

const side = (workstreams: string) => `<aside class="win-side">
<div class="win-brand"><img src="../../../packages/web/assets/icon.svg" alt=""> Oriel</div>
<div class="win-nav">Window</div>
<div class="win-label">Workstreams</div>${workstreams}
<div class="win-sources"><div><span>PAY</span><span class="faint">120 items</span></div><div><span>Launch notes</span><span class="faint">23 files</span></div></div>
</aside>`;
const candidates = `<div class="sec">Not in a workstream yet · 8</div><div class="rows">
<div class="r"><div><span class="rule">Oriel rule</span> <span class="faint small">An epic no workstream holds</span></div></div>
<div class="r"><span>Checkout v2: phone wallets and saved cards</span><span class="faint">15 items · Jira</span></div>
<div class="r"><span>Gift cards</span><span class="faint">11 items · Jira</span></div>
<div class="r"><span>Boarding passes and gate scanning</span><span class="faint">9 items · Jira</span></div>
<div class="r"><span>Accessibility fixes</span><span class="faint">7 items · Jira</span></div>
</div>`;
const overview = (hello: string, ask: string, chat = "") =>
  `<div class="win">${side(`<div class="win-empty">None yet. Make one from an epic, or ask Oriel to.</div>`)}<main class="win-main">
<div class="win-head"><span class="tab" aria-current="page">Overview</span><span class="tab">Browse</span><span class="faint">120 items · 0 workstreams · 8 epics not in a workstream</span></div>
${hello}${ask}${candidates}
<div class="sec">Workstreams</div><div class="rows"><div class="r faint">None yet.</div></div>
</main>${chat}</div>`;
const askBar = `<div class="ask"><div class="input">Ask about your window</div>${button("Ask", "primary")}</div>
<div class="starts"><span class="start" data-hot>Should Checkout v2: phone wallets and saved cards become a workstream?</span><span class="start">What's in Gift cards?</span></div>`;

add(
  "29-overview",
  "Your window",
  overview(
    `<div class="hello"><span><strong>This is your window:</strong> everything from Jira and your folder, in one place. Start with a question below, or ask your own.</span>${quiet("Dismiss")}</div>`,
    askBar,
  ),
  "",
);
add(
  "30-first-answer",
  "The first answer",
  overview(
    "",
    askBar,
    `<aside class="chat"><div class="win-head" style="margin:0"><strong>Window chat</strong><span class="faint" style="margin-left:auto">New chat</span></div>
<div class="bubble">Should Checkout v2: phone wallets and saved cards become a workstream?</div>
<div class="answer"><p>Yes. It has 15 stories: 4 in progress, 5 to do and 6 with no estimate, and nothing else holds them.</p><p>I made <span class="chip">Checkout v2</span> a workstream with its 15 stories. ${link("Undo")}</p><p>To plan the 6 stories without estimates, continue in the workstream.</p></div>
<div>${button("Continue in Checkout v2", "primary")}</div></aside>`,
  ),
  "",
);
add(
  "31-change",
  "A change to approve",
  `<div class="win">${side(`<div class="win-item">Checkout v2 <span class="faint">15</span></div>`)}<main class="win-main" style="max-width:52rem">
<div class="win-head"><strong>Checkout v2: phone wallets and saved cards</strong><span class="faint">15 items · Jira</span></div>
<div class="bubble" style="margin-left:auto;width:fit-content">Suggest estimates for the 6 stories that have none.</div>
<div class="answer" style="margin-top:var(--space-3)"><p>Here are estimates, sized against the 9 stories in this epic that already have one. Nothing changes in Jira until you approve.</p></div>
<div class="diff"><div class="diff-head"><span>Set estimates on 6 stories in Jira</span><span>${button("Reject")} ${button("Approve and apply", "primary")}</span></div>
<div class="diff-row"><span class="faint">PAY-31</span><span>Save a card at checkout</span><span><span class="del">none</span> → <span class="ins">3</span></span></div>
<div class="diff-row"><span class="faint">PAY-34</span><span>Pay with a phone wallet</span><span><span class="del">none</span> → <span class="ins">5</span></span></div>
<div class="diff-row"><span class="faint">PAY-36</span><span>Remove a saved card</span><span><span class="del">none</span> → <span class="ins">2</span></span></div>
<div class="diff-row"><span class="faint">PAY-38</span><span>Wallet button on the cart page</span><span><span class="del">none</span> → <span class="ins">3</span></span></div>
<div class="diff-row"><span class="faint">PAY-40</span><span>Retry a declined wallet payment</span><span><span class="del">none</span> → <span class="ins">5</span></span></div>
<div class="diff-row"><span class="faint">PAY-41</span><span>Saved cards in account settings</span><span><span class="del">none</span> → <span class="ins">3</span></span></div>
</div></main></div>`,
  "",
);
add(
  "32-approved",
  "Approved",
  `<div class="win">${side(`<div class="win-item">Checkout v2 <span class="faint">15</span></div>`)}<main class="win-main" style="max-width:52rem">
<div class="win-head"><strong>Checkout v2: phone wallets and saved cards</strong><span class="faint">15 items · Jira</span></div>
<div class="bubble" style="margin-left:auto;width:fit-content">Suggest estimates for the 6 stories that have none.</div>
<div class="answer" style="margin-top:var(--space-3)"><p>Here are estimates, sized against the 9 stories in this epic that already have one. Nothing changes in Jira until you approve.</p></div>
<div class="diff"><div class="applied"><span>✓ Applied in Jira just now: 6 estimates set</span><span>${button("Revert")}</span></div>
<div class="diff-row"><span class="faint">PAY-31</span><span>Save a card at checkout</span><span><span class="del">none</span> → <span class="ins">3</span></span></div>
<div class="diff-row"><span class="faint">PAY-34</span><span>Pay with a phone wallet</span><span><span class="del">none</span> → <span class="ins">5</span></span></div>
<div class="diff-row"><span class="faint">PAY-36</span><span>Remove a saved card</span><span><span class="del">none</span> → <span class="ins">2</span></span></div>
<div class="diff-row"><span class="faint">PAY-38</span><span>Wallet button on the cart page</span><span><span class="del">none</span> → <span class="ins">3</span></span></div>
<div class="diff-row"><span class="faint">PAY-40</span><span>Retry a declined wallet payment</span><span><span class="del">none</span> → <span class="ins">5</span></span></div>
<div class="diff-row"><span class="faint">PAY-41</span><span>Saved cards in account settings</span><span><span class="del">none</span> → <span class="ins">3</span></span></div>
</div></main></div>`,
  "",
);

// Coming back, skipping, and Settings.

add(
  "33-welcome-back",
  "Quit halfway, then reopened",
  setup({
    step: 2,
    done: [1],
    title: "Welcome back",
    lead: "Claude Code is set up. Connect your work to finish; it picks up where you left off.",
    body: card(jiraRow(), slackRow(), folderRow()),
    foot: workFoot(false),
  }),
);
add(
  "34-skipped-ai",
  "The window with no AI set up",
  overview(
    "",
    `<div class="ask"><div class="input">Set up Claude or ChatGPT to ask about your window</div>${button("Set up", "primary")}</div><div class="starts"></div>`,
  ),
  "",
);
add(
  "35-settings",
  "Settings: the same rows",
  `<div class="win">${side(`<div class="win-item">Checkout v2 <span class="faint">15</span></div>`)}<main class="win-main" style="max-width:44rem">
<h1 style="font-size:1.5rem;margin:var(--space-2) 0 var(--space-4)">Settings</h1>
<div class="sec">Your AI</div>
${card(ready("claude", true), missing("codex"))}
<p class="setup-note">${link("Use an Anthropic API key instead")}</p>
<div class="sec">Your work</div>
${card(jiraRow(`<span class="ready">Connected</span> · Payments · 120 issues`, quiet("Sync")), slackRow(), folderRow(`<span class="ready">Connected</span> · Launch notes · 23 files`, quiet("Sync")))}
</main></div>`,
  "",
);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const screen of screens)
  writeFileSync(
    join(out, `${screen.name}.html`),
    page(`Oriel · ${screen.title}`, screen.html, screen.bodyClass ?? "setup-body"),
  );
writeFileSync(
  join(out, "index.json"),
  JSON.stringify(
    screens.map(({ name, title }) => ({ name, title })),
    null,
    2,
  ) + "\n",
);
console.log(`${screens.length} screens in ${out}`);
