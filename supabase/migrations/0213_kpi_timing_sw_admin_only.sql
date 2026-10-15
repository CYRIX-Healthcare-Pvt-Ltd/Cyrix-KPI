-- KPI timing (last days, the on/off switch, month close) is SW Admin's alone (the user, 15 Oct: "why hr, only sw admin").
CREATE OR REPLACE FUNCTION public.set_kpi_last_days(p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare prev jsonb; v jsonb;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin can change the KPI timing'; end if;
  select value into prev from app_settings where key = 'tat_policy';
  prev := coalesce(prev, '{}'::jsonb);
  if p_on then
    v := prev || jsonb_build_object('deadlines_from',
      coalesce(prev->>'deadlines_from', prev->>'deadlines_from_saved', prev->>'starts_from', '2026-09-01'));
  else
    v := prev || jsonb_build_object('deadlines_from', null,
      'deadlines_from_saved', coalesce(prev->>'deadlines_from', prev->>'deadlines_from_saved'));
  end if;
  update app_settings set value = v, updated_at = now() where key = 'tat_policy';
  perform log_audit('setting', null, case when p_on then 'kpi_last_days_on' else 'kpi_last_days_off' end, '{}'::jsonb);
  perform settle_kpi_deadlines();
  return v;
end $function$;
;

CREATE OR REPLACE FUNCTION public.set_month_close(p_closing_day integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not is_sw_admin() then
    raise exception 'Only SW Admin can change the closing day';
  end if;
  -- Null is the point of this migration: no month closes on its own.
  if p_closing_day is not null and (p_closing_day < 1 or p_closing_day > 28) then
    raise exception 'The closing day must be between 1 and 28, or none at all';
  end if;

  v := jsonb_build_object('closing_day', p_closing_day);
  insert into app_settings (key, value, description, updated_at)
  values ('month_close', v,
          'Day of the following month a KPI month closes. Null = months never close on their own.',
          now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end $function$;
;

CREATE OR REPLACE FUNCTION public.set_tat_policy(p_tm_grace integer, p_manager_grace integer, p_starts_from date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v    jsonb;
  prev jsonb;
begin
  if not is_sw_admin() then
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

  v := coalesce(prev, '{}'::jsonb) || jsonb_build_object(
    'tm_grace_days', p_tm_grace,
    'manager_grace_days', p_manager_grace,
    'starts_from', case when p_starts_from is null then null
                       else to_char(date_trunc('month', p_starts_from), 'YYYY-MM-DD') end
  );

  insert into app_settings (key, value, description, updated_at)
  values ('tat_policy', v, 'Last day of the following month to submit (tm_grace_days) and to score (manager_grace_days); deadlines apply from deadlines_from; starts_from is the first month turnaround is measured.', now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform settle_kpi_deadlines();
  return v;
end $function$;

