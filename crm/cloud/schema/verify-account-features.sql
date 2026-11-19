-- Isolated identities and entitlement changes exist only inside this rolled-back transaction.
begin;
do $$
declare relation_name text; fn oid;
begin
 foreach relation_name in array array['ploa_private.platform_admins','ploa_private.platform_admin_invitations','ploa_private.account_features','ploa_private.account_feature_audit'] loop
  if not(select relrowsecurity from pg_class where oid=to_regclass(relation_name)) then raise exception 'RLS missing';end if;
  if has_table_privilege('anon',relation_name,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',relation_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Client access detected';end if;
 end loop;
 for fn in select oid from pg_proc where proname in ('ploa_account_access','ploa_admin_accounts','ploa_admin_set_feature','claim_platform_admin','admin_account_directory') loop
  if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE') then raise exception 'Client RPC access detected';end if;
 end loop;
end; $$;
create temporary table account_feature_fixture(actor uuid,member uuid,outsider uuid);
insert into account_feature_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select actor,'ploa-admin-fixture@example.invalid',clock_timestamp(),'{}'::jsonb from account_feature_fixture
union all select member,'ploa-member-fixture@example.invalid',clock_timestamp(),'{"administrator":true}'::jsonb from account_feature_fixture
union all select outsider,'ploa-other-fixture@example.invalid',null,'{}'::jsonb from account_feature_fixture;
insert into ploa_private.platform_admin_invitations(email,expires_at) values('ploa-admin-fixture@example.invalid',clock_timestamp()+interval '1 minute');
grant select on account_feature_fixture to service_role;
set local role service_role;
do $$
declare f record; access jsonb; before_audit integer;
begin
 select * into f from account_feature_fixture;
 access:=public.ploa_account_access(f.member);
 if (access->>'administrator')::boolean or access->'modules'->>'ai'<>'true' then raise exception 'Default or metadata isolation failed';end if;
 access:=public.ploa_account_access(f.actor);
 if access->>'administrator'<>'true' then raise exception 'Verified owner invitation not claimed';end if;
 begin perform public.ploa_admin_accounts(f.member,'',0);raise exception 'Directory accepted nonadmin';exception when insufficient_privilege then null;end;
 begin perform public.ploa_admin_set_feature(f.member,f.member,'ai',true);raise exception 'Self enable accepted';exception when insufficient_privilege then null;end;
 perform public.ploa_admin_set_feature(f.actor,f.member,'ai',false);
 if public.ploa_account_access(f.member)->'modules'->>'ai'<>'false' then raise exception 'Block failed';end if;
 if public.ploa_account_access(f.outsider)->'modules'->>'ai'<>'true' then raise exception 'Cross-account block';end if;
 select count(*) into before_audit from ploa_private.account_feature_audit where actor_id=f.actor;
 perform public.ploa_admin_set_feature(f.actor,f.member,'ai',false);
 if(select count(*) from ploa_private.account_feature_audit where actor_id=f.actor)<>before_audit then raise exception 'Idempotency failed';end if;
 perform public.ploa_admin_set_feature(f.actor,f.member,'ai',true);
 if public.ploa_account_access(f.member)->'modules'->>'ai'<>'true' then raise exception 'Restore failed';end if;
end; $$;
reset role;
do $$
declare f record;
begin
 select * into f from account_feature_fixture;
 -- The one-time invitation cannot be replayed by another verified identity with that former email.
 update auth.users set email='ploa-admin-renamed@example.invalid' where id=f.actor;
 update auth.users set email='ploa-admin-fixture@example.invalid',email_confirmed_at=clock_timestamp() where id=f.outsider;
 perform public.ploa_account_access(f.outsider);
 if exists(select 1 from ploa_private.platform_admins where user_id=f.outsider) then raise exception 'Owner invitation replay accepted';end if;
 if not exists(select 1 from ploa_private.platform_admins where user_id=f.actor) then raise exception 'Admin was bound to email instead of identity';end if;
end; $$;
rollback;
