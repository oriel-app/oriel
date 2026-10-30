-- Any source, and groups the user curates (decisions 0018 and 0019). Tables
-- whose constraints change are rebuilt the way SQLite requires: create the
-- new table, copy the rows, drop the old one, rename the new one into place.
-- The runner turns foreign keys off while migrating and checks them before
-- commit.

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
