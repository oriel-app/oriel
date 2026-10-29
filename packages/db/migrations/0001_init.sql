-- Phase 1 schema. Every table carries workspace_id, though there is one
-- workspace (SPEC §7). Times are canonical UTC instants stored as text, so they
-- sort. JSON columns are checked with json_valid. Thread state and telemetry
-- metrics are derived from these tables, never stored.

create table workspaces (
  id text primary key,
  name text not null,
  created_at text not null
) strict;

-- Where each source's next sync resumes, and when its last complete sync
-- finished (the right rail's stale marker).
create table sources (
  workspace_id text not null references workspaces (id),
  kind text not null check (kind in ('jira')),
  cursor text,
  synced_at text,
  primary key (workspace_id, kind)
) strict;

-- A sync that changed the index takes the next snapshot version.
create table snapshots (
  workspace_id text not null references workspaces (id),
  version integer not null,
  source text not null,
  taken_at text not null,
  primary key (workspace_id, version)
) strict;

-- The index: the minimum per item for grouping, summaries and search. Identity
-- is (source, stable_id); item_id is the current handle. gone_at marks a
-- tombstone. Only live items need unique handles: a recreated project reuses
-- keys that tombstones still hold.
create table items (
  workspace_id text not null references workspaces (id),
  source text not null,
  stable_id text not null,
  item_id text not null,
  title text not null,
  url text not null,
  updated_at text not null,
  attrs text not null check (json_valid(attrs)),
  snapshot integer not null,
  gone_at text,
  primary key (workspace_id, source, stable_id)
) strict;

create unique index items_live_handle on items (workspace_id, item_id) where gone_at is null;

create table regions (
  id text primary key,
  workspace_id text not null references workspaces (id),
  origin text not null check (json_valid(origin)),
  snapshot integer not null,
  created_at text not null
) strict;

-- item_id is the handle the item had when the region was created; seq keeps
-- the order it was snapshotted in.
create table region_items (
  workspace_id text not null references workspaces (id),
  region_id text not null references regions (id),
  seq integer not null,
  source text not null,
  stable_id text not null,
  item_id text not null,
  primary key (region_id, source, stable_id),
  unique (region_id, seq)
) strict;

create table threads (
  id text primary key,
  workspace_id text not null references workspaces (id),
  region_id text not null references regions (id),
  created_at text not null
) strict;

create table messages (
  id text primary key,
  workspace_id text not null references workspaces (id),
  thread_id text not null references threads (id),
  seq integer not null,
  role text not null check (role in ('user', 'agent')),
  content text not null check (json_valid(content)),
  at text not null,
  unique (thread_id, seq)
) strict;

create table runs (
  id text primary key,
  workspace_id text not null references workspaces (id),
  thread_id text not null references threads (id),
  snapshot integer not null,
  system_prompt_hash text not null,
  dts_hash text not null,
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  wall_ms integer not null,
  outcome text not null check (outcome in ('ok', 'threw', 'timeout', 'limit')),
  started_at text not null
) strict;

-- Arguments and a payload hash per proxied read, never the payload.
create table run_reads (
  workspace_id text not null references workspaces (id),
  run_id text not null references runs (id),
  seq integer not null,
  fn text not null,
  args text not null check (json_valid(args)),
  ms integer not null,
  outside_region integer not null check (outside_region in (0, 1)),
  payload_hash text not null,
  primary key (run_id, seq)
) strict;

-- run_id is null for a revert, which no run produced.
create table change_sets (
  id text primary key,
  workspace_id text not null references workspaces (id),
  thread_id text not null references threads (id),
  run_id text references runs (id),
  hash text not null,
  revert_of text references change_sets (id),
  created_at text not null
) strict;

-- `applied` is set exactly when the status is applied. `reverts` links a
-- reverse mutation to the one it undoes, so applying it can recheck that
-- mutation's `applied.after` for conflicts.
create table mutations (
  id text primary key,
  workspace_id text not null references workspaces (id),
  change_set_id text not null references change_sets (id),
  seq integer not null,
  op text not null,
  target text,
  ref text,
  args text not null check (json_valid(args)),
  preview text check (preview is null or json_valid(preview)),
  status text not null check (status in ('pending', 'applied', 'failed')),
  applied text check (applied is null or json_valid(applied)),
  error text,
  reverts text references mutations (id),
  unique (change_set_id, seq),
  unique (change_set_id, ref),
  check ((status = 'applied') = (applied is not null))
) strict;

-- Every decision is kept. The highest seq counts, and only while its hash
-- matches the change set's.
create table decisions (
  id text primary key,
  workspace_id text not null references workspaces (id),
  change_set_id text not null references change_sets (id),
  seq integer not null,
  kind text not null check (kind in ('approved', 'rejected')),
  via text not null check (via in ('thread', 'review-link')),
  by_name text not null,
  hash text not null,
  at text not null,
  unique (change_set_id, seq)
) strict;

-- Only the token's hash is stored, so a copy of the database holds no live
-- links. A change set has at most one live link: minting a new one revokes the
-- old.
create table review_links (
  token_hash text primary key,
  workspace_id text not null references workspaces (id),
  change_set_id text not null references change_sets (id),
  created_at text not null,
  expires_at text not null,
  revoked_at text
) strict;

create unique index review_links_one_live on review_links (change_set_id) where revoked_at is null;

create table telemetry_events (
  id text primary key,
  workspace_id text not null references workspaces (id),
  name text not null,
  at text not null,
  data text not null check (json_valid(data))
) strict;

create index telemetry_by_name on telemetry_events (workspace_id, name, at);
