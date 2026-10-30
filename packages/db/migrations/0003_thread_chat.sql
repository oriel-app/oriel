-- A thread's chat (decision 0018): what the user said, what the agent did,
-- and a marker wherever the thread moved to a newer version of its group. A
-- marker records only the two versions; what changed between them is in
-- group_changes and group_members, so nothing is copied. Widening the role
-- check is a rebuild in SQLite.
create table new_messages (
  id text primary key,
  workspace_id text not null references workspaces (id),
  thread_id text not null references threads (id),
  seq integer not null,
  role text not null check (role in ('user', 'agent', 'marker')),
  content text not null check (json_valid(content)),
  at text not null,
  unique (thread_id, seq)
) strict;
insert into new_messages (id, workspace_id, thread_id, seq, role, content, at)
  select id, workspace_id, thread_id, seq, role, content, at from messages;
drop table messages;
alter table new_messages rename to messages;

-- When a change set's last change applied, by apply, an edit that left out
-- the last unapplied one, or a revert that dropped the unsent ones. A
-- thread is done as of this time, not as of its last mutation's.
alter table change_sets add column completed_at text;

-- The inbox lists a workspace's threads, newest first; a group's page and
-- following a group list its threads.
create index threads_by_workspace on threads (workspace_id, created_at);
create index threads_by_group on threads (group_id, created_at);
-- The window lists a workspace's groups, newest first.
create index groups_by_workspace on groups (workspace_id, created_at);
-- A thread's change sets, oldest first, and its derived state.
create index change_sets_by_thread on change_sets (thread_id, created_at);
