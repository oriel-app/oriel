-- Any source, and groups the user curates (decisions 0018 and 0019). Tables
-- whose constraints change are rebuilt the way SQLite requires: create the
-- new table, copy the rows, drop the old one, rename the new one into place.
-- The runner turns foreign keys off while migrating and checks them before
-- commit. Each old region becomes a group at version 1, so the rows it held
-- keep their meaning.

-- An item's location is a URL, or a file: URL for a local file. Its facets
-- (people, state, container, links) are what groupings use across sources.
alter table items rename column url to location;
alter table items add column facets text not null default '{}' check (json_valid(facets));

create table new_sources (
  workspace_id text not null references workspaces (id),
  kind text not null check (kind in ('jira', 'folder')),
  cursor text,
  synced_at text,
  primary key (workspace_id, kind)
) strict;
insert into new_sources (workspace_id, kind, cursor, synced_at)
  select workspace_id, kind, cursor, synced_at from sources;
drop table sources;
alter table new_sources rename to sources;

-- A group's latest version is its highest change; version 1 is its creation.
create table groups (
  id text primary key,
  workspace_id text not null references workspaces (id),
  name text not null,
  origin text not null check (json_valid(origin)),
  created_at text not null
) strict;

-- One row per version: when it happened and what caused it, the user or a
-- change set applied in one of the group's threads. What it added and removed
-- is in group_members.
create table group_changes (
  workspace_id text not null references workspaces (id),
  group_id text not null references groups (id),
  version integer not null check (version >= 1),
  at text not null,
  cause text not null check (json_valid(cause)),
  primary key (group_id, version)
) strict;

-- Membership at version v: the rows with added_version <= v and either no
-- removed_version or one above v. A member is its source and stable ID;
-- item_id is the handle it had when added. Re-adding a removed item adds a
-- new row.
create table group_members (
  workspace_id text not null references workspaces (id),
  group_id text not null references groups (id),
  source text not null,
  stable_id text not null,
  item_id text not null,
  added_version integer not null,
  removed_version integer,
  primary key (group_id, source, stable_id, added_version),
  check (removed_version is null or removed_version > added_version),
  foreign key (group_id, added_version) references group_changes (group_id, version),
  foreign key (group_id, removed_version) references group_changes (group_id, version)
) strict;

create unique index group_members_live on group_members (group_id, source, stable_id)
  where removed_version is null;

insert into groups (id, workspace_id, name, origin, created_at)
  select id, workspace_id, '',
    case when json_extract(origin, '$.kind') = 'group'
      then json_set(origin, '$.kind', 'cluster') else origin end,
    created_at
  from regions;
insert into group_changes (workspace_id, group_id, version, at, cause)
  select workspace_id, id, 1, created_at, '{"kind":"user"}' from regions;
insert into group_members (workspace_id, group_id, source, stable_id, item_id, added_version)
  select workspace_id, region_id, source, stable_id, item_id, 1 from region_items;

-- A thread follows its group and works in one version of it. Its state is
-- stored, since the user can mark a thread done; done_by says how it got
-- there, and is set exactly when it is done.
create table new_threads (
  id text primary key,
  workspace_id text not null references workspaces (id),
  group_id text not null references groups (id),
  region_version integer not null,
  state text not null check (state in ('working', 'done', 'handed-off', 'dropped')),
  done_by text check (done_by in ('applied', 'marked')),
  created_at text not null,
  check ((state = 'done') = (done_by is not null)),
  foreign key (group_id, region_version) references group_changes (group_id, version)
) strict;
insert into new_threads (id, workspace_id, group_id, region_version, state, created_at)
  select id, workspace_id, region_id, 1, 'working', created_at from threads;
drop table threads;
alter table new_threads rename to threads;

-- A run records the region version it used and how long the guest took to
-- say anything; an aborted run is recorded too.
create table new_runs (
  id text primary key,
  workspace_id text not null references workspaces (id),
  thread_id text not null references threads (id),
  snapshot integer not null,
  region_version integer not null check (region_version >= 1),
  system_prompt_hash text not null,
  dts_hash text not null,
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  wall_ms integer not null,
  cold_start_ms integer,
  outcome text not null check (outcome in ('ok', 'threw', 'timeout', 'limit', 'aborted')),
  started_at text not null
) strict;
insert into new_runs (id, workspace_id, thread_id, snapshot, region_version, system_prompt_hash,
    dts_hash, model, input_tokens, output_tokens, wall_ms, outcome, started_at)
  select id, workspace_id, thread_id, snapshot, 1, system_prompt_hash, dts_hash, model,
    input_tokens, output_tokens, wall_ms, outcome, started_at
  from runs;
drop table runs;
alter table new_runs rename to runs;

-- Every read a run passed to a source, answered or not. Only an answered one
-- has a payload to hash.
create table new_run_reads (
  workspace_id text not null references workspaces (id),
  run_id text not null references runs (id),
  seq integer not null,
  fn text not null,
  args text not null check (json_valid(args)),
  ms integer not null,
  outside_region integer not null check (outside_region in (0, 1)),
  status text not null check (status in ('answered', 'failed', 'unanswered')),
  payload_hash text,
  primary key (run_id, seq),
  check ((status = 'answered') = (payload_hash is not null))
) strict;
insert into new_run_reads (workspace_id, run_id, seq, fn, args, ms, outside_region, status,
    payload_hash)
  select workspace_id, run_id, seq, fn, args, ms, outside_region, 'answered', payload_hash
  from run_reads;
drop table run_reads;
alter table new_run_reads rename to run_reads;

drop table region_items;
drop table regions;
