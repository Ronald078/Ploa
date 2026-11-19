-- Run only after server-state.sql is applied. Fixtures remain inside this rolled-back transaction.
begin;
do $$
declare relation_name text; function_id oid;
begin
 foreach relation_name in array array['ploa_private.server_state','ploa_private.server_limits'] loop
  if to_regclass(relation_name) is null then raise exception 'Apply server-state.sql first'; end if;
  if not (select relrowsecurity from pg_class where oid=to_regclass(relation_name)) then raise exception 'RLS missing'; end if;
  if has_table_privilege('anon',relation_name,'SELECT,INSERT,UPDATE,DELETE') or
     has_table_privilege('authenticated',relation_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Client table access detected'; end if;
 end loop;
 for function_id in select oid from pg_proc where pronamespace='public'::regnamespace
  and proname in ('ploa_state_read','ploa_state_put','ploa_state_take','ploa_state_lease','ploa_state_write',
   'ploa_state_release','ploa_state_remove_user','ploa_limit_hit','ploa_state_cleanup') loop
  if has_function_privilege('anon',function_id,'EXECUTE') or has_function_privilege('authenticated',function_id,'EXECUTE')
   then raise exception 'Client RPC access detected'; end if;
  if not has_function_privilege('service_role',function_id,'EXECUTE') then raise exception 'Server RPC grant missing'; end if;
  if (select prosecdef from pg_proc where oid=function_id) then raise exception 'Unexpected security definer'; end if;
 end loop;
end; $$;
set local role service_role;
do $$
declare h text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 lease_a uuid:=gen_random_uuid(); lease_b uuid:=gen_random_uuid(); row_value jsonb;
begin
 if not public.ploa_state_put('flow',h,'{"v":1,"fixture":true}',60000,null) then raise exception 'Insert failed'; end if;
 if public.ploa_state_put('flow',h,'{}',60000,null) then raise exception 'Live state overwritten'; end if;
 row_value:=public.ploa_state_read('flow',h);
 if row_value->>'version'<>'1' then raise exception 'Read/version failed'; end if;
 if public.ploa_state_lease('flow',h,lease_a) is null then raise exception 'Lease failed'; end if;
 if public.ploa_state_lease('flow',h,lease_b) is not null then raise exception 'Concurrent lease accepted'; end if;
 if public.ploa_state_write('flow',h,lease_b,1,'{}') then raise exception 'Foreign lease accepted'; end if;
 if not public.ploa_state_write('flow',h,lease_a,1,'{"v":1,"fixture":"updated"}') then raise exception 'CAS failed'; end if;
 if public.ploa_state_lease('flow',h,lease_b) is null then raise exception 'Updated lease not released'; end if;
 if public.ploa_state_take('flow',h,null) is null then raise exception 'Take failed'; end if;
 if public.ploa_state_write('flow',h,lease_b,2,'{}') then raise exception 'Removed state resurrected'; end if;
 if public.ploa_state_take('flow',h,null) is not null then raise exception 'Replay accepted'; end if;
 if public.ploa_state_read('flow',h) is not null then raise exception 'Removed state visible'; end if;
 if not public.ploa_limit_hit(h,2,60000) then raise exception 'First rate hit failed'; end if;
 if not public.ploa_limit_hit(h,2,60000) then raise exception 'Second rate hit failed'; end if;
 if public.ploa_limit_hit(h,2,60000) then raise exception 'Rate limit exceeded'; end if;
 update ploa_private.server_limits set expires_at=clock_timestamp()-interval '1 second' where key_hash=h;
 if not public.ploa_limit_hit(h,2,60000) then raise exception 'Rate window did not reset'; end if;
end; $$;
rollback;
