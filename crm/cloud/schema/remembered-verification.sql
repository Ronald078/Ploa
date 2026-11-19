-- Extend the existing encrypted, server-only state without changing records or grants.
begin;
alter table ploa_private.server_state drop constraint server_state_kind_check;
alter table ploa_private.server_state add constraint server_state_kind_check
 check (kind in ('session','flow','challenge','confirmation','verification'));
commit;
