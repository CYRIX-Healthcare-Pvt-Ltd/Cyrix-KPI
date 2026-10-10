-- =====================================================================
-- Cyrix KPI  ·  0157  ·  People by name or E-code
--
-- The user, 10 Oct: "single person also I can search by name and ecode".
-- The options carry every active person, so the send page picks them
-- from the same searchable checkbox list as managers. Shared system
-- logins (codes with an underscore) are left out.
-- =====================================================================

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
    'everyone', (select coalesce(jsonb_agg(jsonb_build_object('ecode', ecode, 'name', full_name) order by full_name), '[]')
                 from employees where is_active and position('_' in ecode) = 0),
    'devices', (select count(*) from push_subscriptions),
    'people', (select count(distinct employee_id) from push_subscriptions)
  );
end $$;
