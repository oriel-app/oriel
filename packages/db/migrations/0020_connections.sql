-- Connections (decision 0049): one account, site, workspace or folder a
-- person connected through a connector. Its options are kept here, never its
-- secret, which the server keeps under `connection.<id>`. `number` makes its
-- items' prefix: the first of a kind is the bare kind (`jira`), a later one
-- adds its number (`jira.2`), and no number is reused. `identity` is what
-- identifies it in its source, such as Jira's site or the folder's path. A
-- disconnected one is a tombstone, with its options gone, so connecting the
-- same thing again revives it with its ID and number. `name` is the person's
-- own, null for its connector's.
create table connections (
  id text primary key,
  workspace_id text not null references workspaces (id),
  kind text not null,
  number integer not null check (number between 1 and 9999),
  identity text not null,
  name text,
  options text not null check (json_valid(options) and json_type(options) = 'object'),
  connected_at text not null,
  disconnected_at text
) strict;
create unique index connections_by_number on connections (workspace_id, kind, number);
-- One per thing, live or a tombstone: the live one is refused, and the
-- tombstone revived.
create unique index connections_by_identity on connections (workspace_id, kind, identity);

-- The folder's own table moves in, under its ID, which every item key hashes,
-- so its items keep their IDs.
insert into connections (id, workspace_id, kind, number, identity, name, options, connected_at)
  select id, workspace_id, 'folder', 1, path, null, '{}', connected_at from folders;
drop table folders;

-- Each source's sync state is its connection's, by the prefix its items
-- carry, as the index keeps them.
alter table sources rename column kind to source;
