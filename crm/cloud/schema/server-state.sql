-- Server-only encrypted state. No commercial data or existing account records are imported.
create table ploa_private.server_state (
  kind text not null check (kind in ('session','flow','challenge','confirmation','verification')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  envelope jsonb not null check (jsonb_typeof(envelope) = 'object' and octet_length(envelope::text) <= 32768),
  user_id uuid references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  version bigint not null default 1,
  lease_token uuid,
  lease_until timestamptz,
  primary key (kind, key_hash)
);
create index ploa_server_state_expiry_idx on ploa_private.server_state(expires_at);
create index ploa_server_state_user_idx on ploa_private.server_state(user_id,kind) where user_id is not null;
create table ploa_private.server_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  hits integer not null check(hits > 0),
  expires_at timestamptz not null
);
create index ploa_server_limits_expiry_idx on ploa_private.server_limits(expires_at);
alter table ploa_private.server_state enable row level security;
alter table ploa_private.server_limits enable row level security;
revoke all on ploa_private.server_state, ploa_private.server_limits from public, anon, authenticated;
grant all on ploa_private.server_state, ploa_private.server_limits to service_role;

create function public.ploa_state_read(p_kind text,p_key text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('envelope',envelope,'version',version) from ploa_private.server_state
 where kind=p_kind and key_hash=p_key and expires_at>statement_timestamp();
$$;
create function public.ploa_state_put(p_kind text,p_key text,p_envelope jsonb,p_ttl_ms bigint,p_user uuid default null) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_ttl_ms<1 or p_ttl_ms>2592000000 then raise exception 'Invalid lifetime'; end if;
 insert into ploa_private.server_state(kind,key_hash,envelope,expires_at,user_id)
 values(p_kind,p_key,p_envelope,clock_timestamp()+p_ttl_ms*interval '1 millisecond',p_user)
 on conflict(kind,key_hash) do update set envelope=excluded.envelope,expires_at=excluded.expires_at,
 user_id=excluded.user_id,version=server_state.version+1,lease_token=null,lease_until=null
 where server_state.expires_at<=clock_timestamp();
 return found;
end; $$;
create function public.ploa_state_take(p_kind text,p_key text,p_lease uuid default null) returns jsonb
language sql volatile security invoker set search_path='' as $$
 delete from ploa_private.server_state where kind=p_kind and key_hash=p_key and expires_at>clock_timestamp()
 and (p_lease is null or (lease_token=p_lease and lease_until>clock_timestamp()))
 returning jsonb_build_object('envelope',envelope,'version',version);
$$;
create function public.ploa_state_lease(p_kind text,p_key text,p_lease uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
 update ploa_private.server_state set lease_token=p_lease,lease_until=clock_timestamp()+interval '30 seconds'
 where kind=p_kind and key_hash=p_key and expires_at>clock_timestamp()
 and (lease_until is null or lease_until<=clock_timestamp())
 returning jsonb_build_object('envelope',envelope,'version',version);
$$;
create function public.ploa_state_write(p_kind text,p_key text,p_lease uuid,p_version bigint,p_envelope jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update ploa_private.server_state set envelope=p_envelope,version=version+1,lease_token=null,lease_until=null
 where kind=p_kind and key_hash=p_key and version=p_version and lease_token=p_lease
 and lease_until>clock_timestamp() and expires_at>clock_timestamp();
 return found;
end; $$;
create function public.ploa_state_release(p_kind text,p_key text,p_lease uuid) returns void
language sql volatile security invoker set search_path='' as $$
 update ploa_private.server_state set lease_token=null,lease_until=null
 where kind=p_kind and key_hash=p_key and lease_token=p_lease;
$$;
create function public.ploa_state_remove_user(p_kind text,p_user uuid) returns void
language sql volatile security invoker set search_path='' as $$
 delete from ploa_private.server_state where kind=p_kind and user_id=p_user;
$$;
create function public.ploa_limit_hit(p_key text,p_limit integer,p_window_ms integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if p_limit<1 or p_limit>1000 or p_window_ms<1000 or p_window_ms>3600000 then raise exception 'Invalid limit'; end if;
 insert into ploa_private.server_limits(key_hash,hits,expires_at)
 values(p_key,1,clock_timestamp()+p_window_ms*interval '1 millisecond')
 on conflict(key_hash) do update set
 hits=case when server_limits.expires_at<=clock_timestamp() then 1 else least(server_limits.hits+1,p_limit+1) end,
 expires_at=case when server_limits.expires_at<=clock_timestamp() then excluded.expires_at else server_limits.expires_at end
 returning hits into n;
 return n<=p_limit;
end; $$;
create function public.ploa_state_cleanup() returns void
language sql volatile security invoker set search_path='' as $$
 delete from ploa_private.server_state where (kind,key_hash) in
 (select kind,key_hash from ploa_private.server_state where expires_at<=clock_timestamp() order by expires_at limit 500);
 delete from ploa_private.server_limits where key_hash in
 (select key_hash from ploa_private.server_limits where expires_at<=clock_timestamp() order by expires_at limit 500);
$$;

revoke all on function public.ploa_state_read(text,text),public.ploa_state_put(text,text,jsonb,bigint,uuid),
 public.ploa_state_take(text,text,uuid),public.ploa_state_lease(text,text,uuid),public.ploa_state_write(text,text,uuid,bigint,jsonb),
 public.ploa_state_release(text,text,uuid),public.ploa_state_remove_user(text,uuid),public.ploa_limit_hit(text,integer,integer),
 public.ploa_state_cleanup() from public,anon,authenticated;
grant execute on function public.ploa_state_read(text,text),public.ploa_state_put(text,text,jsonb,bigint,uuid),
 public.ploa_state_take(text,text,uuid),public.ploa_state_lease(text,text,uuid),public.ploa_state_write(text,text,uuid,bigint,jsonb),
 public.ploa_state_release(text,text,uuid),public.ploa_state_remove_user(text,uuid),public.ploa_limit_hit(text,integer,integer),
 public.ploa_state_cleanup() to service_role;
