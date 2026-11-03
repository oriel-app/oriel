# First-run setup prototype (OA-190, OA-191)

Static screens of the desktop app's first run, for decision 0038. Not product code: plain HTML over `packages/web/assets/window.css`, built by `node build.ts` into `screens/`, and photographed at 1280×800 and 960×640 by `node shoot.ts` into `png/`.

## Flow order

The AI: `01` checking → `02` already installed and signed in (one click) · `03` both ready · `04` neither installed → Claude: `05` installing → `06` installed, not signed in → `07` signing in → `08` ready · Codex: `09`–`12` the same → when it goes wrong: `13` a plan without Claude Code · `14` another account · `15`–`16` the install stopped, with details · `17` sign-in didn't finish · `18` the last resort, Terminal · `19` too old · `20` an API key.

Your work: `21` the sources → `22` Jira → `23` Jira refused → `24` the project → `25` the folder picker → `26` Slack's channels → `27` connected → `28` reading.

After: `29` the overview, first run → `30` the first answer → `31` a change to approve → `32` approved. Also: `33` reopened halfway, `34` the AI skipped, `35` Settings with the same rows.

Added after the design critique: `36` the test turn meets a usage limit · `37` a source fails to read · `38` a version newer than Oriel works with · `39` the window with only a folder, which Oriel only reads.

## Walkthroughs

Two agents walked round 1, each given only a persona and the screenshots in order. Both guessed about 11 minutes from the first screen to an approved change, four of them on Jira's token. Both said they'd stop at Terminal.

| Finding (who)                                                                                                                        | Round 2                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Claude Code" and "Codex" sound like programmers' tools; why install anything when the website works? (both)                         | Rows lead with the plan ("For Claude Pro and Max"); a line says Oriel can't use the website, so it works through the maker's free assistant, which uses the same plan     |
| Will IT notice, will it ask for my password, where does company data go? (ChatGPT)                                                   | "No admin password, and nothing outside your own folder"; the work step says Oriel keeps it on this Mac and only what a question needs goes to the AI, under the plan     |
| The install bar looks stuck, and something unseen is running (ChatGPT)                                                               | Named phases, downloading → setting up → checking it's genuine, with the time so far                                                                                      |
| Can Oriel now read my chats? Then hunting for Oriel's window after Authorize (both)                                                  | The waiting box says the page asks to let Claude Code use the account, Oriel never sees chats or password, and Oriel comes to the front by itself                         |
| Jira's token is the wall, about 4 minutes; the box said "read Jira", then Oriel wrote to it; the steps skip the expiry choice (both) | The box says Oriel changes Jira only when you approve; the steps name the expiry; signing in with Atlassian in the browser is a follow-up                                 |
| The refusal drops the help and says to copy it again, though Atlassian shows it once (ChatGPT)                                       | The help stays; it says make a new one                                                                                                                                    |
| The address and email looked filled in already (ChatGPT)                                                                             | Placeholders, not values                                                                                                                                                  |
| The project list was blank (both)                                                                                                    | A class clash in the prototype, fixed; the likeliest project is picked and highlighted                                                                                    |
| "Skip for now" beside an enabled Continue (both)                                                                                     | Skip shows only while nothing is connected                                                                                                                                |
| "Your window opens": which window? (both)                                                                                            | "Oriel shows your work when it's done"                                                                                                                                    |
| "Workstream", "window" and "ORIEL RULE" never explained; 8 counted, 4 shown (both)                                                   | A one-time line says what the window and a workstream are; "4 more" under the list                                                                                        |
| Asked "Should…?", and Oriel acted, which read as breaking "nothing changes until you approve" (both)                                 | The question is an instruction, "Make … a workstream"; the answer says it's in Oriel and Jira is untouched; the sidebar shows it; the promise names Jira, Slack and files |
| A message they didn't type; "3 what?"; estimates are the engineers' call (both)                                                      | The change is a PM's: acceptance criteria, with the field named, and Edit beside Approve                                                                                  |
| "Check that you're online" doesn't help at work; "another way" means Terminal (both)                                                 | It says a work network can block it, to send the details to IT, and that nothing changed                                                                                  |
| A code showed in the browser and had nowhere to go (Claude)                                                                          | Oriel never opens the page that shows a code, so the copy no longer mentions one                                                                                          |
| Use another account signs straight back into the same account (Claude)                                                               | It says to check the account in the tab and sign out of claude.ai there first                                                                                             |
| The API key path: how much? (ChatGPT)                                                                                                | It says Anthropic bills per question and the person can set a monthly limit there                                                                                         |
| With the AI skipped, the sidebar said "or ask Oriel to" (ChatGPT)                                                                    | Removed                                                                                                                                                                   |

Declined: a field to paste the code the vendor's page shows, since it would pass a sign-in code through Oriel (0038, the vendors' terms); signing in with Atlassian now, which needs an Atlassian app and somewhere to keep its secret.

## Design critique

Codex Sol read decision 0038 and these screens: changes asked, two blockers and seven shoulds. All nine taken; the decision's text carries the fixes.

| Finding | Change |
| --- | --- |
| D1 blocker: a folder alone can't reach an approved change set | With a folder alone the first run ends at the first answer, and the overview says changes need Jira or Slack (`39`) |
| D2: one completion fact can't remember a skip, or which AI was picked | The setup stores each step done or skipped; the AI picked is a setting |
| D3: the test turn's failures had no screen | A usage limit, no connection, no access and a refused configuration each get a sentence and a way on (`36`) |
| D4: a sync that fails or reads nothing had no screen | Per-source failure with Try again and Change; the overview opens with what's ready (`37`) |
| D5: Update can't fix a version too new, and the installer could install one | Too new says Oriel's next update will support it; Oriel names a supported version to the installer (`38`) |
| D6 blocker: Claude's installer runs the binary before Oriel can check it | The decision says whom the install trusts: the vendor's installer and manifest; Oriel's own signature check guards Oriel's launches |
| D7: the installer would run with the person's PATH | A fixed system PATH, and `codesign` and `spctl` by absolute path |
| D8: the budget's measurement mixed people and scripts | Three timed paths; telemetry measures people, the scripted run Oriel's part |
| D9: "nothing changed on your Mac" claims more than a failed install proves | "Didn't finish installing" (`15`, `16`) |
