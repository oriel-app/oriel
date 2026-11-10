-- When the agent last revised a change set in place (OA-309): a later run's
-- changes replaced its own. Null for one never revised.
alter table change_sets add column revised_at text;
