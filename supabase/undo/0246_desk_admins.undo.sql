-- Undo 0246. Roles it gave people stay in user_roles; remove them first if they should go.
create or replace function digest_can_post()
returns text
language sql stable security definer set search_path = public as $$
  select case when is_hr_admin() then 'hr' when is_it_admin() then 'it' when is_mkt_admin() then 'mkt' end
$$;
drop function if exists desk_admin_list();
drop function if exists desk_admin_set(uuid, text, text[]);
drop function if exists desk_admin_remove(uuid, text);
drop function if exists my_desks();
drop function if exists desk_role(text, text[]);
drop function if exists desk_modules(text);
drop table if exists desk_admins;
