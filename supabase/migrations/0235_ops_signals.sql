/*
  0235 — Ops: a push for the things that need somebody, not only for an app that stops answering
  (the user, 31 Oct: "do 1" — alerts for what Needs attention shows).

  Until now only an outage reached a phone (0229). Cyra Assist ran out of OpenAI credit for two weeks, every
  failure recorded, and nobody was told; a late SAP sync or a missed Pulse backup showed only on the Ops page,
  which nobody opens at 2 AM. Two new sources of alerts, both inside the 5-minute ops_round():

    App signals    An app's health check may now answer with an "alerts" list:
                       {"ok": true, "alerts": [{"key": "sync_late", "title": "...", "detail": "..."}]}
                   ops_round() already fetches every health URL, so it reads the list from the same answer.
                   A key that appears opens an ops_signal and pushes once; it closes, with a second push, after
                   30 minutes without it, so a signal that flickers between rounds is one alert, not twenty.
                   Pulse (1.13.0: late SAP sync, missed backup, low disk, database not answering) and the Cyra
                   engine (out of OpenAI credit) send them. No secret is needed anywhere: the health URLs are
                   public already, and what they add is a title, never data.

    Errors         From ops_error (0230), once per India day each: a message seen 10 times today, and an app
                   whose errors today are 50+ and over three times its own daily average of the last week.

  ops_alert()'s dedupe key makes every alert fire once however many rounds see it.
  Undo: supabase/undo/0235_ops_signals.undo.sql (restores 0229's ops_round()).
*/

create table if not exists ops_signal (
  id         uuid primary key default gen_random_uuid(),
  target_id  text not null references ops_target(id) on delete cascade,
  key        text not null,
  title      text not null,
  detail     text,
  opened_at  timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  closed_at  timestamptz
);
create unique index if not exists ops_signal_one_open on ops_signal(target_id, key) where closed_at is null;
alter table ops_signal enable row level security;

/** One health answer's alerts: open what is new, refresh what is still there, close what has been gone 30 min. */
create or replace function ops_take_signals(p_target text, p_body text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  j     jsonb;
  a     jsonb;
  k     text;
  seen  text[] := '{}';
  sid   uuid;
  s     record;
begin
  begin
    j := p_body::jsonb;
  exception when others then
    return;  -- not JSON (a page, not a health endpoint): nothing to say
  end;
  if jsonb_typeof(j) <> 'object' then return; end if;

  if jsonb_typeof(j->'alerts') = 'array' then
    for a in select value from jsonb_array_elements(j->'alerts') limit 10 loop
      k := left(btrim(coalesce(a->>'key', '')), 60);
      continue when k = '' or k = any (seen);
      seen := seen || k;
      update ops_signal set last_seen = now(), detail = left(a->>'detail', 300)
       where target_id = p_target and key = k and closed_at is null
      returning id into sid;
      if sid is null then
        insert into ops_signal (target_id, key, title, detail)
        values (p_target, k, left(coalesce(nullif(btrim(a->>'title'), ''), k), 120), left(a->>'detail', 300))
        returning id into sid;
        perform ops_alert((select title from ops_signal where id = sid),
                          coalesce((select detail from ops_signal where id = sid), ''), 'ops-sig:' || sid);
      end if;
      sid := null;
    end loop;
  end if;

  for s in
    update ops_signal set closed_at = now()
     where target_id = p_target and closed_at is null and not (key = any (seen)) and last_seen < now() - interval '30 minutes'
    returning id, title, opened_at
  loop
    perform ops_alert('Cleared: ' || s.title,
                      'After ' || greatest(1, round(extract(epoch from now() - s.opened_at) / 60))::int || ' min.',
                      'ops-sig-end:' || s.id);
  end loop;
exception when others then
  return;  -- one app's odd answer never stops the round
end $$;

revoke all on function ops_take_signals(text, text) from public, anon, authenticated;

/** Errors worth a push: a message seen 10 times today, or an app far above its own normal. Once per day each. */
create or replace function ops_watch_errors()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  e     record;
  names jsonb := '{"portal":"Portal","kpi":"KPI","spare":"Spare Mapping","bemmp":"BEMMP","revive":"Revive Lab",
                   "travel":"Travel Expense","tasks":"My Task","pulse":"Pulse"}';
begin
  for e in
    select app, fingerprint, message, count, cardinality(employees) people
    from ops_error where day = today and count >= 10
  loop
    perform ops_alert(coalesce(names->>e.app, e.app) || ': an error seen ' || e.count || ' times today',
                      left(e.message, 200) || case when e.people > 1 then ' · ' || e.people || ' people' else '' end,
                      'ops-err:' || e.app || ':' || today || ':' || e.fingerprint);
  end loop;

  for e in
    select t.app, t.n, coalesce(w.avg, 0) avg
    from (select app, sum(count) n from ops_error where day = today group by app) t
    left join (select app, sum(count)::numeric / 7 avg from ops_error
                where day between today - 7 and today - 1 group by app) w on w.app = t.app
    where t.n >= 50 and t.n > 3 * coalesce(w.avg, 0)
  loop
    perform ops_alert(coalesce(names->>e.app, e.app) || ': ' || e.n || ' errors today',
                      case when e.avg < 1 then 'Usually almost none.' else 'About ' || round(e.avg) || ' on a normal day.' end
                        || ' Open Ops to see which.',
                      'ops-spike:' || e.app || ':' || today);
  end loop;
exception when others then
  return;
end $$;

revoke all on function ops_watch_errors() from public, anon, authenticated;

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

  -- 1a. What the apps say about themselves (0235): an answered health check may carry an "alerts" list.
  for t in
    select p.target_id, r.content
    from ops_pending p join net._http_response r on r.id = p.request_id
    where r.status_code between 200 and 299 and r.content is not null
  loop
    perform ops_take_signals(t.target_id, t.content);
  end loop;

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

  -- 2a. Errors people are hitting (0230's ops_error), past a threshold, once per day each.
  perform ops_watch_errors();

  -- 3. The next round.
  insert into ops_pending (request_id, target_id)
  select net.http_get(url := tg.url, timeout_milliseconds := tg.timeout_ms), tg.id
  from ops_target tg where tg.active;

  -- 4. Ninety days is enough to see a pattern.
  delete from ops_check where at < now() - interval '90 days';
end $$;

revoke all on function ops_round() from public, anon, authenticated;

/* ---- self-test ---------------------------------------------------------------------------------------------- */

do $$
declare n int;
begin
  -- A first alert opens one signal; the same alert again does not open a second.
  perform ops_take_signals('pulse', '{"ok":true,"alerts":[{"key":"selftest_0235","title":"0235 self-test","detail":"x"}]}');
  perform ops_take_signals('pulse', '{"ok":true,"alerts":[{"key":"selftest_0235","title":"0235 self-test","detail":"y"}]}');
  select count(*) into n from ops_signal where target_id = 'pulse' and key = 'selftest_0235';
  if n <> 1 then raise exception '0235: expected one open signal, found %', n; end if;
  -- Gone, but for less than 30 minutes: still open. Not JSON: ignored.
  perform ops_take_signals('pulse', '{"ok":true}');
  perform ops_take_signals('pulse', '<html>');
  if not exists (select 1 from ops_signal where key = 'selftest_0235' and closed_at is null) then
    raise exception '0235: a signal closed before 30 minutes without it';
  end if;
  -- Leave nothing behind: not the signal, not its alert in anyone's bell.
  delete from push_messages where dedupe_key in (select 'ops-sig:' || id from ops_signal where key = 'selftest_0235');
  delete from ops_signal where key = 'selftest_0235';
  perform ops_watch_errors();
  raise notice '0235: app signals and error alerts ready';
end $$;
