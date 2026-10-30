/*
  0229 — Ops: every app checked every 5 minutes, an outage history, and a push to the Ops admins when one goes down
  (the user, 30 Oct: "start 1" — alerts and uptime history, Phase 2 of the Ops plan).

  The Ops page (0227) only knew whether an app answered at the moment somebody opened it. Nobody opens a dashboard
  at 2 AM, so an outage then was found by whoever tried to use the app next. This keeps watching between visits.

    ops_target           what is checked: one row per app, edited here rather than in code
    ops_check            one row per target per round, kept 90 days
    ops_incident         one row per outage: opened after two failed rounds in a row (about 10 minutes, so one
                         slow answer is not an outage), closed by the first good round after it
    ops_round()          pg_cron, every 5 minutes: collects the answers to the last round's requests, records them,
                         opens and closes incidents, and sends the next round. pg_net is asynchronous, so a round's
                         answers are read by the round after it.
    ops_uptime(p_days)   for the page: uptime per target, and the outages. Ops admins only.

  Alerts go out the way Travel's do (te_0027): a push_messages row of kind 'ops' with a push_inbox row for each Ops
  admin. It lands in their bell at once, and the push function's 5-minute round sends it to their phones and
  computers (supabase/functions/push, which now takes kind 'ops' as well as 'travel').

  The Cyra engine on Render's free plan sleeps after 15 idle minutes. A check every 5 minutes keeps it awake. That
  is 744 hours a month, inside the free 750, and the engineers stop waiting for a cold start.

  Undo: supabase/undo/0229_ops_uptime_and_alerts.undo.sql.
*/

create table if not exists ops_target (
  id          text primary key,
  name        text not null,
  grp         text not null,
  url         text not null,
  -- A page that answers below this is up. 500 for pages (a 404 or a login wall is still a running app).
  ok_below    int  not null default 500,
  timeout_ms  int  not null default 10000,
  active      boolean not null default true,
  sort_order  int  not null default 0
);

insert into ops_target (id, name, grp, url, timeout_ms, sort_order) values
  ('portal',      'Portal',          'Vercel',      'https://app.cyrix.in/',                                   10000, 10),
  ('kpi',         'KPI',             'Vercel',      'https://cyrix-kpi.vercel.app/kpi/',                       10000, 20),
  ('spare',       'Spare Mapping',   'Vercel',      'https://cyrix-spare-mapping.vercel.app/spare/',           10000, 30),
  ('bemmp',       'BEMMP Dashboard', 'Vercel',      'https://cyrix-bemmp-dashboard.vercel.app/bemmp/',         10000, 40),
  ('revive',      'Revive Lab',      'Vercel',      'https://cyrix-revive-lab.vercel.app/revive/',             10000, 50),
  ('travel',      'Travel Expense',  'Vercel',      'https://cyrix-travel.vercel.app/travel/',                 10000, 60),
  ('tasks',       'My Task',         'Vercel',      'https://cyrix-task.vercel.app/tasks/',                    10000, 70),
  ('cyra',        'Cyra Assist',     'Vercel',      'https://cyrix-cyra.vercel.app/cyra/',                     10000, 80),
  ('cyra-engine', 'Cyra engine',     'Render',      'https://cyra-diagnostic-chat-1.onrender.com/api/health',  30000, 90),
  ('pulse',       'Pulse API',       'cyrix-svc01', 'https://pulse.cyrix.in/pulse/api/health',                 10000, 100)
on conflict (id) do nothing;

create table if not exists ops_check (
  target_id  text not null references ops_target(id) on delete cascade,
  at         timestamptz not null,
  ok         boolean not null,
  status     int,
  ms         int,
  problem    text,
  primary key (target_id, at)
);

-- The requests of the round in flight, until the next round reads their answers.
create table if not exists ops_pending (
  request_id bigint primary key,
  target_id  text not null references ops_target(id) on delete cascade,
  sent_at    timestamptz not null default now()
);

create table if not exists ops_incident (
  id         uuid primary key default gen_random_uuid(),
  target_id  text not null references ops_target(id) on delete cascade,
  started_at timestamptz not null,
  ended_at   timestamptz,
  problem    text
);
create unique index if not exists ops_incident_one_open on ops_incident(target_id) where ended_at is null;

-- RLS on and no policy at all: nobody reads these directly. The page goes through ops_uptime().
alter table ops_target   enable row level security;
alter table ops_check    enable row level security;
alter table ops_pending  enable row level security;
alter table ops_incident enable row level security;

alter table push_messages drop constraint if exists push_messages_kind_check;
alter table push_messages add constraint push_messages_kind_check
  check (kind = any (array['manual', 'reminder', 'travel', 'ops']));

/** One alert, into the bell of every Ops admin; the push function's round sends it to their devices. */
create or replace function ops_alert(p_title text, p_body text, p_dedupe text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare mid uuid;
begin
  insert into push_messages (kind, title, body, url, target, dedupe_key)
  values ('ops', p_title, p_body, '/ops', jsonb_build_object('kind', 'ops'), p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into mid;
  if mid is null then return; end if;
  insert into push_inbox (message_id, employee_id)
  select mid, m.employee_id
  from employee_modules m join employees e on e.id = m.employee_id and e.is_active
  where m.module_code = 'ops';
end $$;

revoke all on function ops_alert(text, text, text) from public, anon, authenticated;

create or replace function ops_round()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t   record;
  ist text;
begin
  -- 1. The last round's answers. One that has not come back after its timeout plus a minute is a failure.
  insert into ops_check (target_id, at, ok, status, ms, problem)
  select p.target_id, p.sent_at,
         coalesce(r.status_code < tg.ok_below and not coalesce(r.timed_out, false) and r.error_msg is null, false),
         r.status_code,
         case when r.created is not null then (extract(epoch from r.created - p.sent_at) * 1000)::int end,
         case
           when r.id is null then 'No answer'
           when coalesce(r.timed_out, false) then 'No answer in time'
           when r.error_msg is not null then left(r.error_msg, 200)
           when r.status_code >= tg.ok_below then 'Answered ' || r.status_code
         end
  from ops_pending p
  join ops_target tg on tg.id = p.target_id
  left join net._http_response r on r.id = p.request_id
  where r.id is not null or p.sent_at < now() - make_interval(secs => tg.timeout_ms / 1000 + 60)
  on conflict do nothing;

  delete from ops_pending p
  where exists (select 1 from ops_check c where c.target_id = p.target_id and c.at = p.sent_at);

  -- 2. Outages: open after two bad rounds in a row, close on the first good one.
  for t in
    select tg.id, tg.name,
           (select array_agg(c.ok order by c.at desc) from (select ok, at from ops_check
              where target_id = tg.id order by at desc limit 2) c) as last2,
           (select c.problem from ops_check c where c.target_id = tg.id order by c.at desc limit 1) as problem,
           (select c.at from ops_check c where c.target_id = tg.id and not c.ok order by c.at desc offset 1 limit 1) as first_bad,
           i.id as open_id, i.started_at
    from ops_target tg
    left join ops_incident i on i.target_id = tg.id and i.ended_at is null
    where tg.active
  loop
    if t.open_id is null and t.last2 = array[false, false] then
      insert into ops_incident (target_id, started_at, problem) values (t.id, t.first_bad, t.problem);
      ist := to_char(t.first_bad at time zone 'Asia/Kolkata', 'HH24:MI');
      perform ops_alert(t.name || ' is down',
                        coalesce(t.problem, 'Not answering') || ' since ' || ist || ' IST.',
                        'ops-down:' || t.id || ':' || extract(epoch from t.first_bad)::bigint);
    elsif t.open_id is not null and t.last2[1] then
      update ops_incident set ended_at = now() where id = t.open_id;
      perform ops_alert(t.name || ' is back up',
                        'Down for ' || greatest(1, round(extract(epoch from now() - t.started_at) / 60))::int || ' min.',
                        'ops-up:' || t.open_id);
    end if;
  end loop;

  -- 3. The next round.
  insert into ops_pending (request_id, target_id)
  select net.http_get(url := tg.url, timeout_milliseconds := tg.timeout_ms), tg.id
  from ops_target tg where tg.active;

  -- 4. Ninety days is enough to see a pattern.
  delete from ops_check where at < now() - interval '90 days';
end $$;

revoke all on function ops_round() from public, anon, authenticated;

create or replace function ops_uptime(p_days int default 30)
returns jsonb
language plpgsql security definer stable
set search_path = public
as $$
declare since timestamptz;
begin
  if not is_ops_admin() then
    raise exception 'Ops admins only.' using errcode = '42501';
  end if;
  since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)));
  return jsonb_build_object(
    'since', since,
    'first_check', (select min(at) from ops_check),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tg.id, 'name', tg.name, 'group', tg.grp,
        'checks', s.n, 'up', s.up,
        'uptime', case when s.n > 0 then round(100.0 * s.up / s.n, 2) end,
        'avg_ms', s.avg_ms,
        'down_now', exists (select 1 from ops_incident i where i.target_id = tg.id and i.ended_at is null))
        order by tg.sort_order)
      from ops_target tg
      cross join lateral (
        select count(*) n, count(*) filter (where ok) up, (avg(ms) filter (where ok))::int avg_ms
        from ops_check c where c.target_id = tg.id and c.at >= since) s
      where tg.active), '[]'::jsonb),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'target', tg.name, 'started_at', i.started_at, 'ended_at', i.ended_at, 'problem', i.problem,
        'minutes', round(extract(epoch from coalesce(i.ended_at, now()) - i.started_at) / 60)::int)
        order by i.started_at desc)
      from ops_incident i join ops_target tg on tg.id = i.target_id
      where coalesce(i.ended_at, now()) >= since), '[]'::jsonb)
  );
end $$;

revoke all on function ops_uptime(int) from public, anon;
grant execute on function ops_uptime(int) to authenticated, service_role;

select cron.unschedule('ops-round') where exists (select 1 from cron.job where jobname = 'ops-round');
select cron.schedule('ops-round', '*/5 * * * *', 'select public.ops_round()');

/* ---- self-test ---------------------------------------------------------------------------------------------- */

do $$
begin
  if (select count(*) from ops_target where active) < 10 then raise exception '0229: targets missing'; end if;
  if not exists (select 1 from cron.job where jobname = 'ops-round') then raise exception '0229: ops-round not scheduled'; end if;
  begin
    perform ops_uptime(7);
    raise exception '0229: ops_uptime() answered a caller who is not an Ops admin';
  exception when insufficient_privilege then null;
  end;
  raise notice '0229: % targets checked every 5 minutes; alerts go to % Ops admin(s)',
    (select count(*) from ops_target where active),
    (select count(*) from employee_modules where module_code = 'ops');
end $$;
