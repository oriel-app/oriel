-- A rejection the person undid (OA-258). The row stays, as every decision
-- does; while the latest decision is undone, the change set is undecided
-- again, and its next decision is a new row.
alter table decisions add column undone_at text;
