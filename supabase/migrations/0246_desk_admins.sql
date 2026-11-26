-- =====================================================================
-- Cyrix KPI  ·  0246  ·  Admins, set by SW Admin
--
-- The user, 2 Nov: "sw admin will set admins, example HR admin : salman,
-- issac, IT admin : adrain, sreemon", "i need option to set salman both kpi
-- n digest and issac only digest".
--
-- A person is given a desk and the modules they look after for it. The desk
-- role in user_roles follows from the modules, so every rule already written
-- against it keeps working:
--   HR          KPI            → hr_admin (KPI's HR pages)
--               Digest         → posts to Cyrix Digest as HR
--   IT          Logins/Support → it_admin
--               Digest         → posts as IT
--   Marketing   Digest         → posts as Marketing
--   Accounts    Travel Expense → acc_admin
--   Travel Desk Travel Expense → travel_desk
-- The shared desk logins (account type admin) are not listed here and keep
-- everything their role gives them.
-- =====================================================================

create table if not exists desk_admins (
  employee_id uuid not null references employees (id) on delete cascade,
  desk text not null check (desk in ('hr', 'it', 'mkt', 'acc', 'travel')),
  modules text[] not null check (cardinality(modules) > 0),
  set_by uuid references employees (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (employee_id, desk)
);
alter table desk_admins enable row level security;
revoke all on desk_admins from anon, authenticated;

-- The modules of each desk, in the order the screen shows them.
create or replace function desk_modules(p_desk text)
returns text[]
language sql immutable as $$
  select case p_desk
    when 'hr' then array['KPI', 'Digest']
    when 'it' then array['Logins', 'Support', 'Digest']
    when 'mkt' then array['Digest']
    when 'acc' then array['Travel Expense']
    when 'travel' then array['Travel Expense']
  end
$$;

-- What a desk role this person should hold, given their modules for it.
create or replace function desk_role(p_desk text, p_modules text[])
returns text
language sql immutable as $$
  select case
    when p_desk = 'hr' and 'KPI' = any (p_modules) then 'hr_admin'
    when p_desk = 'it' and (p_modules && array['Logins', 'Support']) then 'it_admin'
    when p_desk = 'acc' then 'acc_admin'
    when p_desk = 'travel' then 'travel_desk'
  end
$$;

-- Posting to Cyrix Digest: a shared desk login by its role, as before; a
-- person only with Digest ticked for that desk.
create or replace function digest_can_post()
returns text
language sql stable security definer set search_path = public as $$
  select case
    when (select account_type from employees where id = current_employee_id()) = 'admin'
      then case when is_hr_admin() then 'hr' when is_it_admin() then 'it' when is_mkt_admin() then 'mkt' end
    else (select d.desk from desk_admins d
          where d.employee_id = current_employee_id() and 'Digest' = any (d.modules) and d.desk in ('hr', 'it', 'mkt')
          order by array_position(array['hr', 'it', 'mkt'], d.desk) limit 1)
  end
$$;

-- The signed-in person's desks and modules, for the screens. A shared desk
-- login has every module of its desk.
create or replace function my_desks()
returns table (desk text, modules text[])
language sql stable security definer set search_path = public as $$
  select d.desk, d.modules from desk_admins d where d.employee_id = current_employee_id()
  union all
  select x.desk, desk_modules(x.desk)
  from (values ('hr', 'hr_admin'), ('it', 'it_admin'), ('mkt', 'mkt_admin'), ('acc', 'acc_admin'), ('travel', 'travel_desk')) x (desk, role)
  where (select account_type from employees where id = current_employee_id()) = 'admin'
    and exists (select 1 from user_roles r where r.employee_id = current_employee_id() and r.role = x.role)
$$;
revoke all on function my_desks() from public, anon;
grant execute on function my_desks() to authenticated;

-- ---------------------------------------------------------------------
-- SW Admin's list and its changes.

create or replace function desk_admin_list()
returns table (employee_id uuid, ecode text, full_name text, desk text, modules text[], set_by text, set_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sets admins'; end if;
  return query
  select d.employee_id, e.ecode, e.full_name, d.desk, d.modules,
         case when b.id is null then null else b.full_name || ' (' || b.ecode || ')' end, d.set_at
  from desk_admins d join employees e on e.id = d.employee_id left join employees b on b.id = d.set_by
  order by e.full_name;
end $$;

create or replace function desk_admin_set(p_employee_id uuid, p_desk text, p_modules text[])
returns void
language plpgsql security definer set search_path = public as $$
declare mods text[]; old text[]; old_role text; new_role text;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sets admins'; end if;
  if desk_modules(p_desk) is null then raise exception 'Choose a desk'; end if;
  if not exists (select 1 from employees where id = p_employee_id and is_active and account_type <> 'admin') then
    raise exception 'Choose an active person, not a shared desk login';
  end if;
  select coalesce(array_agg(m order by array_position(desk_modules(p_desk), m)), '{}') into mods
  from (select distinct m from unnest(coalesce(p_modules, '{}')) m where m = any (desk_modules(p_desk))) x;
  if cardinality(mods) = 0 then raise exception 'Tick at least one module'; end if;

  select modules into old from desk_admins where employee_id = p_employee_id and desk = p_desk;
  old_role := case when old is null then null else desk_role(p_desk, old) end;
  new_role := desk_role(p_desk, mods);

  insert into desk_admins (employee_id, desk, modules, set_by, set_at)
  values (p_employee_id, p_desk, mods, current_employee_id(), now())
  on conflict (employee_id, desk) do update set modules = excluded.modules, set_by = excluded.set_by, set_at = now();

  if old_role is not null and old_role is distinct from new_role then
    delete from user_roles where employee_id = p_employee_id and role = old_role;
  end if;
  if new_role is not null then
    insert into user_roles (employee_id, role) values (p_employee_id, new_role) on conflict do nothing;
  end if;
  perform log_audit('desk_admin', p_employee_id, 'set', jsonb_build_object('desk', p_desk, 'modules', mods));
end $$;

create or replace function desk_admin_remove(p_employee_id uuid, p_desk text)
returns void
language plpgsql security definer set search_path = public as $$
declare old text[];
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sets admins'; end if;
  delete from desk_admins where employee_id = p_employee_id and desk = p_desk returning modules into old;
  if old is null then raise exception 'Already removed'; end if;
  if desk_role(p_desk, old) is not null then
    delete from user_roles where employee_id = p_employee_id and role = desk_role(p_desk, old);
  end if;
  perform log_audit('desk_admin', p_employee_id, 'removed', jsonb_build_object('desk', p_desk));
end $$;

revoke all on function desk_admin_list() from public, anon;
revoke all on function desk_admin_set(uuid, text, text[]) from public, anon;
revoke all on function desk_admin_remove(uuid, text) from public, anon;
grant execute on function desk_admin_list() to authenticated;
grant execute on function desk_admin_set(uuid, text, text[]) to authenticated;
grant execute on function desk_admin_remove(uuid, text) to authenticated;
