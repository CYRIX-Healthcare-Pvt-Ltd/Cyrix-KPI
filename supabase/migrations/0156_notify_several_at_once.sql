-- =====================================================================
-- Cyrix KPI  ·  0156  ·  Several managers, functions or departments at once
--
-- The user, 10 Oct: "manager dropdown with check box so that I can send
-- to multiple managers, same for departments and functions". A target
-- now carries `values` (a list); a single `value` still works.
-- The options list the managers: everyone somebody active reports to.
-- =====================================================================

create or replace function push_audience(p_target jsonb)
returns table (employee_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  k  text := p_target->>'kind';
  vs text[];
begin
  if not (is_hr_admin() or is_sw_admin()) then
    raise exception 'Only HR Admin or SW Admin can send notifications';
  end if;
  if k not in ('all', 'person', 'manager', 'function', 'department') then
    raise exception 'Choose who it goes to';
  end if;

  select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into vs
  from (
    select jsonb_array_elements_text(case when jsonb_typeof(p_target->'values') = 'array' then p_target->'values' else '[]' end) x
    union all
    select p_target->>'value' where coalesce(p_target->>'value', '') <> ''
  ) t;

  if k <> 'all' and cardinality(vs) = 0 then
    raise exception 'Say which one';
  end if;

  return query
  with recursive under(id) as (
    select e.id from employees e where k = 'manager' and upper(e.ecode) = any (select upper(v) from unnest(vs) v)
    union
    select e.id from employees e join under u on e.reporting_manager_id = u.id
  )
  select e.id from employees e
  where e.is_active
    and (k = 'all'
      or (k = 'person' and upper(e.ecode) = any (select upper(v) from unnest(vs) v))
      or (k = 'manager' and e.id in (select id from under))
      or (k = 'function' and e.function_name = any (vs))
      or (k = 'department' and e.department = any (vs)));
end $$;

create or replace function push_audience_preview(p_target jsonb)
returns jsonb
language sql stable security definer set search_path = public as $$
  with a as (select employee_id from push_audience(p_target))
  select jsonb_build_object(
    'people',  (select count(*) from a),
    'devices', (select count(*) from push_subscriptions s join a on a.employee_id = s.employee_id),
    'reachable', (select count(distinct s.employee_id) from push_subscriptions s join a on a.employee_id = s.employee_id),
    'name', case when p_target->>'kind' = 'person'
                 then (select full_name from employees where upper(ecode) = upper(btrim(coalesce(p_target->>'value', p_target->'values'->>0))))
            end
  )
$$;

create or replace function push_audience_options()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_hr_admin() or is_sw_admin()) then
    raise exception 'Only HR Admin or SW Admin can send notifications';
  end if;
  return jsonb_build_object(
    'functions', (select coalesce(jsonb_agg(f order by f), '[]') from (
      select distinct function_name f from employees where is_active and coalesce(btrim(function_name), '') <> '') x),
    'departments', (select coalesce(jsonb_agg(d order by d), '[]') from (
      select distinct department d from employees where is_active and coalesce(btrim(department), '') <> '') y),
    'managers', (select coalesce(jsonb_agg(jsonb_build_object('ecode', m.ecode, 'name', m.full_name, 'n', m.n) order by m.full_name), '[]') from (
      select b.ecode, b.full_name, count(*) n
      from employees r join employees b on b.id = r.reporting_manager_id and b.is_active
      where r.is_active group by b.ecode, b.full_name) m),
    'devices', (select count(*) from push_subscriptions),
    'people', (select count(distinct employee_id) from push_subscriptions)
  );
end $$;
