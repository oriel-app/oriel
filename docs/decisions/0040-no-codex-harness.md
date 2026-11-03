# 0040 Codex can't be the harness yet

Accepted 2026-11-03. Applies 0036's Model use rule to Codex and settles 0037's "Codex isn't built yet". Changes SPEC §7. Superseded by 0048: the maintainer overruled it, accepting that Codex loads the person's own settings, can read files from its read-only sandbox, and can't report its tools, and Codex runs as a preview with as much of the lock-down as it allows.

Adds: none

**Decision.**

- **Oriel doesn't run its agent or thread titles on Codex.** 0036 supports a command-line agent only if it can report exactly one tool, `run`, with every user, managed and project configuration off, so the harness can refuse to run otherwise. Codex 0.166.0 can't do that in any mode, so there is no Codex `Provider` or `Titler`, and no Codex code.
- **What a person with only Codex sees.** The model check looks for `codex` on the same PATH it searches for Claude Code, or at a path set in Settings. It only checks that the file is there. It never runs it, reads its folder or touches its sign-in. If Codex is there and Claude Code isn't, the setup message says so plainly: "Oriel can't run on Codex yet, because Codex can't be limited to Oriel's one tool. Install Claude Code and sign in to it, or add an API key." The server prints the same line. Everything else is 0037's no-model state. The first-run setup (OA-190) and the Settings provider list (OA-181) show Codex as found but not supported, with that reason, and never as a choice. This decision changes no code. Those stories build the message.
- **What Codex would need.** Oriel builds the harness when one release offers all three of these:
  1. **Only Oriel's tool.** A way for the client to say which tools the model gets. Codex already has one inside: `ToolPolicy.allowed_tools` in its extension API, which only its own reviewer extensions set. As a `thread/start` parameter or a `-c` key, it would remove every tool listed below.
  2. **No user configuration, on the person's own sign-in.** `codex exec --ignore-user-config` already does this. The app server, the mode that takes tools from the client, needs the same option.
  3. **A report of the tools the model sees,** made when a thread starts, before the first response. Either the `thread/start` response or an `exec --json` event would do. Managed configuration (`managed_config.toml`, and MDM on macOS) outranks every command-line flag, so only that report shows what a company's settings added, and the harness refuses on anything but `run`.
- **Revisit** for each Codex release that changes `codex exec --help` or the output of `codex app-server generate-ts --experimental`, and when someone asks for Codex.

**Why.**

Measured on the maintainer's Mac against Codex 0.166.0, by pointing Codex at a local stand-in model endpoint and capturing the tools in its request. Codex ran with an empty temporary `CODEX_HOME` and no sign-in, so nothing of the person's was read, used or changed. Codex's source (`openai/codex`, `codex-rs`) explains each result.

|                                                                 | tools the model gets                                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `exec`, defaults                                                | `exec_command`, `write_stdin`, `request_user_input`, `view_image`, sub-agents, 3 goal tools, web search, and a skills list |
| `exec --ignore-user-config`, every switch off, `run` over MCP   | `run`, `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`                                            |
| … the same, with a real model's metadata (`gpt-5.5`)            | those, `apply_patch`, and `tool_search`, with `run` hidden behind the search                                               |
| app server, every switch off, `run` as a client tool, `gpt-5.5` | `run`, `apply_patch`                                                                                                       |

- **`exec` can't hold Oriel's tool alone.** It's the only mode that skips `config.toml` and keeps the sign-in. But it takes no client tools ("dynamic tool calls are not supported in exec mode"), so `run` has to be an MCP server. With any MCP server configured, Codex always adds the three MCP resource tools (`add_mcp_resource_tools` in `core/src/tools/spec_plan.rs`), and nothing switches them off.
- **The app server can hold it, but always loads the person's config.** Its `dynamicTools` would carry `run` over its own stdin and stdout, like 0037's control channel, with no second process. But it has no `--ignore-user-config`, so their MCP servers, `notify` command, model provider, profiles and the rest all load. Overriding them one by one is the deny list 0037 rejected.
- **`apply_patch` comes from the model's metadata, not from configuration.** It's added whenever the model catalog sets `apply_patch_tool_type`, which it does for the models a subscription serves. The only way around it is replacing Codex's whole model catalog with one Oriel writes (`model_catalog_json`). That would break whenever the catalog changes, and it still leaves a file-editing tool if a later version reads the type from elsewhere.
- **Neither mode reports its tools,** so the harness can't check them. `managed_config.toml` and MDM outrank `-c` flags. A system `config.toml` and the cloud-managed bundle sit below the flags but can add keys Oriel never sets, such as another MCP server. Without a report, a company's managed settings could add tools the harness never sees, and 0036 requires the check because that configuration exists only on the person's machine.
- Each of the switches that did work is a feature flag or config key Oriel would have to know about. A tool added by a later release would be on until Oriel learned its name.

**Rejected.**

- **Running Codex anyway, with the resource tools and `apply_patch` allowed.** The resource tools reach only Oriel's server, which serves no resources, and the empty working folder limits the patch tool. But 0036's check is "exactly one tool", and without a report there's nothing to check. A harness that can't refuse can't be the one that runs on synced content.
- **Moving `CODEX_HOME` to an empty folder.** That moves the sign-in with it. Linking or copying `auth.json` into that folder, or passing a token in the environment, means Oriel handles the person's credentials. 0020 and 0036 forbid that.
- **A probe run against a stand-in model before each turn,** to read the tools Codex would send. A stand-in provider changes which tools Codex offers, and it can't sign in, so it may not see cloud-managed settings. It checks a different process than the one that runs.
- **Overriding the person's config key by key on the app server.** That's a deny list. Each new key or MCP server they add would pass until Oriel learned to block it.

**Consequences.**

- SPEC §7: the desktop app's command-line agent is Claude Code for now.
- 0037's harness stays the only one. `chooseModel`'s `prefer` keeps its two values, `"api"` and `"claude-code"`.
- OA-190 and OA-181 show Codex as found but not supported, with the reason above. They never offer it as a choice and never point anyone at its sign-in.
- If Codex adds the three things above, the harness is a second implementation of 0037's seam, an app-server client over stdin and stdout with `run` as its one client tool. It gets its own decision and live tests, with a planted config, skills, hooks and an MCP server that must not load.
