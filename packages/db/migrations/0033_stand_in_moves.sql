-- The change set Oriel offered that moves a stand-in's issues into a kind
-- that turned on (decision 0059): one a stand-in and kind, with its thread
-- and change set, and the stand-in's item each of its creates makes again
-- there, by the create's ref. Once it applied, the stand-in steps aside and
-- workstreams hold the new items; until then, or rejected, both stay.
create table stand_in_moves (
  workspace_id text not null references workspaces (id),
  stand_in text not null,
  into_kind text not null,
  thread_id text not null,
  change_set_id text not null,
  items text not null check (json_valid(items)),
  moved_at text,
  at text not null,
  primary key (workspace_id, stand_in, into_kind)
) strict;
