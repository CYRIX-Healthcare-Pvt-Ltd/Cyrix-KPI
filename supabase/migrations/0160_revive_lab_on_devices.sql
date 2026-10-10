-- =====================================================================
-- Cyrix KPI  ·  0160  ·  Revive Lab on people's phones too
--
-- The user, 10 Oct: "do Revive Lab ... tickets assigned, that ticket
-- transfer things"; and "when a field engineer raises a ticket ... his
-- reporting manager also should get it".
--
-- push_bell_due (0154) gains two kinds, each with the words to say:
--   revive        tickets waiting on this person (rl_0051 revive_waiting_now):
--                 "2 Revive Lab tickets waiting for you", and which, and why
--   revive_team   a ticket raised by somebody reporting to them, in the
--                 last 30 days: "Kevin raised RL-288 · Probe"
-- Sent the way every bell kind is: when it is new, or has grown, or has
-- something newer in it.
--
-- The return type changes (detail is new), so the function is replaced.
-- =====================================================================

drop function if exists push_bell_due();

create function push_bell_due()
returns table (employee_id uuid, kind text, n int, detail text)
language plpgsql volatile security definer set search_path = public as $$
declare
  r  record;
  f  record;
  st push_bell_state%rowtype;
  kinds text[];
begin
  -- Revive Lab, worked out once for everybody.
  drop table if exists _rw;
  create temp table _rw on commit drop as select * from revive_waiting_now();

  for r in
    select distinct e.id, e.auth_user_id
    from push_subscriptions s join employees e on e.id = s.employee_id
    where e.is_active and e.auth_user_id is not null
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
    kinds := '{}';
    for f in
      select x.kind, x.n, x.latest, null::text as detail from my_notifications() x
      union all
      select 'revive', count(distinct w.ticket_id)::int, max(w.at),
             (select string_agg(y.code || ' · ' || y.why, ', ' order by y.at desc)
              from (select * from _rw z where z.employee_id = r.id order by z.at desc limit 3) y)
      from _rw w where w.employee_id = r.id
      having count(*) > 0
      union all
      select 'revive_team', count(*)::int, max(t.created_at),
             (select split_part(m.full_name, ' ', 1) || ' raised ' || tt.code || coalesce(' · ' || nullif(tt.spare_name, ''), '')
              from revive_tickets tt join employees m on m.id = tt.raised_by
              where m.reporting_manager_id = r.id and tt.created_at > now() - interval '30 days'
              order by tt.created_at desc limit 1)
      from revive_tickets t join employees m on m.id = t.raised_by
      where m.reporting_manager_id = r.id and t.created_at > now() - interval '30 days'
      having count(*) > 0
    loop
      kinds := kinds || f.kind;
      select * into st from push_bell_state b where b.employee_id = r.id and b.kind = f.kind;
      if not found
         or f.n > st.n
         or coalesce(f.latest, '-infinity') > coalesce(st.latest, '-infinity') then
        employee_id := r.id; kind := f.kind; n := f.n; detail := f.detail;
        return next;
      end if;
      insert into push_bell_state as b (employee_id, kind, n, latest)
      values (r.id, f.kind, f.n, f.latest)
      on conflict on constraint push_bell_state_pkey do update set n = excluded.n, latest = excluded.latest;
    end loop;
    delete from push_bell_state b where b.employee_id = r.id and not (b.kind = any (kinds));
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;

revoke execute on function push_bell_due() from public, anon, authenticated;
grant execute on function push_bell_due() to service_role;

-- A device's first registration: what is already waiting in Revive Lab is
-- not news to it either (as save_push_subscription does for the KPI bell).
create or replace function push_seed_revive(p_employee uuid)
returns void
language sql security definer set search_path = public as $$
  insert into push_bell_state (employee_id, kind, n, latest)
  select p_employee, 'revive', count(distinct ticket_id)::int, max(at)
  from revive_waiting_now() where employee_id = p_employee
  having count(*) > 0
  on conflict (employee_id, kind) do nothing;
  insert into push_bell_state (employee_id, kind, n, latest)
  select p_employee, 'revive_team', count(*)::int, max(t.created_at)
  from revive_tickets t join employees m on m.id = t.raised_by
  where m.reporting_manager_id = p_employee and t.created_at > now() - interval '30 days'
  having count(*) > 0
  on conflict (employee_id, kind) do nothing;
$$;

create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id();
begin
  if me is null then raise exception 'Sign in first'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'That is not a notification subscription';
  end if;

  insert into push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent)
  values (me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set employee_id = me, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = now(), failures = 0;

  -- What is already in the bell, or waiting in Revive Lab, is not news to this device.
  insert into push_bell_state (employee_id, kind, n, latest)
  select me, f.kind, f.n, f.latest from my_notifications() f
  on conflict (employee_id, kind) do nothing;
  perform push_seed_revive(me);
end $$;
