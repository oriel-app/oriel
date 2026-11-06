-- The kind a create writes to, as the namespace that captured it names it:
-- two kinds' catalogues may share an op now, as the stand-in tracker's and
-- Jira's creates do (decision 0059), so the op alone can't say. Null for a
-- mutation with a target, which says it, and for a create captured before,
-- which the one catalogue with its op owns.
alter table mutations add column create_kind text check (create_kind is null or target is null);
