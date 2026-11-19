-- =====================================================================
-- Cyrix KPI  ·  0300  ·  Ops audit fixes (Adrian, 19 Nov 2026)
--
-- From the 19 Nov audit of the Ops page:
--
-- 1. Workplace and Projects may report errors and AI use. Both report
--    functions accepted only the eight older app names, so anything those
--    two apps sent was dropped silently. Bodies are 0236/0230's, with the
--    two names added and nothing else changed.
--
-- 2. ops_cron(): every pg_cron job in this database, with its last run,
--    runs and failures in the last 24 hours, average time, and the last
--    failure's message. For the new Scheduled jobs panel. Ops admins only.
--    Until now a failing job (mail, bell, KPI settle, Travel and Workplace
--    housekeeping) failed where nobody looked.
--
-- 3. ops_latest(): the newest stored check per target. /api/ops used to
--    re-check every app live on every page refresh (13 fetches a minute
--    per open tab); it now reads what the 5-minute round already stored.
--
-- 4. The Cyra database joins the 5-minute round, so the page no longer
--    has to ping it live. Its auth health endpoint answers 401 without a
--    key, so anything below 500 counts as up: it answered.
--
-- 5. Fewer database cycles and rows:
--      ops-pw-scan     every 15 min -> hourly. Same batch, so every
--                      account is still rechecked about every 10 hours.
--                      Was 96 bcrypt runs a day (~9 s each).
--      ops-check-prune new, nightly: uptime checks older than 90 days.
--                      ops_check grew ~3,100 rows a day and was never cut.
-- =====================================================================

create or replace function public.ops_report_error(p_app text, p_message text, p_stack text default null, p_route text default null,
                                                   p_release text default null, p_user_agent text default null)
returns void
language plpgsql security definer
set search_path = public
as $function$
declare
  me   uuid := current_employee_id();
  msg  text;
  fp   text;
  d    date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null then return; end if;
  if p_app is null or p_app not in ('portal', 'kpi', 'spare', 'bemmp', 'revive', 'travel', 'tasks', 'pulse', 'workplace', 'projects') then return; end if;
  msg := left(btrim(regexp_replace(coalesce(p_message, ''), '\s+', ' ', 'g')), 300);
  if msg = '' then return; end if;
  -- Ids and numbers vary from one occurrence to the next; the message they sit in is the same error.
  fp := md5(p_app || '|' || regexp_replace(msg, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+', '#', 'gi'));

  if not exists (select 1 from ops_error where app = p_app and day = d and fingerprint = fp)
     and (select count(*) from ops_error where app = p_app and day = d) >= 300 then
    return;
  end if;

  insert into ops_error (app, day, fingerprint, message, stack, route, release, user_agent, employees)
  values (p_app, d, fp, msg, left(p_stack, 2000), left(split_part(coalesce(p_route, ''), '?', 1), 200),
          left(p_release, 40), left(p_user_agent, 200), case when me is null then '{}' else array[me] end)
  on conflict (app, day, fingerprint) do update
    set count      = ops_error.count + 1,
        last_at    = now(),
        stack      = coalesce(excluded.stack, ops_error.stack),
        route      = coalesce(nullif(excluded.route, ''), ops_error.route),
        release    = coalesce(excluded.release, ops_error.release),
        user_agent = coalesce(excluded.user_agent, ops_error.user_agent),
        employees  = case when me is null or me = any (ops_error.employees) or cardinality(ops_error.employees) >= 20
                          then ops_error.employees else ops_error.employees || me end;
exception when others then
  return;
end $function$;

create or replace function public.ops_report_ai(p_app text, p_feature text, p_model text, p_input integer default 0,
                                                p_cached integer default 0, p_output integer default 0)
returns void
language plpgsql security definer
set search_path = public
as $function$
declare
  me uuid := current_employee_id();
  d  date := (now() at time zone 'Asia/Kolkata')::date;
  m  text := left(lower(btrim(coalesce(p_model, ''))), 60);
  f  text := left(lower(btrim(coalesce(p_feature, ''))), 40);
begin
  if auth.uid() is null then return; end if;
  if p_app is null or p_app not in ('pulse', 'bemmp', 'portal', 'kpi', 'spare', 'revive', 'travel', 'tasks', 'workplace', 'projects') then return; end if;
  if m = '' then return; end if;
  insert into ops_ai_usage as u (app, day, model, feature, calls, input_tokens, cached_tokens, output_tokens, employees)
  values (p_app, d, m, coalesce(nullif(f, ''), 'other'), 1,
          least(greatest(coalesce(p_input, 0), 0), 2000000),
          least(greatest(coalesce(p_cached, 0), 0), 2000000),
          least(greatest(coalesce(p_output, 0), 0), 200000),
          case when me is null then '{}' else array[me] end)
  on conflict (app, day, model, feature) do update
    set calls         = u.calls + 1,
        input_tokens  = u.input_tokens + excluded.input_tokens,
        cached_tokens = u.cached_tokens + excluded.cached_tokens,
        output_tokens = u.output_tokens + excluded.output_tokens,
        employees     = case when me is null or me = any (u.employees) or cardinality(u.employees) >= 50
                             then u.employees else u.employees || me end;
exception when others then
  return;
end $function$;

create or replace function public.ops_cron()
returns jsonb
language plpgsql security definer stable
set search_path = public, cron
as $$
begin
  if not is_ops_admin() then
    raise exception 'Ops admins only.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.failed_24h desc, x.name)
    from (
      select j.jobname as name, j.schedule, j.active,
             r.last_at, r.last_status, coalesce(r.runs_24h, 0) runs_24h, coalesce(r.failed_24h, 0) failed_24h, r.avg_s,
             f.message as last_error, f.at as last_error_at
      from cron.job j
      left join lateral (
        select max(d.start_time) last_at,
               (array_agg(d.status order by d.start_time desc))[1] last_status,
               count(*) filter (where d.start_time > now() - interval '24 hours') runs_24h,
               count(*) filter (where d.start_time > now() - interval '24 hours' and d.status <> 'succeeded') failed_24h,
               round(avg(extract(epoch from d.end_time - d.start_time))
                     filter (where d.start_time > now() - interval '24 hours')::numeric, 2) avg_s
        from cron.job_run_details d
        where d.jobid = j.jobid and d.start_time > now() - interval '7 days'
      ) r on true
      left join lateral (
        select left(d.return_message, 200) message, d.start_time at
        from cron.job_run_details d
        where d.jobid = j.jobid and d.status <> 'succeeded' and d.start_time > now() - interval '7 days'
        order by d.start_time desc limit 1
      ) f on true
    ) x), '[]'::jsonb);
end $$;

create or replace function public.ops_latest()
returns jsonb
language plpgsql security definer stable
set search_path = public
as $$
begin
  if not is_ops_admin() then
    raise exception 'Ops admins only.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'group', t.grp, 'ok', c.ok, 'status', c.status,
                                        'ms', c.ms, 'problem', c.problem, 'at', c.at) order by t.sort_order)
    from ops_target t
    left join lateral (select * from ops_check k where k.target_id = t.id order by k.at desc limit 1) c on true
    where t.active), '[]'::jsonb);
end $$;

revoke all on function public.ops_cron() from public, anon;
revoke all on function public.ops_latest() from public, anon;
grant execute on function public.ops_cron() to authenticated;
grant execute on function public.ops_latest() to authenticated;

insert into ops_target (id, name, grp, url, ok_below, timeout_ms, sort_order) values
  ('db-cyra', 'Cyra database', 'Supabase', 'https://hpsbecwbegwzsqmytqti.supabase.co/auth/v1/health', 500, 10000, 95)
on conflict (id) do update set url = excluded.url, name = excluded.name, ok_below = excluded.ok_below, active = true;

select cron.unschedule('ops-pw-scan');
select cron.schedule('ops-pw-scan', '7 * * * *', 'select public.ops_pw_scan(120)');
select cron.schedule('ops-check-prune', '29 3 * * *', 'delete from public.ops_check where at < now() - interval ''90 days''');

do $$
begin
  if has_function_privilege('anon', 'public.ops_cron()', 'execute') or has_function_privilege('anon', 'public.ops_latest()', 'execute') then
    raise exception '0300: anon can call ops_cron or ops_latest';
  end if;
  if pg_get_functiondef('public.ops_report_error(text,text,text,text,text,text)'::regprocedure) not like '%''projects''%' then
    raise exception '0300: ops_report_error does not take projects';
  end if;
end $$;
