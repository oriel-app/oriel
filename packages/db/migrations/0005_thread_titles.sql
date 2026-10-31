-- A thread's title: a few words the model wrote from the first thing the
-- person asked. A thread has no row here until the title arrives, or ever,
-- if it never does; the window then shows that first message, clipped.
create table thread_titles (
  thread_id text primary key references threads (id),
  workspace_id text not null references workspaces (id),
  title text not null,
  titled_at text not null
) strict;
