-- =====================================================================
-- Cyrix KPI  ·  0175  ·  KPI reminders reach everyone, not only devices
--
-- The user, 12 Oct: on the team members' last day 64 had not submitted
-- and two got the 09:30 reminder, because it went only to people with
-- device notifications on (34 in the company). The reminders on the 1st and
-- in the three days before each last day now list everyone they concern;
-- the push function puts each in their in-app bell and sends it to any
-- devices they have.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.push_reminders_due()
 RETURNS TABLE(employee_id uuid, side text, title text, body text, url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      and (a.starts_from is null or a.starts_from <= m);
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
                        and s.status not in ('draft', 'returned'));
  end if;

  if mgr_day is not null and today between mgr_day - 3 and mgr_day then
    return query
    select distinct s.manager_id, 'manager'::text, 'Cyrix KPI reminder'::text,
           format('Score your team''s %s KPI by %s. After that their own score counts.', to_char(m, 'Mon-YY'), to_char(mgr_day, 'FMDD Mon')),
           '/kpi/team'::text
    from kpi_submissions s
    where s.period_month = m and s.status = 'submitted' and s.manager_id is not null;
  end if;
end $function$;
