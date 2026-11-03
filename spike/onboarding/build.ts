// The first-run setup, as static screens (OA-190, OA-191). A prototype for
// looking at and for walkthroughs, not product code: `node build.ts` writes
// screens/*.html, and `node shoot.ts` photographs them. Round 2: revised
// after two walkthroughs (see README.md).
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
    sub: "For Claude Pro and Max · Anthropic's assistant for your Mac",
    size: "about 310 MB",
    site: "claude.ai",
    plan: "Claude Pro",
    maker: "Anthropic",
    account: "Claude",
  },
  codex: {
    name: "Codex",
    mark: "O",
    sub: "For ChatGPT plans · OpenAI's assistant for your Mac",
    size: "about 170 MB",
    site: "chatgpt.com",
    plan: "ChatGPT Plus",
    maker: "OpenAI",
    account: "ChatGPT",
  },
};

const row = (p: Provider, state: string, action = "", more = "", picked = false) => `
<div class="setup-row"${picked ? " data-picked" : ""}>
  <div class="smark" aria-hidden="true">${who[p].mark}</div>
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
  "Oriel answers your questions and drafts changes through Claude or ChatGPT, on the plan you already pay for. Nothing changes in Jira, Slack or your files until you approve it.";
const why = `<p class="setup-note">Oriel can't use claude.ai or ChatGPT in your browser, so it works through their makers' free assistant for your Mac, which uses the same plan. Oriel installs it for you: no admin password, and nothing outside your own folder.</p>`;
const apiKeyLink = `<span class="faint">No Claude or ChatGPT plan? ${link("Pay Anthropic per question instead")}</span>`;
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
    `<span class="sradio"${picked ? " data-on" : ""}></span>`,
    "",
    picked,
  );
const installing = (p: Provider, phase: string, time: string) =>
  row(
    p,
    `<span class="spinner"></span> ${phase} ${time}`,
    quiet("Cancel"),
    `<div class="progress moving"><span></span></div><div class="faint small">Downloading → setting up → checking it's genuine. ${who[p].size[0].toUpperCase()}${who[p].size.slice(1)}, usually a minute or two, straight from ${who[p].maker}.</div>`,
  );
const signIn = (p: Provider) =>
  row(
    p,
    `<strong>Installed.</strong> Now sign in with your ${who[p].account} account.`,
    button("Sign in", "primary"),
    `<div class="faint small">Your browser opens ${who[p].site}. Oriel never sees your password or your chats.</div>`,
  );
const signingIn = (p: Provider) =>
  row(
    p,
    `<span class="spinner"></span> Waiting for you in your browser…`,
    quiet("Cancel"),
    `<div class="box"><p><strong>A tab opened on ${who[p].site}.</strong> It asks you to let ${who[p].name} use your ${who[p].account} account${p === "claude" ? ": click <strong>Authorize</strong>" : ""}. Oriel comes back to the front by itself when you're done.</p><p class="small">No tab, or the wrong account? ${link("Start again")}</p></div>`,
  );

type Screen = { name: string; title: string; html: string; bodyClass?: string };
const screens: Screen[] = [];
const add = (name: string, title: string, html: string, bodyClass?: string) =>
  screens.push({ name, title, html, bodyClass });
const aiStep = (body: string, primary: string, enabled: boolean) =>
  setup({
    step: 1,
    title: "Set up the AI Oriel uses",
    lead: assistantLead,
    body,
    foot: assistantFoot(primary, enabled),
  });

// 1. The AI.

add(
  "01-assistant-checking",
  "Looking for an assistant",
  aiStep(
    card(
      row("claude", `<span class="spinner"></span> Looking for it on this Mac…`),
      row("codex", `<span class="spinner"></span> Looking for it on this Mac…`),
    ) + why,
    "Continue",
    false,
  ),
);
add(
  "02-assistant-ready",
  "Already installed and signed in",
  aiStep(card(ready("claude", true), missing("codex")), "Continue with Claude Code", true),
);
add(
  "03-assistant-both",
  "Both are ready",
  aiStep(
    card(ready("claude", true), ready("codex", false)) +
      `<p class="setup-note">You have both. Pick one; you can switch in Settings any time.</p>`,
    "Continue with Claude Code",
    true,
  ),
);
add(
  "04-assistant-missing",
  "Neither is installed",
  aiStep(
    card(missing("claude"), missing("codex")) +
      `<p class="setup-note">Install the one whose plan you pay for, then sign in with your usual account.</p>` +
      why,
    "Continue",
    false,
  ),
);

// The Claude path.
add(
  "05-claude-installing",
  "Installing Claude Code",
  aiStep(
    card(installing("claude", "Downloading from Anthropic…", "0:41"), missing("codex")),
    "Continue",
    false,
  ),
);
add(
  "06-claude-sign-in",
  "Installed, not signed in",
  aiStep(card(signIn("claude"), missing("codex")), "Continue", false),
);
add(
  "07-claude-signing-in",
  "Signing in to Claude",
  aiStep(card(signingIn("claude"), missing("codex")), "Continue", false),
);
add(
  "08-claude-ready",
  "Claude Code is ready",
  aiStep(card(ready("claude", true), missing("codex")), "Continue with Claude Code", true),
);

// The Codex path.
add(
  "09-codex-installing",
  "Installing Codex",
  aiStep(card(missing("claude"), installing("codex", "Setting up…", "0:52")), "Continue", false),
);
add(
  "10-codex-sign-in",
  "Codex installed; sign in",
  aiStep(card(missing("claude"), signIn("codex")), "Continue", false),
);
add(
  "11-codex-signing-in",
  "Signing in to ChatGPT",
  aiStep(card(missing("claude"), signingIn("codex")), "Continue", false),
);
add(
  "12-codex-ready",
  "Codex is ready",
  aiStep(card(missing("claude"), ready("codex", true)), "Continue with Codex", true),
);

// What goes wrong.
const accountHint = `<p class="small">In the tab that opens, check the account at the top. If it's still the old one, sign out of claude.ai there first.</p>`;
add(
  "13-wrong-plan",
  "Signed in on a plan without Claude Code",
  aiStep(
    card(
      row(
        "claude",
        `Signed in as maya@example.com`,
        "",
        `<div class="box warn"><p><strong>This account is on Claude's free plan, which doesn't include Claude Code.</strong> Claude Pro or Max does.</p><div class="actions">${button("See Claude plans")}${button("Use another account")}</div>${accountHint}</div>`,
      ),
      missing("codex"),
    ),
    "Continue",
    false,
  ),
);
add(
  "14-other-account",
  "Use another account",
  aiStep(
    card(
      row(
        "claude",
        `<span class="ready">Ready</span> · Claude Max · maya@work-example.com`,
        "",
        `<div class="box"><p><strong>Sign Claude Code in with another account?</strong> Claude Code then uses that account everywhere on this Mac, not only in Oriel.</p><div class="actions">${button("Sign in with another account", "primary")}${button("Keep this one")}</div>${accountHint}</div>`,
        true,
      ),
      missing("codex"),
    ),
    "Continue with Claude Code",
    true,
  ),
);
const failedInstall = (details: boolean) =>
  `<div class="box bad"><p><strong>Claude Code didn't install, and nothing changed on your Mac.</strong> The download from Anthropic stopped. A work network can block it; if trying again doesn't help, send the details to your IT team.</p><div class="actions">${button("Try again", "primary")}${button(details ? "Hide details" : "Show details")}${details ? button("Copy details") : link("Other ways to install")}</div>${
    details
      ? `<pre class="log">Oriel 0.9.0 · macOS 26.1 · Apple silicon
23:14:02  Install Claude Code with Anthropic's installer
          https://claude.ai/install.sh (sha256 3a68d340…a944)
23:14:03  Downloading Claude Code 2.1.317…
23:14:51  curl: (56) Recv failure: Connection reset by peer
23:14:51  Download failed
23:14:51  The installer stopped (exit 1). Nothing was installed.</pre><p class="small faint">These hold no password or key. Send them to whoever helps you with your Mac.</p>`
      : ""
  }</div>`;
add(
  "15-install-failed",
  "The install stopped",
  aiStep(
    card(row("claude", `Not on this Mac yet.`, "", failedInstall(false)), missing("codex")),
    "Continue",
    false,
  ),
);
add(
  "16-install-details",
  "The install's details",
  aiStep(
    card(row("claude", `Not on this Mac yet.`, "", failedInstall(true)), missing("codex")),
    "Continue",
    false,
  ),
);
add(
  "17-sign-in-unfinished",
  "Sign-in didn't finish",
  aiStep(
    card(
      row(
        "claude",
        `<strong>Installed.</strong> Not signed in yet.`,
        "",
        `<div class="box bad"><p><strong>Sign-in didn't finish: nothing came back from claude.ai.</strong> If you closed the tab or picked the wrong account, start again.</p><div class="actions">${button("Start again", "primary")}${button("Copy details")}${link("Other ways to sign in")}</div></div>`,
      ),
      missing("codex"),
    ),
    "Continue",
    false,
  ),
);
add(
  "18-another-way",
  "Sign in another way",
  setup({
    step: 1,
    title: "Sign in to Claude Code yourself",
    lead: "Only if signing in from Oriel keeps failing. Terminal is the Mac's app for typing commands; this one line starts Anthropic's own sign-in and changes nothing else.",
    body:
      `<div class="setup-card form"><ol class="box" style="border:0;background:none;padding:0;margin:0 0 0 1.2rem;font-size:var(--text-lg);color:var(--text)">
<li>Open Terminal: press <strong>⌘ Space</strong>, type <strong>Terminal</strong>, and press <strong>Return</strong>.</li>
<li>Copy this line, paste it into Terminal, and press <strong>Return</strong>:<div class="code">claude auth login ${button("Copy")}</div></li>
<li>Your browser opens claude.ai. Sign in and click <strong>Authorize</strong>. If the page shows a code, copy it into Terminal and press <strong>Return</strong>.</li>
<li>When Terminal says <strong>Login successful</strong>, come back here.</li>
</ol></div>
<p class="setup-note">Rather not? Send ${link("what Oriel tried")} to whoever helps you with your Mac, or ${link("pay Anthropic per question instead")}.</p>` +
      `<footer class="setup-foot"><div class="left">${link("Back")}</div>${button("Check again", "primary big")}</footer>`,
  }),
);
add(
  "19-needs-update",
  "Installed, but too old",
  aiStep(
    card(
      row(
        "claude",
        `This Claude Code (2.0.4) is older than Oriel works with.`,
        button("Update", "primary"),
        `<div class="faint small">Updates it from Anthropic, the way Claude Code updates itself. You stay signed in.</div>`,
      ),
      missing("codex"),
    ),
    "Continue",
    false,
  ),
);
add(
  "20-api-key",
  "Use an API key",
  setup({
    step: 1,
    title: "Pay Anthropic per question",
    lead: "Without a Claude or ChatGPT plan, Oriel can use a key from Anthropic. Anthropic bills you for each question Oriel asks, and you can set a monthly limit there.",
    body: `<div class="setup-card form">
<label class="sfield"><span>API key</span><input type="password" placeholder="Paste it here" data-focus><span class="hint">${link("Get a key from Anthropic")}: make an account there (it's separate from claude.ai), add a card, click <strong>Create Key</strong>, and copy it.</span></label>
<p class="faint small" style="margin:0">Oriel keeps the key in your Mac's keychain, with your other passwords, and sends it only to Anthropic.</p>
</div>`,
    foot: `<footer class="setup-foot"><div class="left">${link("Back")}</div>${button("Save and continue", "primary big")}</footer>`,
  }),
);

// 2. Your work.

const source = (mark: string, name: string, sub: string, state: string, action: string) => `
<div class="setup-row">
  <div class="smark" aria-hidden="true">${mark}</div>
  <div><div class="row-name">${name}</div><div class="row-sub">${sub}</div>${state ? `<div class="row-state">${state}</div>` : ""}</div>
  <div class="row-action">${action}</div>
</div>`;
const workLead =
  "Oriel shows it all in one place and keeps it on this Mac. Only what a question needs goes to your AI, under your plan. Nothing changes in Jira, Slack or your files until you approve it.";
const jiraRow = (state = "", action = button("Connect")) =>
  source("J", "Jira", "Epics, stories and their details", state, action);
const slackRow = (state = "", action = button("Connect")) =>
  source("S", "Slack", "Conversations in channels you pick", state, action);
const folderRow = (state = "", action = button("Choose a folder")) =>
  source(
    "F",
    "A folder",
    "Notes saved as files on this Mac, and its folders. Oriel only reads them.",
    state,
    action,
  );
const workFoot = (connected: boolean) =>
  `<footer class="setup-foot"><div class="left">${connected ? "" : link("Skip for now")}</div>${button("Continue", "primary big", connected ? "" : "disabled")}</footer>`;
const jiraConnected = `<span class="ready">Connected</span> · Payments · 120 issues`;
const folderConnected = `<span class="ready">Connected</span> · Launch notes · 23 files`;
const jiraHelp = (refused: boolean) =>
  `<div class="box">${refused ? "" : "<p>Atlassian lets you make these for apps like Oriel. One has your Jira access and no more, Oriel changes Jira only when you approve, and you can delete it on Atlassian's page any time.</p>"}<ol><li>${link("Open Atlassian's page for them")} (it opens in your browser).</li><li>Click <strong>Create</strong>, name it <strong>Oriel</strong>, pick when it expires (a year is fine), and click <strong>Create</strong>.</li><li>Click <strong>Copy</strong>, then paste it above. Atlassian shows it only once.</li></ol></div>`;

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
    lead: "Three things from your Jira account. Oriel keeps them in your Mac's keychain, with your other passwords.",
    body: `<div class="setup-card form">
<label class="sfield"><span>Your Jira address</span><input placeholder="yourteam.atlassian.net"><span class="hint">The start of the address in your browser when Jira is open.</span></label>
<label class="sfield"><span>The email you sign in to Jira with</span><input placeholder="you@company.com"></label>
<label class="sfield"><span>API token</span><input type="password" placeholder="Paste it here" data-focus></label>
${jiraHelp(false)}
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
    lead: "Three things from your Jira account. Oriel keeps them in your Mac's keychain, with your other passwords.",
    body: `<div class="setup-card form">
<label class="sfield"><span>Your Jira address</span><input value="acme-team.atlassian.net"></label>
<label class="sfield"><span>The email you sign in to Jira with</span><input value="maya@example.com" data-bad></label>
<label class="sfield"><span>API token</span><input type="password" value="xxxxxxxxxxxxxxxx" data-bad><span class="err">Jira didn't accept these two together. Check the email is the one you sign in to Jira with. If it is, make a new one (step 2) and paste it here.</span></label>
${jiraHelp(true)}
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
<div class="spick" data-on><span class="sradio" data-on></span><div><div class="row-name">Payments</div><div class="row-sub">PAY · 120 issues · 8 epics · you worked in it today</div></div></div>
<div class="spick"><span class="sradio"></span><div><div class="row-name">Mobile app</div><div class="row-sub">MOB · 64 issues · 5 epics</div></div></div>
<div class="spick"><span class="sradio"></span><div><div class="row-name">Design requests</div><div class="row-sub">DES · 31 issues</div></div></div>
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
      card(jiraRow(jiraConnected, ""), slackRow(), folderRow()) +
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
    lead: "Slack asked you to approve Oriel in your browser. Pick the channels Oriel reads; it posts only when you approve a message.",
    body: `<div class="setup-card">
<div class="spick"><span class="scheck" data-on></span><div><div class="row-name">#checkout-launch</div><div class="row-sub">14 people</div></div></div>
<div class="spick"><span class="scheck" data-on></span><div><div class="row-name">#payments-team</div><div class="row-sub">22 people</div></div></div>
<div class="spick"><span class="scheck"></span><div><div class="row-name">#design-crit</div><div class="row-sub">9 people</div></div></div>
<div class="spick"><span class="scheck"></span><div><div class="row-name">#random</div><div class="row-sub">140 people</div></div></div>
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
    body: card(jiraRow(jiraConnected, ""), slackRow(), folderRow(folderConnected, "")),
    foot: workFoot(true),
  }),
);
add(
  "28-reading",
  "Reading your work",
  `${top}<main class="setup"><h1>Reading your work</h1><p class="setup-lead">Usually under a minute. Oriel shows your work when it's done.</p>${card(
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
const noWorkstreams = `<div class="win-empty">None yet. Make one from an epic.</div>`;
const oneWorkstream = `<div class="win-item">Checkout v2 <span class="faint">15</span></div>`;
const candidates = (
  made: boolean,
) => `<div class="sec">Not in a workstream yet · ${made ? 7 : 8}</div><div class="rows">
<div class="r"><div><span class="rule">Oriel rule</span> <span class="faint small">An epic no workstream holds</span></div></div>
${made ? "" : `<div class="r"><span>Checkout v2: phone wallets and saved cards</span><span class="faint">15 items · Jira</span></div>`}
<div class="r"><span>Gift cards</span><span class="faint">11 items · Jira</span></div>
<div class="r"><span>Boarding passes and gate scanning</span><span class="faint">9 items · Jira</span></div>
<div class="r"><span>Accessibility fixes</span><span class="faint">7 items · Jira</span></div>
${made ? `<div class="r"><span>Refunds to wallets</span><span class="faint">6 items · Jira</span></div>` : ""}
<div class="r"><span class="link">4 more</span></div>
</div>`;
const workstreamsSection = (made: boolean) =>
  `<div class="sec">Workstreams</div><div class="rows">${made ? `<div class="r"><span>Checkout v2: phone wallets and saved cards</span><span class="faint">15 items · just made</span></div>` : `<div class="r faint">None yet.</div>`}</div>`;
const overview = (o: { hello?: string; ask: string; made?: boolean; chat?: string }) =>
  `<div class="win">${side(o.made ? oneWorkstream : noWorkstreams)}<main class="win-main">
<div class="win-head"><span class="tab" aria-current="page">Overview</span><span class="tab">Browse</span><span class="faint">120 items · ${o.made ? 1 : 0} workstreams · ${o.made ? 7 : 8} epics not in a workstream</span></div>
${o.hello ?? ""}${o.ask}${candidates(o.made ?? false)}
${workstreamsSection(o.made ?? false)}
</main>${o.chat ?? ""}</div>`;
const askBar = `<div class="ask"><div class="input">Ask about your window</div>${button("Ask", "primary")}</div>
<div class="starts"><span class="start" data-hot>Make Checkout v2: phone wallets and saved cards a workstream</span><span class="start">What's in Gift cards?</span></div>`;

add(
  "29-overview",
  "Your window",
  overview({
    hello: `<div class="hello"><span><strong>This is your window:</strong> your Jira and your notes in one place. To follow an epic, make it a <strong>workstream</strong>: Oriel keeps its items, your questions and its changes together. Start with the first question below.</span>${quiet("Dismiss")}</div>`,
    ask: askBar,
  }),
  "",
);
add(
  "30-first-answer",
  "The first answer",
  overview({
    ask: askBar,
    made: true,
    chat: `<aside class="chat"><div class="win-head" style="margin:0"><strong>Window chat</strong><span class="faint" style="margin-left:auto">New chat</span></div>
<div class="bubble">Make Checkout v2: phone wallets and saved cards a workstream</div>
<div class="answer"><p>Done: <span class="chip">Checkout v2</span> is now a workstream in Oriel, with its 15 stories. Nothing changed in Jira. ${link("Undo")}</p><p>4 of its stories are in progress and 5 are to do. 3 have no acceptance criteria yet.</p><p>To plan them, continue in the workstream.</p></div>
<div>${button("Continue in Checkout v2", "primary")}</div></aside>`,
  }),
  "",
);
const criteria = [
  [
    "PAY-34",
    "Pay with a phone wallet",
    "The wallet button shows only on devices that support it; a declined payment keeps the cart.",
  ],
  [
    "PAY-38",
    "Wallet button on the cart page",
    "The button sits above Checkout; tapping it opens the wallet sheet with the cart total.",
  ],
  [
    "PAY-41",
    "Saved cards in account settings",
    "A person sees each saved card's last four digits and can remove one, with Undo.",
  ],
];
const diffRows = criteria
  .map(
    ([key, title, text]) =>
      `<div class="diff-row"><span class="faint">${key}</span><span>${title}<br><span class="faint small">Description</span> <span class="ins">+ Acceptance criteria: ${text}</span></span><span></span></div>`,
  )
  .join("");
const thread = (asked: boolean, applied: boolean) =>
  `<div class="win">${side(oneWorkstream)}<main class="win-main" style="max-width:52rem">
<div class="win-head"><strong>Checkout v2: phone wallets and saved cards</strong><span class="faint">15 items · Jira</span></div>
${
  asked
    ? `<div class="bubble" style="margin-left:auto;width:fit-content">Draft acceptance criteria for the 3 stories that have none.</div>
<div class="answer" style="margin-top:var(--space-3)"><p>Here are drafts, from what each story and the epic already say. Nothing changes in Jira until you approve.</p></div>
<div class="diff">${
        applied
          ? `<div class="applied"><span>✓ Applied in Jira just now: 3 descriptions updated</span><span>${button("Revert")}</span></div>`
          : `<div class="diff-head"><span>Add acceptance criteria to 3 stories in Jira</span><span>${button("Reject")} ${button("Edit")} ${button("Approve and apply", "primary")}</span></div>`
      }${diffRows}</div>`
    : ""
}
<div class="ask" style="margin-top:var(--space-6)"><div class="input"${asked ? "" : ' style="color:var(--text)"'}>${asked ? "Ask about this workstream" : "Draft acceptance criteria for the 3 stories that have none.|"}</div>${button("Ask", "primary")}</div>
</main></div>`;
add("31-change", "A change to approve", thread(true, false), "");
add("32-approved", "Approved", thread(true, true), "");

// Coming back, skipping, and Settings.

add(
  "33-welcome-back",
  "Quit halfway, then reopened",
  setup({
    step: 2,
    done: [1],
    title: "Welcome back",
    lead: "Claude Code is set up. Connect your work to finish; Oriel picked up where you left off.",
    body: card(jiraRow(), slackRow(), folderRow()),
    foot: workFoot(false),
  }),
);
add(
  "34-skipped-ai",
  "The window with no AI set up",
  overview({
    ask: `<div class="ask"><div class="input">Set up Claude or ChatGPT to ask about your window</div>${button("Set up", "primary")}</div><div class="starts"></div>`,
  }),
  "",
);
add(
  "35-settings",
  "Settings: the same rows",
  `<div class="win">${side(oneWorkstream)}<main class="win-main" style="max-width:44rem">
<h1 style="font-size:1.5rem;margin:var(--space-2) 0 var(--space-4)">Settings</h1>
<div class="sec">Your AI</div>
${card(ready("claude", true), missing("codex"))}
<p class="setup-note">${link("Pay Anthropic per question instead")}</p>
<div class="sec">Your work</div>
${card(jiraRow(jiraConnected, quiet("Sync")), slackRow(), folderRow(folderConnected, quiet("Sync")))}
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
