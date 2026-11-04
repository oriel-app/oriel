-- Noticed (docs/decisions/draft-noticed.md). A dismissal hides one signal
-- while its fingerprint holds, for 30 days at most. A signal's kind is the
-- start of its ID, `<kind>:<subject>`.
create table noticed_dismissals (
  workspace_id text not null references workspaces (id),
  signal text not null,
  fingerprint text not null,
  at text not null,
  primary key (workspace_id, signal, fingerprint)
) strict;

-- A pin is a saved read (decision 0030): the block's spec, as JSON, rerun on
-- each look with no model. `signal`: the Noticed card it was pinned from.
create table pins (
  id text primary key,
  workspace_id text not null references workspaces (id),
  spec text not null,
  signal text,
  created_at text not null
) strict;

-- The last pass's picks, by the signal set it was offered (`key`), so a
-- restart doesn't pay for the same pass again: each pick's signal ID, its
-- checked line and quote, as JSON.
create table noticed_passes (
  workspace_id text primary key references workspaces (id),
  key text not null,
  at text not null,
  model text not null,
  picks text not null
) strict;
