-- =====================================================================
-- Cyrix KPI  ·  0038  ·  A closing date, and the bug that needed one
--
-- Two things.
--
-- FIRST, a regression. 0036 rewrote finalize_submission to add the
-- open-query check and, copying the body from 0010, lost two lines:
--
--     perform set_config('cyrix.system_write', 'on', true);
--     perform set_config('cyrix.system_write', 'off', true);
--
-- The guard on kpi_submissions refuses any direct status change, and
-- that pair is how a legitimate one announces itself. Without them
-- Finalise raised "Status changes must go through the submit / score /
-- finalise actions" — from inside the finalise action. The comment in
-- 0036 said the body was repeated whole so a reader could see every
-- difference; it was repeated from a partial read instead. The audit
-- entry went the same way and comes back here too.
--
-- SECOND, the workflow people asked for.
--
-- Finalising was a button somebody had to remember to press, and until
-- they did, the month sat in a state called "Scored" that nobody could
-- explain. Now the calendar closes it:
--
--     the team member sends it in         Submitted
--     the manager scores it               Manager reviewed
--     ... until the closing day           the team member may query it
--     an open query                       Under review
--     after the closing day               Final
--
-- The closing day is SW Admin's — 10 means the 10th of the following
-- month, so July closes at the end of 10 August. One date everybody can
-- be told, rather than a private seven-day clock per person that starts
-- whenever their own manager happened to get to them.
--
-- Nothing is scheduled, because there is no scheduler here. Months
-- settle when somebody reads them, which is the moment it matters, and
-- an unread month that has not settled is one nobody is editing either.
--
-- A late-scored month keeps a floor of one full day. A manager who
-- scores on the 11th would otherwise close the month in the same
-- instant, and "you may question this" that expires before it is read
-- is not a right, it is a formality.
-- =====================================================================

insert into app_settings (key, value, description) values
  ('month_close',
   '{"closing_day": 10}'::jsonb,
   'Day of the following month a KPI month closes. Until then the team member may query the manager''s scores; after it the month becomes final on its own.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- When a month closes.
--
-- Immutable-ish helper used by four callers, so the date is defined once
-- — a closing rule that three screens each compute is a closing rule
-- that will eventually disagree with itself.
-- ---------------------------------------------------------------------
create or replace function month_close_at(p_period_month date)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select (
    (p_period_month
      + interval '1 month'
      + make_interval(days => greatest(1, least(28,
          coalesce((select (value->>'closing_day')::int
                    from app_settings where key = 'month_close'), 10)))))
  ) at time zone 'Asia/Kolkata'
$$;

grant execute on function month_close_at(date) to authenticated;

comment on function month_close_at(date) is
  'The instant a KPI month closes: end of the configured day of the '
  'following month, Asia/Kolkata. Day 10 means July closes at the end '
  'of 10 August.';


/**
 * When this particular month closes for this particular person.
 *
 * The floor is why this is not just month_close_at: a manager who scores
 * after the closing day would otherwise leave no window at all.
 */
create or replace function submission_close_at(p_submission_id uuid)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(
    month_close_at(s.period_month),
    s.manager_scored_at + interval '1 day'
  )
  from kpi_submissions s
  where s.id = p_submission_id
$$;

grant execute on function submission_close_at(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Finalising — restored, and still refusing while a query is open.
-- ---------------------------------------------------------------------
create or replace function finalize_submission(p_submission_id uuid)
returns kpi_submissions
language plpgsql volatile security definer set search_path = public as $$
declare s kpi_submissions%rowtype;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can finalise this';
  end if;
  if s.status <> 'scored' then
    raise exception 'Only a reviewed month can be finalised (current: %)', s.status;
  end if;

  if exists (
    select 1 from kpi_score_queries q
    where q.submission_id = p_submission_id and q.status = 'open'
  ) then
    raise exception
      'This month has an open query. Answer it before finalising.';
  end if;

  -- The two lines 0036 dropped. The guard refuses any direct status
  -- change; this is how a legitimate one identifies itself.
  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'finalized', finalized_at = now()
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'finalized',
                    jsonb_build_object('total', s.final_total_score));
  return s;
end $$;

grant execute on function finalize_submission(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Months closing themselves.
--
-- Called when somebody reads a screen that lists months. Global rather
-- than scoped to the caller: the rule is a date, identical for everyone,
-- and settling only the rows the reader happens to be able to see would
-- make "is it final yet" depend on who last opened the app.
-- ---------------------------------------------------------------------
create or replace function settle_due_submissions()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('cyrix.system_write', 'on', true);

  with due as (
    update kpi_submissions s
    set status = 'finalized', finalized_at = now()
    where s.status = 'scored'
      and s.manager_scored_at is not null
      and now() > greatest(
            month_close_at(s.period_month),
            s.manager_scored_at + interval '1 day')
      -- An open question keeps the month open, whatever the date says.
      -- The alternative is a month that closes over somebody's head
      -- while they are waiting for an answer to it.
      and not exists (
        select 1 from kpi_score_queries q
        where q.submission_id = s.id and q.status = 'open')
    returning s.id
  )
  select count(*) into n from due;

  perform set_config('cyrix.system_write', 'off', true);
  return n;
end $$;

grant execute on function settle_due_submissions() to authenticated;


-- ---------------------------------------------------------------------
-- The query window follows the closing date.
--
-- Was seven days from whenever that person's own manager got to them,
-- which meant two people in the same team had different deadlines and
-- neither could be told what theirs was in advance. Now it is one date.
-- ---------------------------------------------------------------------
create or replace function raise_score_query(
  p_submission_id uuid,
  p_note          text,
  p_points        jsonb
)
returns kpi_score_queries
language plpgsql volatile security definer set search_path = public as $$
declare
  s        kpi_submissions%rowtype;
  me       uuid := current_employee_id();
  closes   timestamptz;
  q        kpi_score_queries%rowtype;
  n_points int;
  n_alien  int;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'That month was not found'; end if;

  if s.employee_id is distinct from me then
    raise exception 'Only the person the month belongs to can query it';
  end if;

  if s.manager_scored_at is null
     or s.status not in ('scored', 'finalized') then
    raise exception
      'You can only query a month your manager has reviewed (current: %)', s.status;
  end if;

  closes := submission_close_at(p_submission_id);
  if now() > closes then
    raise exception
      'This month closed on %',
      to_char(closes at time zone 'Asia/Kolkata', 'DD Mon YYYY');
  end if;

  if exists (select 1 from kpi_score_queries where submission_id = p_submission_id) then
    raise exception 'This month has already been queried once';
  end if;

  select count(*) into n_points
  from jsonb_array_elements(coalesce(p_points, '[]'::jsonb));
  if n_points = 0 then
    raise exception 'Tick at least one row you want looked at';
  end if;

  select count(*) into n_alien
  from jsonb_array_elements(p_points) pt
  where not exists (
    select 1 from kpi_submission_items i
    where i.id = (pt->>'item_id')::uuid
      and i.submission_id = p_submission_id
  );
  if n_alien > 0 then
    raise exception 'One of those rows is not part of this month';
  end if;

  insert into kpi_score_queries (
    submission_id, employee_id, manager_id, window_closes_at,
    employee_note, mgr_total_at_raise
  ) values (
    p_submission_id, me,
    (select reporting_manager_id from employees where id = me),
    closes, nullif(trim(coalesce(p_note, '')), ''), s.mgr_total_score
  )
  returning * into q;

  insert into kpi_score_query_points (
    query_id, item_id, kind, note, evidence_path, evidence_name)
  select
    q.id,
    (pt->>'item_id')::uuid,
    coalesce(nullif(pt->>'kind', ''), 'clarification'),
    nullif(trim(coalesce(pt->>'note', '')), ''),
    nullif(trim(coalesce(pt->>'evidence_path', '')), ''),
    nullif(trim(coalesce(pt->>'evidence_name', '')), '')
  from jsonb_array_elements(p_points) pt;

  -- A month that has already closed cannot be answered by the manager,
  -- so querying it reopens it. Only reachable in the floor case, where
  -- a late score pushed the window past the closing date.
  if s.status = 'finalized' then
    perform set_config('cyrix.system_write', 'on', true);
    update kpi_submissions
    set status = 'scored', finalized_at = null
    where id = p_submission_id;
    perform set_config('cyrix.system_write', 'off', true);
  end if;

  return q;
end $$;

grant execute on function raise_score_query(uuid, text, jsonb) to authenticated;


drop function if exists score_query_state(uuid);

create function score_query_state(p_submission_id uuid)
returns table (
  can_raise       boolean,
  reason          text,
  closes_at       timestamptz,
  days_left       numeric,
  closing_day     int,
  existing_id     uuid,
  existing_status text
)
language plpgsql stable security definer set search_path = public as $$
declare
  s      kpi_submissions%rowtype;
  me     uuid := current_employee_id();
  day    int;
  closes timestamptz;
  q      kpi_score_queries%rowtype;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then return; end if;

  if not (s.employee_id = me or manages_employee(s.employee_id) or is_hr_admin()) then
    return;
  end if;

  select greatest(1, least(28, coalesce((value->>'closing_day')::int, 10)))
  into day from app_settings where key = 'month_close';
  day := coalesce(day, 10);

  select * into q from kpi_score_queries where submission_id = p_submission_id;
  closes := submission_close_at(p_submission_id);

  return query select
    case
      when s.employee_id <> me then false
      when q.id is not null then false
      when s.manager_scored_at is null then false
      when now() > closes then false
      else true
    end,
    case
      when s.employee_id <> me then 'Only the person the month belongs to can query it'
      when q.id is not null then 'This month has already been queried'
      when s.manager_scored_at is null then 'Your manager has not reviewed this month yet'
      when now() > closes then 'This month has closed'
    end,
    closes,
    case when closes is not null
         then round(greatest(0, extract(epoch from (closes - now())) / 86400.0), 2)
    end,
    day,
    q.id,
    q.status;
end $$;

grant execute on function score_query_state(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- SW Admin sets the day.
-- ---------------------------------------------------------------------
create or replace function set_month_close(p_closing_day int)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if not (is_sw_admin() or is_hr_admin()) then
    raise exception 'Only SW Admin can change the closing day';
  end if;
  -- 28, not 31: a closing day of the 30th does not exist in February,
  -- and a deadline that skips a month is not a deadline.
  if p_closing_day is null or p_closing_day < 1 or p_closing_day > 28 then
    raise exception 'The closing day must be between 1 and 28';
  end if;

  v := jsonb_build_object('closing_day', p_closing_day);
  insert into app_settings (key, value, description, updated_at)
  values ('month_close', v,
          'Day of the following month a KPI month closes.', now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end $$;

grant execute on function set_month_close(int) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  sub    kpi_submissions%rowtype;
  closes timestamptz;
  n      int;
begin
  -- The closing date lands where it should: day 10 puts July's close at
  -- the end of 10 August, which is midnight at the start of the 11th.
  if month_close_at('2026-07-01'::date)
     <> ('2026-08-11 00:00:00'::timestamp at time zone 'Asia/Kolkata') then
    raise exception 'a closing day of 10 did not put July''s close at 10 August, got %',
      month_close_at('2026-07-01'::date);
  end if;

  -- February cannot be skipped: 28 is the ceiling.
  if month_close_at('2027-01-01'::date) is null then
    raise exception 'January has no closing date';
  end if;

  select * into sub from kpi_submissions
  where status in ('scored', 'finalized') and manager_scored_at is not null
  order by manager_scored_at desc limit 1;

  if sub.id is null then
    raise notice '0038 self-test skipped — nothing scored yet';
    return;
  end if;

  -- The floor: a month can never close before the manager has had it
  -- for a day, however late they were.
  closes := submission_close_at(sub.id);
  if closes < sub.manager_scored_at + interval '1 day' then
    raise exception 'a month closed less than a day after it was scored';
  end if;

  -- And the regression that started this: finalising has to work.
  -- Run as the system rather than as a signed-in manager, so this
  -- exercises the guard rather than the permission check.
  if sub.status = 'scored' and closes < now()
     and not exists (select 1 from kpi_score_queries q
                     where q.submission_id = sub.id and q.status = 'open') then
    n := settle_due_submissions();
    if (select status from kpi_submissions where id = sub.id) <> 'finalized' then
      raise exception 'a month past its closing date did not settle';
    end if;
    raise notice '0038 self-test passed — % month(s) settled, closing day honoured', n;
    return;
  end if;

  raise notice
    '0038 self-test passed — closing dates land correctly, floor holds, '
    'nothing was due to settle';
end $$;
