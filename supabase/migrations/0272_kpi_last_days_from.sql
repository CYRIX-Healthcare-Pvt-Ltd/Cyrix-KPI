-- =====================================================================
-- Cyrix KPI  ·  0272  ·  The month the last days apply from, seen and set
--
-- deadlines_from (0153) was set once, to September 2026, and shown nowhere
-- (the user, 10 Nov: "where is sept 26, shown?"). KPI timing now shows it
-- and SW Admin can move it. Moving it earlier settles the months it takes
-- in — not sent in becomes 0, not scored takes the team member's own
-- score — so the screen first asks what the move would do.
-- =====================================================================

-- What moving the first month to p_from would do, counted and changed nowhere.
create or replace function public.kpi_last_days_effect(p_from date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cur date; nf date := date_trunc('month', p_from)::date;
  tm int; mg int; zero int := 0; unopened int := 0; self int := 0; reopen int := 0;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin can change the KPI timing'; end if;
  select (value->>'deadlines_from')::date, (value->>'tm_grace_days')::int, (value->>'manager_grace_days')::int
    into cur, tm, mg from app_settings where key = 'tat_policy';
  if cur is null then return jsonb_build_object('zero', 0, 'self', 0, 'reopen', 0); end if;

  if nf < cur then
    -- Months newly under the rule: [nf, cur). Their last days as the rule would have them.
    select count(*) into zero from kpi_submissions s
     where s.period_month >= nf and s.period_month < cur and s.status in ('draft', 'returned') and s.deadline_outcome is null
       and now() >= ((date_trunc('month', s.period_month)::date + interval '1 month' + make_interval(days => greatest(1, least(28, tm)))) at time zone 'Asia/Kolkata');
    select count(*) into unopened
      from kpi_assignments a
      join employees e on e.id = a.employee_id and e.is_active
      join financial_years f on f.code = a.financial_year
      cross join lateral generate_series(
        greatest(date_trunc('month', f.starts_on)::date, nf, coalesce(date_trunc('month', a.starts_from)::date, nf)),
        least(date_trunc('month', least(f.ends_on::date, now()::date))::date, (cur - interval '1 month')::date),
        interval '1 month') m
     where a.status = 'active'
       and now() >= ((m::date + interval '1 month' + make_interval(days => greatest(1, least(28, tm)))) at time zone 'Asia/Kolkata')
       and not exists (select 1 from kpi_submissions s where s.employee_id = a.employee_id and s.period_month = m::date);
    select count(*) into self from kpi_submissions s
     where s.period_month >= nf and s.period_month < cur and s.status = 'submitted' and s.deadline_outcome is null
       and now() >= ((date_trunc('month', s.period_month)::date + interval '1 month' + make_interval(days => greatest(1, least(28, mg)))) at time zone 'Asia/Kolkata');
  elsif nf > cur then
    -- Months leaving the rule: [cur, nf). What a last day settled opens again.
    select count(*) into reopen from kpi_submissions s
     where s.period_month >= cur and s.period_month < nf and s.deadline_outcome is not null;
  end if;
  return jsonb_build_object('zero', zero + unopened, 'self', self, 'reopen', reopen);
end $$;
revoke all on function public.kpi_last_days_effect(date) from public, anon;
grant execute on function public.kpi_last_days_effect(date) to authenticated;

create or replace function public.set_kpi_last_days_from(p_from date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev jsonb; v jsonb; nf date := date_trunc('month', p_from)::date;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin can change the KPI timing'; end if;
  select value into prev from app_settings where key = 'tat_policy';
  if prev->>'deadlines_from' is null then raise exception 'Switch the last days on first'; end if;
  if nf > date_trunc('month', now() at time zone 'Asia/Kolkata')::date then raise exception 'Choose this month or an earlier one'; end if;
  if not exists (select 1 from financial_years f where nf between date_trunc('month', f.starts_on)::date and f.ends_on) then
    raise exception 'That month is in no financial year';
  end if;
  v := prev || jsonb_build_object('deadlines_from', nf::text, 'deadlines_from_saved', nf::text);
  update app_settings set value = v, updated_at = now() where key = 'tat_policy';
  perform log_audit('setting', null, 'kpi_last_days_from', jsonb_build_object('from', prev->>'deadlines_from', 'to', nf::text));
  perform settle_kpi_deadlines();
  return v;
end $$;
revoke all on function public.set_kpi_last_days_from(date) from public, anon;
grant execute on function public.set_kpi_last_days_from(date) to authenticated;
