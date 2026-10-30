-- The folder of markdown files the user connected (decision 0019): one per
-- workspace for now, as the user picks one folder. Its ID is a ULID every
-- item key hashes, so another folder gets other IDs; its path is the real
-- path the pick resolved to, which every walk then requires it still to be.
create table folders (
  id text primary key,
  workspace_id text not null unique references workspaces (id),
  path text not null,
  connected_at text not null
) strict;
