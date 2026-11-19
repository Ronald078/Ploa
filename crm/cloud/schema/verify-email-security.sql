begin;
insert into auth.users(id,aud,role,email) values
 ('11111111-1111-4111-8111-111111111111','authenticated','authenticated','ploa-security-a@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','authenticated','authenticated','ploa-security-b@example.invalid');
insert into auth.sessions(id,user_id) values
 ('aaaaaaaa-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222');
insert into public.ploa_workspaces(id,owner_id,name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Security A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','Security B');
insert into public.ploa_account_security(user_id,email_2fa_enabled) values('11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-1111-4111-8111-111111111111"}',true);
do $$ begin
  if public.ploa_email_access() then raise exception 'Unverified session was allowed'; end if;
  if exists(select 1 from public.ploa_workspaces where owner_id='11111111-1111-4111-8111-111111111111') then raise exception 'Email gate was bypassed'; end if;
  begin
    insert into public.ploa_workspaces(owner_id,name) values('11111111-1111-4111-8111-111111111111','Forbidden');
    raise exception 'Unverified session created a workspace';
  exception when insufficient_privilege then null; end;
  begin
    update public.ploa_account_security set email_2fa_enabled=false where user_id='11111111-1111-4111-8111-111111111111';
    raise exception 'Client disabled its own second step';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ploa_mark_email_session('11111111-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111',now()+interval '1 hour');
    raise exception 'Client registered its own proof';
  exception when insufficient_privilege then null; end;
  begin
    perform ploa_private.session_matches('11111111-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111');
    raise exception 'Client accessed backend lookup';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
select public.ploa_mark_email_session('11111111-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111',now()+interval '1 hour');
do $$ begin
  begin
    perform public.ploa_mark_email_session('11111111-1111-4111-8111-111111111111','bbbbbbbb-2222-4222-8222-222222222222',now()+interval '1 hour');
    raise exception 'Mismatched session was registered';
  exception when raise_exception then
    if sqlerrm <> 'Invalid authentication session' then raise; end if;
  end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-1111-4111-8111-111111111111"}',true);
do $$ begin
  if not public.ploa_email_access() then raise exception 'Verified session denied'; end if;
  if (select count(*) from public.ploa_workspaces where id in('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) <> 1 then raise exception 'Verified session leaked or lost a workspace'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"bbbbbbbb-2222-4222-8222-222222222222"}',true);
do $$ begin if public.ploa_email_access() then raise exception 'Proof reused by different session'; end if; end $$;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"bbbbbbbb-2222-4222-8222-222222222222"}',true);
do $$ begin
  if not public.ploa_email_access() then raise exception 'User without email requirement was blocked'; end if;
  if exists(select 1 from public.ploa_workspaces where owner_id='11111111-1111-4111-8111-111111111111') then raise exception 'User B read user A'; end if;
end $$;
reset role;
update public.ploa_email_verified_sessions set verified_until=now()-interval '1 minute'
  where session_id='aaaaaaaa-1111-4111-8111-111111111111' and user_id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-1111-4111-8111-111111111111"}',true);
do $$ begin if public.ploa_email_access() then raise exception 'Expired proof allowed'; end if; end $$;
reset role;
update auth.sessions set not_after=now()-interval '1 minute' where id='bbbbbbbb-2222-4222-8222-222222222222' and user_id='22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"bbbbbbbb-2222-4222-8222-222222222222"}',true);
do $$ begin if public.ploa_email_access() then raise exception 'Expired Auth session allowed'; end if; end $$;
reset role;
-- Cleanup uses transaction rollback. Cascading removal is checked structurally,
-- avoiding an extra destructive operation even though fixtures are disposable.
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.ploa_email_verified_sessions'::regclass and confrelid='auth.sessions'::regclass and confdeltype='c') then
    raise exception 'Session proof lacks cascading cleanup';
  end if;
end $$;
select 'Email security and ownership checks passed; all fixtures rolled back' as result;
rollback;
