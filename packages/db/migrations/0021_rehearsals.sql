-- Release rehearsals (the release-rehearsal spike, draft decision). A
-- rehearsal thread is an ordinary thread on its workstream, made by
-- Rehearse the release, whose module can record a rehearsal. Each record
-- is the agent's situations as Oriel checked them, the workstream version
-- its turn read, and each member's update time then, so the page can say
-- what changed since without a model.
create table rehearsal_threads (
  thread_id text primary key references threads (id),
  workspace_id text not null references workspaces (id),
  workstream_id text not null references workstreams (id),
  started_at text not null
) strict;

create table rehearsals (
  id text primary key,
  workspace_id text not null references workspaces (id),
  thread_id text not null references rehearsal_threads (thread_id),
  region_version integer not null,
  situations text not null check (json_valid(situations)),
  seen text not null check (json_valid(seen)),
  at text not null
) strict;

create index rehearsal_threads_by_workstream on rehearsal_threads (workstream_id, started_at);
create index rehearsals_by_thread on rehearsals (thread_id, at);
