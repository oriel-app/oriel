-- Who last marked a thread done (decision 0024): the actor's JSON, such as
-- the user, the agent in a thread or an outside tool. When it was marked
-- stays on the thread. A thread marked done before now has no row; the user
-- marked it.
create table done_marks (
  workspace_id text not null references workspaces (id),
  thread_id text primary key references threads (id),
  marked_by text not null check (json_valid(marked_by))
) strict;
