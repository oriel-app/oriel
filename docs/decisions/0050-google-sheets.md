# 0050 Google Sheets is the next source: only the spreadsheets a person picks, and a row is an item under a mapping they approve

Accepted 2026-11-03. Follows 0049; how Oriel drafts the first mapping is 0051. Amends 0036: its release environment also holds Google's desktop client. Changes SPEC §4, §5 and §8, and the security reviewer's checklist.

Adds: none

Quotes are from Google's pages as fetched on 2026-11-03. **Unsure** marks what those pages don't settle; the first Sheets story checks each against Google before anything depends on it.

**Decision.**

- **Google Sheets first; Excel through the same seam.** The maintainer asked for Excel or Google Sheets, one of them first (2026-11-03), and Sheets is first. Excel follows through 0049's seam, each step its own decision: a local `.xlsx` in a connected folder, read-only, then OneDrive through Microsoft Graph and its own sign-in.
- **Signing in.** Google's OAuth for installed apps, run by the server, with no hosted helper.
  - A Desktop app client, with PKCE (`S256`): "Always use PKCE (Proof Key for Code Exchange) when requesting authorization codes." A `state` is checked on the way back.
  - A loopback redirect. Google takes "`http://127.0.0.1:port` or `http://[::1]:port`", and says to "start an HTTP listener on a random available port". For each sign-in the server opens one on 127.0.0.1, apart from its own port, which takes one request on its one path and then closes, or closes after 5 minutes. Not `localhost`, which "may cause issues with client firewalls", and not a custom URI scheme, which Google says are "no longer supported due to the risk of app impersonation".
  - **Google's Picker, in the same tab.** For a desktop app, the Picker is part of the OAuth request, "Triggered by adding `trigger_onepick=true` to the OAuth request", and "Opens in a new tab of the user's default system browser". Oriel's request adds `prompt=consent`, `trigger_onepick=true`, `allow_multiple=true` and `mimetypes=application/vnd.google-apps.spreadsheet`. The redirect brings back the code and `picked_file_ids`. So the person signs in and picks spreadsheets in one tab of Google's own page, and Oriel's window never runs Google's script.
  - **Picking more** runs the same request again. Google doesn't say whether a new pick adds to the earlier ones or replaces them, so Oriel keeps every ID it was given and checks at each sync that each spreadsheet still reads.
  - **Unsure:** Google's Picker guide doesn't mention PKCE or a loopback redirect. It says only that "The Google Picker imposes no additional restrictions".
  - **The client's secret.** Google says "Desktop apps are public clients and cannot keep secrets confidential". Its API terms, §4(b)(1), say "Developer credentials may not be embedded in open source projects." So the client's ID and secret are never in the repo: the release workflow writes them into the app it builds, from its environment, and `pnpm dev` reads them from `.env`. That environment held only the signing certificate and the notarization credential (0036), and now holds this client too. **Unsure:** whether a released app built from the open repo counts as embedding them is for the maintainer to confirm.
  - **Tokens.** Google: "Note that refresh tokens are always returned for installed applications." The newest refresh token, and the access token while it lasts, are the connection's secret (0049) and go nowhere else. Google caps refresh tokens per client and person, after which "older refresh tokens will stop working", so Oriel keeps one per connection. A refresh Google refuses marks the connection signed out, with Sign in again, which keeps the connection.
  - **One scope, asked once.** "Incremental authorization is not supported for installed apps or devices."
- **The smallest scope: `drive.file`, with the Picker.**
  - `drive.file` is "See, edit, create, and delete only the specific Google Drive files you use with this app." It is non-sensitive, and the only scope the desktop Picker takes: "only the `drive.file` scope is permitted for these apps and it can't be combined with any other scope." Oriel sees only the spreadsheets the person picks, as it reads only the folder they pick and Slack's picked channels.
  - `spreadsheets.readonly` ("See all your Google Sheets spreadsheets") and `spreadsheets` are sensitive. They reach every spreadsheet the person can open, and need "additional OAuth App Verification". Until it passes, Google shows its unverified-app screen ("An unverified app is an app or Apps Script that requests a sensitive or restricted OAuth scope") and caps the app at "100 new users in total".
  - `drive.readonly` and `drive` are restricted. They need restricted-scope verification, renewed yearly, and "If you store restricted scope data on servers (or transmit), then you must go through a security assessment."
  - With `drive.file` alone: "If your app utilizes only non-sensitive scopes, it is not mandatory for your app to complete the app verification process." Brand verification is only what shows Oriel's name and logo on Google's consent page. As far as Google's pages say, there is no unverified-app screen, user cap or security assessment.
  - While the consent screen is in testing, "Authorizations by a test user will expire seven days from the time of consent", refresh tokens included, for at most 100 test users. Dogfooding signs in again weekly until the app is published.
  - The cost: Oriel can't list the person's spreadsheets or find one by name. The person picks each one, which is the point.
- **What the maintainer creates,** once, in Google's Cloud console:
  1. A project for Oriel, owned by the maintainer.
  2. In it, the Google Sheets API, the Google Drive API and the Google Picker API, turned on.
  3. The consent screen's branding: the name Oriel, a support email, the logo, a home page and a privacy policy page, on a domain verified as the maintainer's.
  4. Its audience: External, in testing first, with the maintainer's and the personas' Google accounts as test users; published to production once the privacy policy is live.
  5. Its data access: `https://www.googleapis.com/auth/drive.file` and nothing else.
  6. One OAuth client of type Desktop app, for macOS, Windows and Linux alike. Google: "If your app runs on multiple platforms, you must create a separate client ID for each platform"; a desktop client is one platform.
  7. Its ID and secret in the release workflow's environment, and as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` for `pnpm dev`, never committed.
  8. Brand verification, when publishing.
  9. A test Google account holding the synthetic spreadsheets, seeded from `fixtures/sheets/` by a script, as Slack's test workspace is (0021).

  Every Oriel user's requests count against this project's quotas, and Google says "Exceeding the quota request limits is planned to incur charges to your Google Cloud billing account later in 2026." Sync keeps requests few by design.

- **What an item is.**
  - A row in a tab is an item, under the tab's mapping from columns to Oriel's fields:
    - title, which is required;
    - status, shown as the cell says it, and which of its values mean to do, in progress and done, if any, which is the state facet. A RAG column is a status with no state: red isn't a stage;
    - assignee, estimate, a link, and parent or epic: a column naming another row by its key, in this tab or another mapped one, which becomes its container. An epic column of names that aren't rows stays content, never a made-up parent (0019); a grouping by a column is a later decision;
    - the key (Row identity).
  - Every other column the person can see is the item's content, as `Header: value` lines in column order, so nothing they see in the row is kept from the agent.
  - A mapping names its columns by their headers, so inserting or moving a column changes nothing. It also says which row is the header; where the table ends, by a rule that survives inserted rows (its first blank row, by default), so a notes block below it isn't items; and whether rows hidden by hand are read.
  - A tab with no mapping isn't read.
  - Sheets that aren't trackers map the same way. A RAID log's row is an item: its title is the description, its status the status column, its assignee the owner, and its type (risk, assumption, issue or dependency) is content. A plain table maps a title alone, and its rows are items to read and cite, with no state.
  - Each picked spreadsheet is one more item, a doc: its title, its tabs' names and its comments.
  - The person sets a mapping in Settings (0049), and the agent drafts the first one (0051).
- **Row identity, the hardest edge.** Rows move, get sorted, inserted and deleted.
  - **A key column the person picks.** The agent suggests one in its draft: a column whose values are all present and unique, such as an ID, a ticket number or a feature's name. An item's key is a fixed-length hash of the spreadsheet's ID, the tab's ID (its `sheetId`, which survives a rename) and the key's value, trimmed. So no text a person wrote reaches a key, as 0019 hashes a file's path. Sorting, moving, inserting and deleting other rows change nothing.
  - **When it breaks:**
    - An edited key: the old item is gone, a tombstone its regions degrade around, and the row is a new item, as a renamed file is (0019). The marker says so.
    - Two rows with one key, or a row with none: neither is an item until it's fixed. The connection lists them in Settings by row number, for the person to fix in the sheet. Oriel never picks one by position, since a sort would swap them, and never writes to a row that isn't an item, which it could find only by position.
    - A mapped column renamed or removed, the key's or any other's, or its header found twice: that tab's sync stops, names the column, and keeps what the index had, as a failed sync does. The agent can draft a new mapping (0051).
    - A new key column: every row of that tab becomes a new item. Settings says so before it applies.
  - **No unique column:** Settings asks the person to add one in the sheet, such as an ID column, and pick it.
  - **Not Google's developer metadata.** Google caps it at "30,000 characters" per sheet and per spreadsheet, about a thousand tagged rows. It says only that metadata "remains associated at those locations as the spreadsheet is edited", not what a sort, move or copy does to a row's, and that it "might be exposed to users with view access to the document". Nobody can see it to repair it, and tagging rows writes to the person's sheet, which needs a change set anyway.
  - **Not row numbers,** which a sort renames.
- **Writes.**
  - Editing a mapped cell and adding a row are mutations in a change set (0003), made through the namespace's functions, which take Oriel's field names, never a header. A read-only connection offers none (0049), and a spreadsheet the person can only view, by Drive's `capabilities.canEdit`, is read-only.
  - **Apply** finds the row again by its key, since rows move, then reads the cell, and writes only if the cell still holds what the change set saw. A mismatch is a conflict, never an overwrite (SPEC §7).
  - **Values only.** Cells are written with `valueInputOption=RAW` ("The values the user has entered will not be parsed and will be stored as-is."), or as typed values in a `batchUpdate`, never as a `formulaValue`. So a value starting with `=` is stored as text, and can't become a formula. **Unsure:** Google's page doesn't mention formulas, so a live test proves it before any write ships.
  - **No formula is overwritten or evaluated.** The writer reads the cell's `userEnteredValue`, and refuses a mutation whose cell holds a `formulaValue`. Oriel never evaluates a formula: it reads the values Google computed.
  - **The race.** Sheets has no conditional write, so a sort between finding the row and writing to it could slide another row under the write. Apply reads the row back after writing. If the key isn't there, the mutation fails and names the row that took it. Each mutation's status and its row's key are recorded as soon as Google answers (SPEC §7), so a retry skips what landed.
  - **Revert** writes the before value back only where the cell still holds what Oriel wrote. A row Oriel added is deleted only if nobody has changed it since.
  - An edit is `values.batchUpdate`, with `RAW`. A new row is inserted after the table's last row and filled in the same `batchUpdate`, with typed values. Not `values.append`, which places a row by the table Google detects, and could put it below a notes block. A revert's delete is a `deleteDimension`.
- **Injection.** Anyone with edit access writes the cells. Cells, headers, notes, comments, tab names and the spreadsheet's title are all synced content: data, which reaches the model only in tool results, never in the system prompt or the `.d.ts` (SPEC §5). No header becomes a name in generated code. The first mapping is where an injection would aim, so a draft names columns by letter and fields by Oriel's names, and Oriel draws the sheet's headers beside them itself (0051).
- **Sync.**
  - **What changed.** A sync asks Drive for each picked spreadsheet's `version`, "A monotonically increasing version number for the file. This reflects every change made to the file on the server", and reads only those whose version moved, or whose mapping changed: applying a mapping re-reads its spreadsheet at once. An unchanged spreadsheet costs one Drive request.
  - **Reading.** `spreadsheets.get`, with a field mask for the mapped tabs' values, notes, hidden rows and merges, in chunks of rows near Google's recommended "2 MB maximum payload". A request that runs "more than 180 seconds" fails, which keeps chunks small.
  - **Not the Drive changes feed.** Google's page doesn't say whether it is limited to `drive.file`'s files, and its push notifications need a public address the app doesn't have. **Not revisions:** `headRevisionId` "is currently only available for files with binary content".
  - **Big sheets.** Caps, as the folder's walk has: 5,000 rows a tab, 20 tabs and 50 spreadsheets a connection, and 50,000 characters an item. Past a cap, the connection says what it didn't read.
  - **Many tabs.** Each mapped tab is read, and no other.
  - **Merged cells.** A value merged down several rows is that value on each of them, as a tracker's epic merged down its stories means. One merged across columns belongs to the leftmost.
  - **Hidden rows and columns.** Rows hidden by hand are skipped unless the mapping reads them. Rows hidden by a filter are read, since a filter is someone's view, not the table. A hidden column is read only when mapped.
  - **Rate limits.** Sheets allows "Per minute per user per project 60" reads, and 300 per project, which every Oriel user shares; writes the same. A `429` backs off exponentially, as Google says, and the connection shows it's waiting.
  - **How often:** 0049's option, by default when Oriel starts and when asked.
- **Comments.** Google keeps where a Sheets comment points opaque: "The Drive API treats this data as opaque and can't resolve internal document regions, cell coordinates, or slide elements." So comments are read with their spreadsheet's item, never pinned to a guessed row. Cell notes are read with their rows. **Unsure:** Google's comments guide doesn't say whether `drive.file` may list comments; if it may not, they aren't read.
- **Which account.** 0049 knows the same Google account connected again by Drive's `about.user.permissionId`, and names the connection by the account's email, if `drive.file` may read `about` (**Unsure**). If it may not, each connection is new, named "Google Sheets". Either way, a spreadsheet another live connection already reads is refused when picked, as 0049 refuses a folder inside a connected one, so no row is two items.
- **Terms.**
  - Google's API terms, §3(d): Oriel follows Google's user-data policy, and must "provide and adhere to a privacy policy" that "clearly and accurately describes" what it collects and how it uses and shares it.
  - Google's Workspace user-data policy covers Sheets and Drive. Its Limited Use rules "apply to data derived from both Sensitive and Restricted scopes", and `drive.file` is non-sensitive, so whether they bind Oriel isn't clear. Oriel keeps them anyway: Google data only for features the person sees; transferred only to provide those, "only with the user's consent"; never for ads; and never "to create, train, or improve a machine learning or artificial intelligence model".
  - **Sending cell content to the person's AI, under their own plan,** is a transfer to provide what the person sees and asked for. Consent comes first, in the app: Google says notice "Cannot be placed only in a privacy policy or terms of service", and "You must not begin collection prior to obtaining affirmative consent." So the connect step says, before Google's page opens: "Oriel reads only the spreadsheets you pick, keeps an index of them on this Mac, and sends what a question needs to your AI, under your plan."
  - **Open:** a consumer Claude plan may let Anthropic train on a person's chats, if they allowed it. Whether Oriel's transfer then helps "train, or improve" a model is Google's to answer. The maintainer asks before pilots, as 0038 has them ask Anthropic about plans. An API key, under Anthropic's commercial terms, is the other way.
  - **Caching.** The API terms, §5(e)(1), forbid keeping "cached copies longer than permitted by the cache header", or building databases, unless the content's owner allows it. Oriel's index keeps the minimum (SPEC §7) on the person's own machine at their request, and disconnecting deletes it (0049). **Unsure:** whether the index counts as a cached copy. The privacy policy says plainly what it keeps.
  - **The privacy policy** says what Oriel reads (the picked spreadsheets only), where it keeps it (the person's machine, tokens in the OS secret store), what leaves the machine (what a question needs, to the AI the person chose, under their plan or key), what Oriel never does (sell, advertise, train or share), how to disconnect and delete, and whom to contact. It carries Google's Limited Use statement, which begins "The use of information received from Google Workspace scopes will adhere to the Google User Data Policy".
- **Fixture** (SPEC §8): `fixtures/sheets/`, written-down spreadsheets with their tabs, cells, notes, merges, hidden rows and columns, comments and versions, served by an in-memory stand-in for the Sheets and Drive APIs, as Slack's fixture is.

**Why.**

- Sheets can be read and written live, so it tries the whole seam: a browser sign-in, a picker, options, a mapping and writes. Excel's local file is read-only and needs a parser, and OneDrive needs its own sign-in.
- `drive.file` with the Picker is the narrowest access Google offers, and the only way with no sensitive-scope review, unverified-app screen or user cap.
- A key column is in plain sight, survives sorting, and needs no write to set up. When it breaks, it breaks visibly, and the person can see why and fix it.

**Rejected.**

- `spreadsheets.readonly`, `spreadsheets`, `drive.readonly` and `drive`. See the scope.
- Developer metadata, and row numbers. See Row identity.
- **An ID column Oriel adds through a change set.** Until it exists, the rows aren't items, so its writes could find them only by position, which a sort breaks.
- **A hosted helper for the sign-in.** It would hold the client's secret and see every code. The review relay stays the one hosted piece (0036).
- **Google's web Picker in Oriel's window.** It would run Google's script in Oriel's page, and the desktop Picker opens in the browser anyway.
- **Writing with `USER_ENTERED`, or evaluating formulas in Oriel.**
- **An MCP server for Sheets** (0049).

**Consequences.**

- SPEC §4 adds Google Sheets, §5 its tokens and client, and §8 its fixture checklist.
- 0036: the release environment holds Google's desktop client too. The release workflow is the maintainer's to change.
- The security reviewer looks for a Sheets write that isn't `RAW` or a typed value, writes a formula, or overwrites one, and a loopback listener that takes more than its one redirect, listens beyond 127.0.0.1, or skips PKCE or `state`.
- The maintainer's setup comes before the first Sheets story, which checks each **Unsure** above against Google.
- The build stories, in order, are in the pull request.

**Amended by OA-219, 2026-11-03.** Partly settled by the live run of 2026-11-03; the rest is pending. `packages/sheets` signs in as Signing in says, and `pnpm sheets:live` runs it once against Google, as the maintainer's desktop client: it signs in, takes the picked spreadsheets back from the redirect, reads each one's Drive `version`, asks the reads below, refreshes, revokes the grant, and refreshes again. Each **Unsure**:

- **The desktop Picker with PKCE and a loopback redirect:** it works. Google took the `S256` challenge and the redirect to `http://127.0.0.1:<port>/`, showed the Picker after consent in the same tab, and sent the code back with `picked_file_ids`. One pick brought back four spreadsheets, so `allow_multiple` works, and Drive's `version` read for each under `drive.file`.
- **Whether `drive.file` may read `about`** (Which account): pending.
- **Whether `drive.file` may list a picked spreadsheet's comments** (Comments): pending.
- **Formulas under `RAW`** (Writes): not settled by this story, which writes nothing. The first story that writes proves it live, as Writes says.
- **Whether a released app built from the open repo embeds the client** (The client's secret): the maintainer's to confirm, as before; no run settles it.
- **Whether the index is a cached copy** (Terms): a question of Google's terms, which no run settles. The privacy policy says what the index keeps.

The run also checks what 0050 assumed without marking it: that the Sheets API reads a picked spreadsheet under `drive.file`, and that a refresh after the grant is revoked is refused (`invalid_grant`), which Oriel reads as signed out.
