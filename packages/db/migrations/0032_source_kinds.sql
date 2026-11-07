-- Which kinds are on (decision 0059). A kind is on while a person turned it
-- on and a source server Oriel knows for it is still found, or, until its
-- connector's REST connection goes (OA-280), while it has a connection; a
-- kind a person or the agent turned off stays off until a person turns it
-- on. One row a kind, with the source server it came through, by its name
-- in the person's agent, and who chose.
create table source_kinds (
  workspace_id text not null references workspaces (id),
  kind text not null,
  state text not null check (state in ('on', 'off')),
  server text,
  by text not null check (by in ('person', 'agent')),
  at text not null,
  primary key (workspace_id, kind)
) strict;
-- What the agent picked in Settings last reported that Oriel knows: each
-- server's kind and its name in the agent, never its address or tools. A
-- change since the look before is the overview's card, until the person
-- dismisses it, and the same change never shows it again.
create table source_finds (
  workspace_id text primary key references workspaces (id),
  agent text not null,
  found text not null check (json_valid(found)),
  card text check (card is null or json_valid(card)),
  at text not null
) strict;
