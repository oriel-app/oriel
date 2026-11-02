-- A workstream ends done or deleted (decision 0028).
-- Each time it was marked done: when, by whom (the actor's JSON, as
-- done_marks has it) and the threads that mark marked done, each with that
-- same time. Marked again once a thread worked in it, it gains a mark.
-- Reopening it takes off every mark, and each reopens only its threads; an
-- Undo takes off only its own. It is done while it has a mark and none of
-- its threads works.
create table workstream_done_marks (
  workspace_id text not null references workspaces (id),
  workstream_id text not null references workstreams (id),
  done_at text not null,
  done_by text not null check (json_valid(done_by)),
  threads text not null check (json_valid(threads)),
  primary key (workstream_id, done_at)
) strict;
-- Deleted while threads used it: it and its threads are out of every list,
-- page and route, with their rows kept, so restoring it brings them back.
-- A workstream no thread ever used is deleted with its rows instead, so it
-- leaves no row here.
create table deleted_workstreams (
  workspace_id text not null references workspaces (id),
  workstream_id text primary key references workstreams (id),
  deleted_at text not null
) strict;
