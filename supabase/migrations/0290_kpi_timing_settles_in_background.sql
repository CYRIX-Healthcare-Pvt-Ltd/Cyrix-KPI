-- =====================================================================
-- Cyrix KPI  ·  0290  ·  Changing the KPI timing no longer times out
--
-- The user, 12 Nov: "canceling statement due to statement timeout" on KPI
-- timing. Moving "Last days apply from" to Apr-26 settles ~1,830 months
-- (1,716 to zero, 115 to the member's own score) and took 30 s; signed-in
-- calls stop at 8 s. Now the change saves at once and a pg_cron job settles
-- the months within a minute (postgres has no 8 s limit; the advisory lock
-- of 0288 keeps the page-load settles out of its way).
-- =====================================================================

-- Asks the job to run: a flag it clears when it has settled.
create or replace function kpi_settle_soon()
returns void
language sql security definer set search_path = public as $$
  insert into app_settings (key, value, description, updated_at)
  values ('kpi_settle_pending', 'true'::jsonb, 'KPI timing changed: the cron job settles the months next minute.', now())
  on conflict (key) do update set value = 'true'::jsonb, updated_at = now();
$$;
revoke all on function kpi_settle_soon() from public, anon, authenticated;

create or replace function kpi_settle_pending_run()
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from app_settings where key = 'kpi_settle_pending' and value = 'true'::jsonb) then return 0; end if;
  update app_settings set value = 'false'::jsonb, updated_at = now() where key = 'kpi_settle_pending';
  n := settle_kpi_deadlines();
  return n;
end $$;
revoke all on function kpi_settle_pending_run() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'kpi-settle-after-timing';
select cron.schedule('kpi-settle-after-timing', '* * * * *', 'select public.kpi_settle_pending_run()');

create or replace function public.set_kpi_last_days(p_on boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev jsonb; v jsonb;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin can change the KPI timing'; end if;
  select value into prev from app_settings where key = 'tat_policy';
  prev := coalesce(prev, '{}'::jsonb);
  if p_on then
    v := prev || jsonb_build_object('deadlines_from',
      coalesce(prev->>'deadlines_from', prev->>'deadlines_from_saved', prev->>'starts_from', '2026-09-01'));
    v := v || jsonb_build_object('starts_from', v->>'deadlines_from');
  else
    v := prev || jsonb_build_object('deadlines_from', null,
      'deadlines_from_saved', coalesce(prev->>'deadlines_from', prev->>'deadlines_from_saved'));
  end if;
  update app_settings set value = v, updated_at = now() where key = 'tat_policy';
  perform log_audit('setting', null, case when p_on then 'kpi_last_days_on' else 'kpi_last_days_off' end, '{}'::jsonb);
  perform kpi_settle_soon();
  return v;
end $$;
revoke all on function public.set_kpi_last_days(boolean) from public, anon;
grant execute on function public.set_kpi_last_days(boolean) to authenticated;

create or replace function set_tat_policy(
  p_tm_grace      int,
  p_manager_grace int,
  p_starts_from   date default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v    jsonb;
  prev jsonb;
begin
  if not (is_sw_admin() or is_hr_admin()) then
    raise exception 'Only SW Admin can change the KPI timing';
  end if;
  if p_tm_grace is null or p_tm_grace < 1 or p_tm_grace > 28
     or p_manager_grace is null or p_manager_grace < 1 or p_manager_grace > 28 then
    raise exception 'A last day must be between the 1st and the 28th';
  end if;
  if p_manager_grace < p_tm_grace then
    raise exception
      'The manager''s last day (%) cannot come before the team member''s (%)',
      p_manager_grace, p_tm_grace;
  end if;

  select value into prev from app_settings where key = 'tat_policy';
  prev := coalesce(prev, '{}'::jsonb);

  -- p_starts_from is ignored: measuring starts with the last days.
  v := prev || jsonb_build_object(
    'tm_grace_days', p_tm_grace,
    'manager_grace_days', p_manager_grace,
    'starts_from', coalesce(prev->>'deadlines_from', prev->>'deadlines_from_saved', prev->>'starts_from')
  );

  insert into app_settings (key, value, description, updated_at)
  values ('tat_policy', v, 'Last day of the following month to submit (tm_grace_days) and to score (manager_grace_days); deadlines and turnaround (starts_from) apply from deadlines_from.', now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform kpi_settle_soon();
  return v;
end $$;
revoke all on function set_tat_policy(int, int, date) from public, anon;
grant execute on function set_tat_policy(int, int, date) to authenticated;

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
  v := prev || jsonb_build_object('deadlines_from', nf::text, 'deadlines_from_saved', nf::text, 'starts_from', nf::text);
  update app_settings set value = v, updated_at = now() where key = 'tat_policy';
  perform log_audit('setting', null, 'kpi_last_days_from', jsonb_build_object('from', prev->>'deadlines_from', 'to', nf::text));
  perform kpi_settle_soon();
  return v;
end $$;
revoke all on function public.set_kpi_last_days_from(date) from public, anon;
grant execute on function public.set_kpi_last_days_from(date) to authenticated;

select jobname, schedule from cron.job where jobname = 'kpi-settle-after-timing';
