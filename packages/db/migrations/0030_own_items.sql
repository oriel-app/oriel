-- What Oriel keeps of a stand-in's items (decision 0059) beyond their index
-- rows: the index is their source of truth, as nothing syncs them, so what a
-- live read of one gives that the index lacks, such as an issue's
-- description, is kept here, as JSON its connector reads. It is written in
-- the transaction that writes its index row and change log, and goes when
-- the item does.
create table own_items (
  workspace_id text not null references workspaces (id),
  source text not null,
  stable_id text not null,
  content text not null check (json_valid(content)),
  primary key (workspace_id, source, stable_id)
) strict;
