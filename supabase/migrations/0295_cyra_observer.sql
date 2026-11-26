-- =====================================================================
-- Cyrix KPI  ·  0295  ·  Cyra Assist: Observer
--
-- The user, 16 Nov: "we need observer role, ie example afsal is set as
-- observer, so afsal can see summary and download excel of all his
-- downline".
--
-- Admin and Observer are one choice (the user, 16 Nov: "observer and admin
-- in radio button"): ticking Admin clears Observer. Review stays its own box.
-- cyra_observer_team() gives an observer everyone below them in the
-- reporting line (any depth) who holds Cyra Assist. Cyra Assist's engine
-- asks it with the observer's portal session before it reads their
-- team's use of Cyra Assist.
-- =====================================================================

alter table cyra_access add column if not exists observer boolean not null default false;

drop function if exists cyra_access_list();
create function cyra_access_list()
returns table (employee_id uuid, ecode text, full_name text, designation text, function_name text,
               location text, review boolean, admin boolean, observer boolean,
               updated_at timestamptz, updated_by_name text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can see Cyra Assist access'; end if;
  return query
  select e.id, e.ecode, e.full_name, e.designation, e.function_name, e.location,
         coalesce(a.review, false), coalesce(a.admin, false), coalesce(a.observer, false), a.updated_at, u.full_name
  from employees e
  join employee_modules m on m.employee_id = e.id and m.module_code = 'cyra'
  left join cyra_access a on a.employee_id = e.id
  left join employees u on u.id = a.updated_by
  where e.is_active
  order by e.full_name;
end $$;
revoke all on function cyra_access_list() from public, anon;
grant execute on function cyra_access_list() to authenticated;

-- p_observer null keeps what is there (the page live before this asks with two boxes).
drop function if exists set_cyra_access(uuid, boolean, boolean);
create or replace function set_cyra_access(p_employee_id uuid, p_review boolean, p_admin boolean, p_observer boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can change Cyra Assist access'; end if;
  insert into cyra_access (employee_id, review, admin, observer, updated_at, updated_by)
  values (p_employee_id, coalesce(p_review, false), coalesce(p_admin, false),
          coalesce(p_observer, false) and not coalesce(p_admin, false), now(), current_employee_id())
  on conflict (employee_id) do update
  set review = excluded.review, admin = excluded.admin,
      observer = coalesce(p_observer, cyra_access.observer) and not excluded.admin,
      updated_at = now(), updated_by = excluded.updated_by;
end $$;
revoke all on function set_cyra_access(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function set_cyra_access(uuid, boolean, boolean, boolean) to authenticated;

-- Is the caller an observer? (Cyra Assist shows My team only to them.)
create or replace function cyra_is_observer()
returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select a.observer from cyra_access a where a.employee_id = current_employee_id()), false)
$$;
revoke all on function cyra_is_observer() from public, anon;
grant execute on function cyra_is_observer() to authenticated;

-- The observer's whole line below (any depth), holding Cyra Assist. Observers only.
create or replace function cyra_observer_team()
returns table (observer_id uuid, observer_ecode text, employee_id uuid, ecode text, full_name text,
               designation text, function_name text, location text, manager_name text, manager_ecode text)
language plpgsql security definer stable set search_path = public as $$
declare me uuid := current_employee_id();
begin
  if me is null or not coalesce((select a.observer from cyra_access a where a.employee_id = me), false) then
    raise exception 'Only a Cyra Assist observer can see this team';
  end if;
  return query
  with recursive line as (
    select e.id, 1 as depth from employees e where e.reporting_manager_id = me and e.id <> me
    union
    select e.id, l.depth + 1 from employees e join line l on e.reporting_manager_id = l.id
    where l.depth < 20 and e.id <> me
  )
  select me, (select x.ecode from employees x where x.id = me),
         e.id, e.ecode, e.full_name, e.designation, e.function_name, e.location, m.full_name, m.ecode
  from (select distinct id from line) l
  join employees e on e.id = l.id and e.is_active
  join employee_modules h on h.employee_id = e.id and h.module_code = 'cyra'
  left join employees m on m.id = e.reporting_manager_id
  order by e.full_name;
end $$;
revoke all on function cyra_observer_team() from public, anon;
grant execute on function cyra_observer_team() to authenticated;
