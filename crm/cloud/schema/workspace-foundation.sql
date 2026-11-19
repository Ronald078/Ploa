-- Foundation only. Apply to the separate Ploa project through apply_migration.
-- No contacts, conversations, API secrets or WhatsApp sessions are imported here.
create table public.ploa_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now()
);
create index ploa_workspaces_owner_idx on public.ploa_workspaces (owner_id);

create table public.ploa_workspace_members (
  workspace_id uuid not null references public.ploa_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index ploa_workspace_members_user_idx on public.ploa_workspace_members (user_id, workspace_id);

alter table public.ploa_workspaces enable row level security;
alter table public.ploa_workspace_members enable row level security;
revoke all on public.ploa_workspaces, public.ploa_workspace_members from anon, authenticated;
grant select, insert on public.ploa_workspaces to authenticated;
grant update (name) on public.ploa_workspaces to authenticated;
grant select on public.ploa_workspace_members to authenticated;

-- Members see only their own membership. No recursive workspace policy is needed.
create policy ploa_members_read_self on public.ploa_workspace_members for select to authenticated
  using (user_id = (select auth.uid()));
create policy ploa_workspaces_read on public.ploa_workspaces for select to authenticated
  using (owner_id = (select auth.uid()) or id in (
    select workspace_id from public.ploa_workspace_members where user_id = (select auth.uid())
  ));
create policy ploa_workspaces_create on public.ploa_workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy ploa_workspaces_rename on public.ploa_workspaces for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

comment on table public.ploa_workspaces is 'Ploa account workspaces. Existing local CRM is not exposed through this schema.';
comment on table public.ploa_workspace_members is 'Membership provisioning is reserved for a future controlled invitation flow; clients cannot grant roles.';
