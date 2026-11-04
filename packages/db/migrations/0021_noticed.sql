-- Noticed (docs/decisions/draft-noticed.md). A dismissal hides one signal
-- while its fingerprint holds; its kind is kept so dismissals can teach.
create table noticed_dismissals (
  workspace_id text not null references workspaces (id),
  signal text not null,
  fingerprint text not null,
  kind text not null,
  at text not null,
  primary key (workspace_id, signal, fingerprint)
) strict;

-- A pin is a saved read (decision 0030): the block's spec, as JSON, rerun on
-- each look with no model. `signal` is the Noticed card it was pinned from,
-- if any, and `kind` that card's kind, which a dismissal's lesson reads.
create table pins (
  id text primary key,
  workspace_id text not null references workspaces (id),
  spec text not null,
  signal text,
  kind text,
  created_at text not null
) strict;
