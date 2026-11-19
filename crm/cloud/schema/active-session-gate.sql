-- A remembered browser cookie must not restore a revoked/expired Auth session.
create or replace function ploa_private.email_access() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists(select 1 from auth.sessions s
      where s.user_id=(select auth.uid()) and s.id::text=(select auth.jwt()->>'session_id')
        and (s.not_after is null or s.not_after>now()))
    and (
      not exists(select 1 from public.ploa_account_security s where s.user_id=(select auth.uid()) and s.email_2fa_enabled)
      or exists(select 1 from public.ploa_email_verified_sessions p
        where p.user_id=(select auth.uid()) and p.session_id::text=(select auth.jwt()->>'session_id') and p.verified_until>now())
    );
$$;
revoke all on function ploa_private.email_access() from public, anon;
grant execute on function ploa_private.email_access() to authenticated;
