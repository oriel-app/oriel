-- A group is called a workstream now (OA-98). Only names change: each table
-- and column is renamed in place, which SQLite carries into the foreign keys
-- and indexes that name it, so every row stays as it was. The indexes take
-- the new word too.
alter table groups rename to workstreams;
alter table group_changes rename to workstream_changes;
alter table group_members rename to workstream_members;
alter table user_named_groups rename to user_named_workstreams;

alter table workstream_changes rename column group_id to workstream_id;
alter table workstream_members rename column group_id to workstream_id;
alter table user_named_workstreams rename column group_id to workstream_id;
alter table threads rename column group_id to workstream_id;

drop index groups_by_workspace;
create index workstreams_by_workspace on workstreams (workspace_id, created_at);
drop index threads_by_group;
create index threads_by_workstream on threads (workstream_id, created_at);
drop index group_members_live;
create unique index workstream_members_live on workstream_members (workstream_id, source, stable_id)
  where removed_version is null;

-- A workstream made for a thread from nothing is called "New workstream"
-- until a change set names it after its epic. One still called "New group",
-- by Oriel, takes the new name, so that still happens.
update workstreams set name = 'New workstream'
where name = 'New group'
  and json_extract(origin, '$.kind') = 'thread'
  and id not in (select workstream_id from user_named_workstreams);
