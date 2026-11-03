-- Core keeps no list of kinds (decision 0049), so `sources` takes any, and a
-- new connector needs no migration. SQLite can't drop a check constraint, so
-- the table is rebuilt with its cursors and sync times as they were.
create table new_sources (
  workspace_id text not null references workspaces (id),
  kind text not null,
  cursor text,
  synced_at text,
  primary key (workspace_id, kind)
) strict;
insert into new_sources (workspace_id, kind, cursor, synced_at)
  select workspace_id, kind, cursor, synced_at from sources;
drop table sources;
alter table new_sources rename to sources;
