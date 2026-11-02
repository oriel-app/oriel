-- References (decision 0027): the items an item's text names, never the
-- text. A resolved one names its item by stable ID; one the index doesn't
-- have yet, by source and handle, until a sync brings that item in, and is
-- dropped 90 days after the last sync that found it. A sync that hands an
-- item's text again replaces its references.
create table item_references (
  workspace_id text not null references workspaces (id),
  source text not null,
  stable_id text not null,
  to_source text not null,
  to_stable_id text,
  to_handle text,
  at text not null,
  check ((to_stable_id is null) != (to_handle is null))
) strict;
create index item_references_from on item_references (workspace_id, source, stable_id);
create index item_references_waiting on item_references (workspace_id, to_source, to_handle)
  where to_handle is not null;
