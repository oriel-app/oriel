-- A second look at a change set (the challenger spike): made once, in a run
-- Oriel starts when the change set is captured, and kept with the hash it
-- read. `findings`, `companions` and `basis` are as core's `Challenge` has
-- them; `coverage` is null until it is ready. A newer row for the same
-- change set replaces an older one in the window, which keeps the latest.
create table challenges (
  id text primary key,
  workspace_id text not null references workspaces (id),
  change_set_id text not null references change_sets (id),
  thread_id text not null references threads (id),
  hash text not null,
  state text not null check (state in ('running', 'ready', 'failed')),
  findings text not null default '[]' check (json_valid(findings)),
  companions text not null default '[]' check (json_valid(companions)),
  added text not null default '[]' check (json_valid(added)),
  coverage text check (coverage is null or json_valid(coverage)),
  basis text not null default '[]' check (json_valid(basis)),
  error text,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  started_at text not null,
  finished_at text
) strict;

create index challenges_by_change_set on challenges (change_set_id, started_at);
