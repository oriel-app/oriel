-- The outside tools a person connected to Oriel's MCP door (OA-72): a name
-- the person gave, read only or read and act, and how it signs in. Its
-- tokens are kept only as their SHA-256, so nothing here opens the door:
-- a pasted token, which never expires, or an OAuth access token and the
-- refresh token that renews it. Revoking a tool keeps its row, as the
-- record of who acted, and deletes its tokens.
create table outside_tools (
  id text primary key,
  workspace_id text not null references workspaces (id),
  name text not null check (length(name) between 1 and 60),
  mode text not null check (mode in ('read', 'act')),
  -- What the tool said it is when it signed in, never trusted.
  says text,
  -- The OAuth client it signed in as, and where its sign-in may return.
  client text check (client is null or json_valid(client)),
  connected_at text not null,
  used_at text,
  revoked_at text
) strict;
create table outside_tool_tokens (
  hash text primary key,
  workspace_id text not null references workspaces (id),
  tool_id text not null references outside_tools (id) on delete cascade,
  kind text not null check (kind in ('pasted', 'access', 'refresh')),
  expires_at text
) strict;
create index outside_tool_tokens_by_tool on outside_tool_tokens (tool_id);
