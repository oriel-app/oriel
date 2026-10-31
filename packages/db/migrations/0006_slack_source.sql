-- Slack is a source (decision 0021). SQLite can't change a check constraint,
-- so `sources` is rebuilt with its cursors and sync times as they were.
create table new_sources (
  workspace_id text not null references workspaces (id),
  kind text not null check (kind in ('jira', 'folder', 'slack')),
  cursor text,
  synced_at text,
  primary key (workspace_id, kind)
) strict;
insert into new_sources (workspace_id, kind, cursor, synced_at)
  select workspace_id, kind, cursor, synced_at from sources;
drop table sources;
alter table new_sources rename to sources;
