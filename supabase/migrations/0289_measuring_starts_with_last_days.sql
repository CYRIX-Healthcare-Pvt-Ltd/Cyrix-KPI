-- =====================================================================
-- Cyrix KPI  ·  0289  ·  "Start measuring from" is the same as "Last days apply from"
--
-- The user, 12 Nov: "make start measuring from and last day same".
-- starts_from (first month whose submit/score turnaround is measured) now
-- always follows deadlines_from; KPI timing no longer has its own picker.
-- =====================================================================

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

  perform settle_kpi_deadlines();
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
  perform settle_kpi_deadlines();
  return v;
end $$;
revoke all on function public.set_kpi_last_days_from(date) from public, anon;
grant execute on function public.set_kpi_last_days_from(date) to authenticated;

-- Today: measuring from the same month as the last days.
update app_settings
   set value = value || jsonb_build_object('starts_from', coalesce(value->>'deadlines_from', value->>'deadlines_from_saved', value->>'starts_from')),
       updated_at = now()
 where key = 'tat_policy';

select value from app_settings where key = 'tat_policy';
