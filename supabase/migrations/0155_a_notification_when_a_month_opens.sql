-- =====================================================================
-- Cyrix KPI  ·  0155  ·  A notification when a month opens
--
-- The user, 10 Oct: on the 1st, "Oct-26 KPI is open". The same 09:30
-- run as the last-day reminders (push_reminders_due), a third side,
-- 'open', for everyone whose KPI covers the month that has just ended.
-- =====================================================================

create or replace function push_reminders_due()
returns table (employee_id uuid, side text, title text, body text, url text)
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  m     date := date_trunc('month', today - interval '1 month')::date;
  tm_day  date := ((kpi_deadline_at(m, 'tm') at time zone 'Asia/Kolkata') - interval '1 day')::date;
  mgr_day date := ((kpi_deadline_at(m, 'manager') at time zone 'Asia/Kolkata') - interval '1 day')::date;
begin
  -- The 1st: last month is open now (the user, 10 Oct: "oct month kpi is open").
  if extract(day from today) = 1 then
    return query
    select a.employee_id, 'open'::text, 'Cyrix KPI'::text,
           case when tm_day is null then format('Your %s KPI is open now.', to_char(m, 'Mon-YY'))
                else format('Your %s KPI is open now. Submit it by %s.', to_char(m, 'Mon-YY'), to_char(tm_day, 'FMDD Mon')) end,
           '/kpi/submission/' || to_char(m, 'YYYY-MM-DD')
    from kpi_assignments a
    join employees e on e.id = a.employee_id and e.is_active
    join financial_years f on f.code = a.financial_year and m between f.starts_on and f.ends_on
    where a.status = 'active'
      and (a.starts_from is null or a.starts_from <= m)
      and exists (select 1 from push_subscriptions p where p.employee_id = a.employee_id);
  end if;

  if tm_day is not null and today between tm_day - 3 and tm_day then
    return query
    select a.employee_id, 'tm'::text, 'Cyrix KPI reminder'::text,
           format('Submit your %s KPI by %s. After that it is scored 0.', to_char(m, 'Mon-YY'), to_char(tm_day, 'FMDD Mon')),
           '/kpi/submission/' || to_char(m, 'YYYY-MM-DD')
    from kpi_assignments a
    join employees e on e.id = a.employee_id and e.is_active
    join financial_years f on f.code = a.financial_year and m between f.starts_on and f.ends_on
    where a.status = 'active'
      and (a.starts_from is null or a.starts_from <= m)
      and not exists (select 1 from kpi_submissions s
                      where s.employee_id = a.employee_id and s.period_month = m
                        and s.status not in ('draft', 'returned'))
      and exists (select 1 from push_subscriptions p where p.employee_id = a.employee_id);
  end if;

  if mgr_day is not null and today between mgr_day - 3 and mgr_day then
    return query
    select distinct s.manager_id, 'manager'::text, 'Cyrix KPI reminder'::text,
           format('Score your team''s %s KPI by %s. After that their own score counts.', to_char(m, 'Mon-YY'), to_char(mgr_day, 'FMDD Mon')),
           '/kpi/team'::text
    from kpi_submissions s
    where s.period_month = m and s.status = 'submitted' and s.manager_id is not null
      and exists (select 1 from push_subscriptions p where p.employee_id = s.manager_id);
  end if;
end $$;


revoke execute on function push_reminders_due() from public, anon, authenticated;
grant execute on function push_reminders_due() to service_role;
