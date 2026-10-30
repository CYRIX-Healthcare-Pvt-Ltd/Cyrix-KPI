/*
  0230 — Ops: every app's browser errors in one place (the user, 30 Oct: "go", step 3 of the Ops plan).

  Until now only Cyra Assist recorded its errors (cyra_v2.app_error, in its own database). KPI, Spare, BEMMP,
  Revive, Travel, My Task and the portal showed a person a broken page and told nobody. Each app now carries
  the same small reporter (src/lib/reportErrors, one copy per app like idleSignOut) that hands an uncaught
  error, an unhandled rejection or a crash caught by the error boundary to ops_report_error().

    ops_error              one row per app, per India day, per distinct message: a count, when it was first
                           and last seen, the route and release it was last seen on, and up to 20 of the
                           people it happened to. Grouped as it arrives, so a loop that throws a thousand
                           times a minute is one row with a big number, not a thousand rows.
    ops_report_error(...)  signed-in callers only. Validates and trims everything, groups, caps each app at
                           300 distinct messages a day. Never raises: a reporter that throws would report
                           itself.
    ops_errors(p_days)     for the page: totals per day per app, and the top messages. Ops admins only.

  What is stored: the error's message and the top of its stack (code locations, not data), the route without
  its query string, the app's build, the browser. Never form contents, scores or tokens.

  Kept 90 days, like ops_check (0229), pruned daily by pg_cron.
  Undo: supabase/undo/0230_ops_errors.undo.sql.
*/

create table if not exists ops_error (
  app          text not null,
  day          date not null,
  fingerprint  text not null,
  message      text not null,
  stack        text,
  route        text,
  release      text,
  user_agent   text,
  count        int  not null default 1,
  employees    uuid[] not null default '{}',
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  primary key (app, day, fingerprint)
);
create index if not exists ops_error_last on ops_error (last_at desc);

-- RLS on and no policy at all: written through ops_report_error(), read through ops_errors().
alter table ops_error enable row level security;

create or replace function ops_report_error(p_app text, p_message text, p_stack text default null,
                                            p_route text default null, p_release text default null,
                                            p_user_agent text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me   uuid := current_employee_id();
  msg  text;
  fp   text;
  d    date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null then return; end if;
  if p_app is null or p_app not in ('portal', 'kpi', 'spare', 'bemmp', 'revive', 'travel', 'tasks', 'pulse') then return; end if;
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
end $$;

revoke all on function ops_report_error(text, text, text, text, text, text) from public, anon;
grant execute on function ops_report_error(text, text, text, text, text, text) to authenticated;

create or replace function ops_errors(p_days int default 30)
returns jsonb
language plpgsql security definer stable
set search_path = public
as $$
declare since date;
begin
  if not is_ops_admin() then
    raise exception 'Ops admins only.' using errcode = '42501';
  end if;
  since := (now() at time zone 'Asia/Kolkata')::date - greatest(1, least(coalesce(p_days, 30), 90)) + 1;
  return jsonb_build_object(
    'total', coalesce((select sum(count) from ops_error where day >= since), 0),
    'by_app', coalesce((
      select jsonb_agg(jsonb_build_object('app', app, 'errors', n, 'messages', m, 'people', p) order by n desc)
      from (select app, sum(count) n, count(distinct fingerprint) m,
                   (select count(distinct x) from ops_error e2, unnest(e2.employees) x
                     where e2.app = e.app and e2.day >= since) p
            from ops_error e where day >= since group by app) a), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'errors', n) order by day)
      from (select day, sum(count) n from ops_error where day >= since group by day) b), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(g order by (g->>'count')::int desc)
      from (select jsonb_build_object(
                     'app', app, 'message', max(message), 'route', (array_agg(route order by last_at desc))[1],
                     'release', (array_agg(release order by last_at desc))[1],
                     'stack', (array_agg(stack order by last_at desc))[1],
                     'count', sum(count), 'people', (select count(distinct x) from ops_error e2, unnest(e2.employees) x
                                                       where e2.app = e.app and e2.fingerprint = e.fingerprint and e2.day >= since),
                     'first', min(first_at), 'last', max(last_at)) g
            from ops_error e where day >= since
            group by app, fingerprint
            order by sum(count) desc limit 50) t), '[]'::jsonb)
  );
end $$;

revoke all on function ops_errors(int) from public, anon;
grant execute on function ops_errors(int) to authenticated, service_role;

select cron.unschedule('ops-error-prune') where exists (select 1 from cron.job where jobname = 'ops-error-prune');
select cron.schedule('ops-error-prune', '17 3 * * *', $$delete from public.ops_error where day < current_date - 90$$);

/* ---- self-test ---------------------------------------------------------------------------------------------- */

do $$
declare n int;
begin
  -- Nobody signed in: nothing is written.
  perform ops_report_error('kpi', '0230 self-test', null, '/x', 'test', null);
  if exists (select 1 from ops_error where message = '0230 self-test') then
    raise exception '0230: an anonymous caller wrote an error';
  end if;
  begin
    perform ops_errors(7);
    raise exception '0230: ops_errors() answered a caller who is not an Ops admin';
  exception when insufficient_privilege then null;
  end;
  if not exists (select 1 from cron.job where jobname = 'ops-error-prune') then
    raise exception '0230: ops-error-prune not scheduled';
  end if;
  if has_function_privilege('anon', 'ops_report_error(text, text, text, text, text, text)', 'execute') then
    raise exception '0230: anon can call ops_report_error()';
  end if;
  raise notice '0230: ops_error ready';
end $$;
