-- =====================================================================
-- Cyrix KPI  ·  0293  ·  People with no last days
--
-- The user, 13 Nov (HR: the directors, AjithKumar S and Joy K John):
-- "add a field exclude option, so we can type ecode and save" ...
-- "anyone i type the ecode there".
--
-- tat_policy.exempt holds employee ids. For anyone in it:
--   · their own months have no last day to submit and none to score;
--   · months they score as the manager have no last day to score.
-- A month that already closed by a last day that no longer applies opens
-- again (settle_kpi_deadlines step 1, through kpi_sub_deadline being null).
--
-- Every check goes through kpi_sub_deadline(); a 5-argument form takes the
-- month's employee and manager, and every caller is moved to it here.
-- =====================================================================

create or replace function public.kpi_exempt(p_emp uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_emp is not null and coalesce(
    (select value->'exempt' ? p_emp::text from app_settings where key = 'tat_policy'), false)
$$;
revoke all on function public.kpi_exempt(uuid) from public, anon;
grant execute on function public.kpi_exempt(uuid) to authenticated;

create or replace function public.kpi_sub_deadline(p_period_month date, p_side text, p_reopen timestamptz,
                                                   p_employee uuid, p_manager uuid)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    when kpi_exempt(p_employee) then null
    when p_side = 'manager' and kpi_exempt(p_manager) then null
    else kpi_sub_deadline(p_period_month, p_side, p_reopen) end
$$;
revoke all on function public.kpi_sub_deadline(date, text, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.kpi_sub_deadline(date, text, timestamptz, uuid, uuid) to authenticated;

-- Every caller: s.period_month ... → with s.employee_id, s.manager_id; settle's bare columns likewise.
do $$
declare fn record; f text; g text;
begin
  for fn in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname <> 'kpi_sub_deadline'
      and pg_get_functiondef(p.oid) like '%kpi_sub_deadline(%'
  loop
    f := pg_get_functiondef(fn.oid);
    g := regexp_replace(f, 'kpi_sub_deadline\(s\.period_month, (''tm''|''manager''), s\.(reopen_tm_until|reopen_mgr_until)\)',
                        'kpi_sub_deadline(s.period_month, \1, s.\2, s.employee_id, s.manager_id)', 'g');
    g := regexp_replace(g, 'kpi_sub_deadline\(period_month, (''tm''|''manager''), (reopen_tm_until|reopen_mgr_until)\)',
                        'kpi_sub_deadline(period_month, \1, \2, employee_id, manager_id)', 'g');
    if g = f then raise exception '% has a kpi_sub_deadline call this does not cover', fn.proname; end if;
    if g ~ 'kpi_sub_deadline\([^)]*_until\)' then raise exception '% still has a 3-argument call', fn.proname; end if;
    execute g;
  end loop;
end $$;

-- Reminders: nobody in the list is reminded of a last day they do not have.
do $$
declare f text; a text; b text;
begin
  f := pg_get_functiondef('public.push_reminders_due()'::regprocedure);
  a := $q$      and not exists (select 1 from kpi_submissions s
                      where s.employee_id = a.employee_id and s.period_month = m
                        and s.status not in ('draft', 'returned'));$q$;
  b := $q$    where s.period_month = m and s.status = 'submitted' and s.manager_id is not null;$q$;
  if position(a in f) = 0 or position(b in f) = 0 then raise exception 'push_reminders_due changed'; end if;
  f := replace(f, a, rtrim(a, ';') || E'\n      and not kpi_exempt(a.employee_id);  -- 0293');
  f := replace(f, b, replace(b, ';', '') || E'\n      and not kpi_exempt(s.employee_id) and not kpi_exempt(s.manager_id);  -- 0293');
  execute f;
end $$;

-- A month nobody opened is not owed by someone in the list (settle step 2).
do $$
declare f text; a text;
begin
  f := pg_get_functiondef('public.settle_kpi_deadlines()'::regprocedure);
  a := $q$        and now() >= kpi_deadline_at(m::date, 'tm')$q$;
  if position(a in f) = 0 then raise exception 'settle_kpi_deadlines changed'; end if;
  execute replace(f, a, a || E'\n        and not kpi_exempt(a.employee_id)  -- 0293');
end $$;

-- Saving the list: ecodes in, names out; an ecode nobody has is refused by name.
create or replace function public.set_kpi_last_days_exempt(p_ecodes text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids jsonb; bad text;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin can change the KPI timing'; end if;
  select string_agg(c, ', ') into bad
  from unnest(coalesce(p_ecodes, '{}')) c
  where not exists (select 1 from employees e where upper(e.ecode) = upper(btrim(c)));
  if bad is not null then raise exception 'No one with ecode %', bad; end if;
  select coalesce(jsonb_agg(distinct e.id::text), '[]'::jsonb) into ids
  from employees e where upper(e.ecode) in (select upper(btrim(c)) from unnest(coalesce(p_ecodes, '{}')) c);
  update app_settings set value = value || jsonb_build_object('exempt', ids), updated_at = now() where key = 'tat_policy';
  perform kpi_settle_soon();
  perform log_audit('app_settings', null, 'kpi_last_days_exempt', jsonb_build_object('ecodes', p_ecodes));
  return ids;
end $$;
revoke all on function public.set_kpi_last_days_exempt(text[]) from public, anon;
grant execute on function public.set_kpi_last_days_exempt(text[]) to authenticated;

-- The list as names, for the timing page.
create or replace function public.kpi_last_days_exempt_people()
returns table (id uuid, ecode text, full_name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.ecode, e.full_name from employees e
  where kpi_exempt(e.id) and (is_sw_admin() or is_hr_admin())
  order by e.ecode
$$;
revoke all on function public.kpi_last_days_exempt_people() from public, anon;
grant execute on function public.kpi_last_days_exempt_people() to authenticated;
