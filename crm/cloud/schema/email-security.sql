create schema if not exists ploa_private;
revoke all on schema ploa_private from public, anon;
grant usage on schema ploa_private to authenticated, service_role;

create table public.ploa_account_security (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_2fa_enabled boolean not null default false
);
create table public.ploa_email_verified_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  verified_until timestamptz not null
);
create index ploa_email_verified_user_idx on public.ploa_email_verified_sessions (user_id);
alter table public.ploa_account_security enable row level security;
alter table public.ploa_email_verified_sessions enable row level security;
create policy ploa_proofs_backend_only on public.ploa_email_verified_sessions as restrictive for all to anon, authenticated using (false) with check (false);
revoke all on public.ploa_account_security, public.ploa_email_verified_sessions from public, anon, authenticated;
grant select on public.ploa_account_security to authenticated;
grant all on public.ploa_account_security, public.ploa_email_verified_sessions to service_role;
create policy ploa_security_read_self on public.ploa_account_security for select to authenticated
  using (user_id = (select auth.uid()));

-- Private, read-only helper: the caller can learn only whether its own session is verified.
-- Definer is necessary to read the protected proof table, never to grant membership.
create function ploa_private.email_access() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    not exists (select 1 from public.ploa_account_security s where s.user_id = (select auth.uid()) and s.email_2fa_enabled)
    or exists (select 1 from public.ploa_email_verified_sessions p
      where p.user_id = (select auth.uid()) and p.session_id::text = (select auth.jwt()->>'session_id')
        and p.verified_until > now())
  );
$$;
revoke all on function ploa_private.email_access() from public, anon, authenticated;
grant execute on function ploa_private.email_access() to authenticated;
create function public.ploa_email_access() returns boolean
language sql stable security invoker set search_path = '' as $$ select ploa_private.email_access(); $$;
revoke all on function public.ploa_email_access() from public, anon;
grant execute on function public.ploa_email_access() to authenticated;

create policy ploa_workspaces_email_gate on public.ploa_workspaces as restrictive for all to authenticated
  using ((select ploa_private.email_access())) with check ((select ploa_private.email_access()));
create policy ploa_members_email_gate on public.ploa_workspace_members as restrictive for all to authenticated
  using ((select ploa_private.email_access())) with check ((select ploa_private.email_access()));

-- Backend-only narrow lookup. The service role has no SELECT on auth.sessions;
-- keep that restriction and expose only a boolean, not the managed Auth table.
create function ploa_private.session_matches(p_user uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and p_session is not null and exists(
    select 1 from auth.sessions where id = p_session and user_id = p_user and (not_after is null or not_after > now())
  );
$$;
revoke all on function ploa_private.session_matches(uuid, uuid) from public, anon, authenticated;
grant execute on function ploa_private.session_matches(uuid, uuid) to service_role;

-- Only the backend service key may register a code verified by the Ploa mail challenge.
create function public.ploa_mark_email_session(p_user uuid, p_session uuid, p_until timestamptz) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_until <= now() or p_until > now() + interval '31 days' then raise exception 'Invalid verification duration'; end if;
  if not ploa_private.session_matches(p_user, p_session) then raise exception 'Invalid authentication session'; end if;
  insert into public.ploa_email_verified_sessions(session_id, user_id, verified_until) values(p_session, p_user, p_until)
    on conflict (session_id) do update set verified_until = excluded.verified_until where ploa_email_verified_sessions.user_id = excluded.user_id;
end;
$$;
revoke all on function public.ploa_mark_email_session(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ploa_mark_email_session(uuid, uuid, timestamptz) to service_role;

create function public.ploa_set_email_security(p_user uuid, p_session uuid, p_enabled boolean, p_until timestamptz) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.ploa_account_security(user_id, email_2fa_enabled) values(p_user, p_enabled)
    on conflict (user_id) do update set email_2fa_enabled = excluded.email_2fa_enabled;
  if p_enabled then perform public.ploa_mark_email_session(p_user, p_session, p_until);
  else delete from public.ploa_email_verified_sessions where user_id = p_user; end if;
end;
$$;
revoke all on function public.ploa_set_email_security(uuid, uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.ploa_set_email_security(uuid, uuid, boolean, timestamptz) to service_role;
