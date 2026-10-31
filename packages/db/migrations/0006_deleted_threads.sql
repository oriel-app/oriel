-- Threads the user deleted after a change set of theirs reached a source.
-- Such a thread keeps its records, so what Oriel wrote stays attributable and
-- each reverse diff stays stored (SPEC §1.2, §7), but no list, page or route
-- shows it. A thread that wrote nothing is deleted with everything in it
-- instead, so it leaves no row here.
create table deleted_threads (
  thread_id text primary key references threads (id),
  workspace_id text not null references workspaces (id),
  deleted_at text not null
) strict;
