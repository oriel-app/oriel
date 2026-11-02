-- The change log and the last-seen stamp (decision 0027).
-- What each sync changed in an item's facets, before and after, as one JSON
-- object of only the facets that changed (common ones by name, a source's
-- declared ones under "declared"), or that it tombstoned the item (`gone`,
-- with no facets). Facets only, never content, kept 90 days. `seq` orders
-- entries as they committed: each is one past both the last entry kept and
-- the last one seen, so a new entry is always after every last-seen stamp,
-- even once a prune empties the log (a pruned entry's seq may be used
-- again). `at` is when its sync started.
create table change_log (
  seq integer primary key,
  workspace_id text not null references workspaces (id),
  source text not null,
  stable_id text not null,
  version integer not null,
  at text not null,
  facets text not null check (json_valid(facets)),
  gone integer not null check (gone in (0, 1))
) strict;
create index change_log_by_time on change_log (workspace_id, at);

-- When the user last left the overview, and the last change log entry
-- committed then: what committed after it is what they haven't seen.
create table overview_seen (
  workspace_id text primary key references workspaces (id),
  seen_at text not null,
  seen_seq integer not null
) strict;
