-- Account entitlements only. No commercial data, tenant setup or platform roles come from client metadata.
create table ploa_private.platform_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table ploa_private.platform_admin_invitations (
 email text primary key check(email=lower(btrim(email))),
 expires_at timestamptz not null,
 claimed_at timestamptz,
 claimed_user_id uuid references auth.users(id) on delete set null
);
create table ploa_private.account_features (
 user_id uuid not null references auth.users(id) on delete cascade,
 module text not null check(module in ('dashboard','funnel','leads','search','messages','ai','copies','ads')),
 enabled boolean not null,
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now(),
 primary key(user_id,module)
);
create table ploa_private.account_feature_audit (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid references auth.users(id) on delete set null,
 account_id uuid references auth.users(id) on delete set null,
 module text not null,
 old_enabled boolean not null,
 new_enabled boolean not null,
 created_at timestamptz not null default now()
);
create index ploa_feature_audit_account_idx on ploa_private.account_feature_audit(account_id,created_at desc);
create index ploa_feature_audit_actor_idx on ploa_private.account_feature_audit(actor_id);
create index ploa_features_updater_idx on ploa_private.account_features(updated_by);
create index ploa_admin_invitation_claim_idx on ploa_private.platform_admin_invitations(claimed_user_id);
alter table ploa_private.platform_admins enable row level security;
alter table ploa_private.platform_admin_invitations enable row level security;
alter table ploa_private.account_features enable row level security;
alter table ploa_private.account_feature_audit enable row level security;
revoke all on ploa_private.platform_admins,ploa_private.platform_admin_invitations,
 ploa_private.account_features,ploa_private.account_feature_audit from public,anon,authenticated;
grant select,insert on ploa_private.platform_admins to service_role;
grant select,update on ploa_private.platform_admin_invitations to service_role;
grant select,insert,update on ploa_private.account_features to service_role;
grant select,insert on ploa_private.account_feature_audit to service_role;

-- Narrow definer needed only for verified Auth identity and account directory. Never expose auth.users grants.
create function ploa_private.claim_platform_admin(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare account_email text; invitation text;
begin
 select lower(email) into account_email from auth.users where id=p_user
  and email_confirmed_at is not null and coalesce(is_anonymous,false)=false;
 if account_email is null then return; end if;
 update ploa_private.platform_admin_invitations set claimed_at=clock_timestamp(),claimed_user_id=p_user
 where email=account_email and claimed_at is null and expires_at>clock_timestamp()
 returning email into invitation;
 if invitation is not null then
  insert into ploa_private.platform_admins(user_id) values(p_user) on conflict do nothing;
 end if;
end; $$;
revoke all on function ploa_private.claim_platform_admin(uuid) from public,anon,authenticated;
grant execute on function ploa_private.claim_platform_admin(uuid) to service_role;

create function public.ploa_account_access(p_user uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform ploa_private.claim_platform_admin(p_user);
 select jsonb_build_object(
  'administrator',exists(select 1 from ploa_private.platform_admins where user_id=p_user),
  'modules',(select jsonb_object_agg(m,coalesce(f.enabled,true))
   from unnest(array['dashboard','funnel','leads','search','messages','ai','copies','ads']) m
   left join ploa_private.account_features f on f.user_id=p_user and f.module=m)
 ) into result;
 return result;
end; $$;

create function ploa_private.admin_account_directory(p_actor uuid,p_search text,p_page integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from ploa_private.platform_admins where user_id=p_actor) then
  raise exception 'Administrator required' using errcode='42501';
 end if;
 if p_page<0 or p_page>100000 or length(p_search)>150 then raise exception 'Invalid page'; end if;
 select jsonb_build_object('accounts',coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb)) into result from (
  select u.id,u.email,u.email_confirmed_at is not null as confirmed,
   exists(select 1 from ploa_private.platform_admins p where p.user_id=u.id) as administrator,
   coalesce((select jsonb_object_agg(module,enabled) from ploa_private.account_features where user_id=u.id),'{}'::jsonb) as modules
  from auth.users u where coalesce(u.is_anonymous,false)=false and u.email is not null
   and (p_search='' or position(lower(p_search) in lower(u.email))>0)
  order by u.created_at,u.id limit 51 offset p_page*50
 ) a;
 return result;
end; $$;
revoke all on function ploa_private.admin_account_directory(uuid,text,integer) from public,anon,authenticated;
grant execute on function ploa_private.admin_account_directory(uuid,text,integer) to service_role;
create function public.ploa_admin_accounts(p_actor uuid,p_search text default '',p_page integer default 0) returns jsonb
language sql security invoker set search_path='' as $$
 select ploa_private.admin_account_directory(p_actor,p_search,p_page);
$$;

create function public.ploa_admin_set_feature(p_actor uuid,p_user uuid,p_module text,p_enabled boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare previous boolean;
begin
 if not exists(select 1 from ploa_private.platform_admins where user_id=p_actor) then
  raise exception 'Administrator required' using errcode='42501';
 end if;
 if p_enabled is null or p_module not in ('dashboard','funnel','leads','search','messages','ai','copies','ads') then
  raise exception 'Invalid module';
 end if;
 -- Serialize changes for the same account; audit old/new values consistently across instances.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,0));
 select enabled into previous from ploa_private.account_features where user_id=p_user and module=p_module;
 previous:=coalesce(previous,true);
 if previous=p_enabled then return jsonb_build_object('changed',false); end if;
 insert into ploa_private.account_features(user_id,module,enabled,updated_by)
 values(p_user,p_module,p_enabled,p_actor)
 on conflict(user_id,module) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 insert into ploa_private.account_feature_audit(actor_id,account_id,module,old_enabled,new_enabled)
 values(p_actor,p_user,p_module,previous,p_enabled);
 return jsonb_build_object('changed',true);
end; $$;
revoke all on function public.ploa_account_access(uuid),public.ploa_admin_accounts(uuid,text,integer),
 public.ploa_admin_set_feature(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.ploa_account_access(uuid),public.ploa_admin_accounts(uuid,text,integer),
 public.ploa_admin_set_feature(uuid,uuid,text,boolean) to service_role;
