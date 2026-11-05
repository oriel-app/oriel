-- A second look the person dismissed (OA-257): it no longer shows, and the
-- change set offers Approve and Reject again. Pressing Second look while it
-- is still current shows it again, with no model call, by clearing this.
alter table challenges add column dismissed_at text;
