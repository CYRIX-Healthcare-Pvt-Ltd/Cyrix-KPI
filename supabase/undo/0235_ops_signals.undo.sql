-- Undo 0235: back to 0229's ops_round(), then drop what 0235 added.
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

drop function if exists ops_watch_errors();
drop function if exists ops_take_signals(text, text);
drop table if exists ops_signal;
