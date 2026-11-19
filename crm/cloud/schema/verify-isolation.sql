-- Run ONLY in the separate Ploa project after the foundation migration.
-- All fixtures are rolled back; failure must also be followed by ROLLBACK.
begin;
insert into auth.users (id, aud, role, email) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'ploa-isolation-a@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'ploa-isolation-b@example.invalid');
insert into auth.sessions(id,user_id) values
  ('aaaaaaaa-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222');
insert into public.ploa_workspaces (id, owner_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Ploa fixture A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'Ploa fixture B');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-1111-4111-8111-111111111111"}', true);
do $$
declare affected integer;
begin
  if (select count(*) from public.ploa_workspaces where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) <> 1 then
    raise exception 'Account A can read a foreign workspace';
  end if;
  update public.ploa_workspaces set name = 'Forbidden' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Account A renamed workspace B'; end if;
  begin
    insert into public.ploa_workspaces (owner_id, name) values ('22222222-2222-4222-8222-222222222222', 'Forbidden');
    raise exception 'Account A assigned a workspace to B';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.ploa_workspaces set owner_id = '22222222-2222-4222-8222-222222222222' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    raise exception 'Account A changed ownership directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ploa_workspace_members (workspace_id, user_id, role) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'editor');
    raise exception 'Account A granted itself membership in B';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"bbbbbbbb-2222-4222-8222-222222222222"}', true);
do $$
begin
  if exists (select 1 from public.ploa_workspaces where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'Account B can read workspace A';
  end if;
  if not exists (select 1 from public.ploa_workspaces where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception 'Account B cannot read its own workspace';
  end if;
end $$;
reset role;

-- A read-only member can see B but cannot rename it or alter membership.
insert into public.ploa_workspace_members (workspace_id, user_id, role) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'viewer');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-1111-4111-8111-111111111111"}', true);
do $$
declare affected integer;
begin
  if not exists (select 1 from public.ploa_workspaces where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception 'Authorized member cannot read workspace B';
  end if;
  update public.ploa_workspaces set name = 'Forbidden' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Viewer renamed workspace B'; end if;
end $$;
reset role;
select 'Ploa isolation checks completed; fixtures rolled back' as result;
rollback;
