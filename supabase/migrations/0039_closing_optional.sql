-- =====================================================================
-- Cyrix KPI  ·  0039  ·  A closing date you can switch off
--
-- 0038 made every month close on a date. Correct for a system running
-- normally, and wrong for this one right now: the team is working
-- through months that ended long ago. April closed on 10 May. Score
-- April today and it is past its date the instant it is scored, so it
-- settles to Final immediately and the team member's right to question
-- it is gone before they have seen the number.
--
-- So the closing day becomes optional. Null means no month closes on
-- its own and no query window ever runs out — which is what a backlog
-- needs, and what SW Admin can turn off again once the backlog is gone.
--
-- With nothing closing months, somebody has to, so the manager's
-- Finalise button comes back — but only while the closing date is off.
-- Exactly one thing closes a month at any time: the calendar, or a
-- person. Both at once is how a month ends up final for two different
-- reasons and neither of them explainable.
-- =====================================================================

create or replace function month_close_at(p_period_month date)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    -- No row at all falls back to the 10th; an explicit null is somebody
    -- having chosen "no closing date", which is a different thing and
    -- must not be coalesced away.
    when not exists (select 1 from app_settings where key = 'month_close')
      then (p_period_month + interval '1 month' + interval '10 days')
             at time zone 'Asia/Kolkata'
    when (select value->>'closing_day' from app_settings where key = 'month_close')
         is null
      then null
    else (
      p_period_month + interval '1 month'
      + make_interval(days => greatest(1, least(28,
          (select (value->>'closing_day')::int
           from app_settings where key = 'month_close'))))
    ) at time zone 'Asia/Kolkata'
  end
$$;

comment on function month_close_at(date) is
  'When a KPI month closes, or null when SW Admin has turned closing '
  'off. Day 10 means July closes at the end of 10 August.';


/**
 * Null here means this month has no deadline at all — not "it closed
 * long ago". Every caller has to read it that way round.
 */
create or replace function submission_close_at(p_submission_id uuid)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    when month_close_at(s.period_month) is null then null
    else greatest(
      month_close_at(s.period_month),
      s.manager_scored_at + interval '1 day')
  end
  from kpi_submissions s
  where s.id = p_submission_id
$$;


-- Nothing settles while closing is off.
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
      and month_close_at(s.period_month) is not null
      and now() > greatest(
            month_close_at(s.period_month),
            s.manager_scored_at + interval '1 day')
      and not exists (
        select 1 from kpi_score_queries q
        where q.submission_id = s.id and q.status = 'open')
    returning s.id
  )
  select count(*) into n from due;

  perform set_config('cyrix.system_write', 'off', true);
  return n;
end $$;


-- No deadline means the window never runs out.
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
  if closes is not null and now() > closes then
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
    -- The column is not null, so an open-ended window is recorded as a
    -- date far enough out to mean "not yet". The evidence purge reads
    -- it, and evidence should outlive a query nobody has closed.
    coalesce(closes, now() + interval '10 years'),
    nullif(trim(coalesce(p_note, '')), ''), s.mgr_total_score
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

  if s.status = 'finalized' then
    perform set_config('cyrix.system_write', 'on', true);
    update kpi_submissions
    set status = 'scored', finalized_at = null
    where id = p_submission_id;
    perform set_config('cyrix.system_write', 'off', true);
  end if;

  return q;
end $$;


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

  select (value->>'closing_day')::int into day
  from app_settings where key = 'month_close';

  select * into q from kpi_score_queries where submission_id = p_submission_id;
  closes := submission_close_at(p_submission_id);

  return query select
    case
      when s.employee_id <> me then false
      when q.id is not null then false
      when s.manager_scored_at is null then false
      when closes is not null and now() > closes then false
      else true
    end,
    case
      when s.employee_id <> me then 'Only the person the month belongs to can query it'
      when q.id is not null then 'This month has already been queried'
      when s.manager_scored_at is null then 'Your manager has not reviewed this month yet'
      when closes is not null and now() > closes then 'This month has closed'
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


create or replace function set_month_close(p_closing_day int)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if not (is_sw_admin() or is_hr_admin()) then
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
end $$;

grant execute on function set_month_close(int) to authenticated;


-- ---------------------------------------------------------------------
-- Backlog first.
--
-- Switched off on the way in, because the reason this migration exists
-- is that it is currently on and closing months nobody has finished.
-- SW Admin turns it back on when the old months are done.
-- ---------------------------------------------------------------------
update app_settings
set value = '{"closing_day": null}'::jsonb, updated_at = now()
where key = 'month_close';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare n int;
begin
  if month_close_at('2026-07-01'::date) is not null then
    raise exception 'closing is off, but July still has a closing date';
  end if;

  n := settle_due_submissions();
  if n <> 0 then
    raise exception 'closing is off, but % month(s) settled anyway', n;
  end if;

  -- And it still works when switched back on.
  update app_settings set value = '{"closing_day": 10}'::jsonb
  where key = 'month_close';

  if month_close_at('2026-07-01'::date)
     <> ('2026-08-11 00:00:00'::timestamp at time zone 'Asia/Kolkata') then
    raise exception 'a closing day of 10 did not put July''s close at 10 August';
  end if;

  update app_settings set value = '{"closing_day": null}'::jsonb
  where key = 'month_close';

  raise notice
    '0039 self-test passed — closing is off, nothing settles, and the '
    'date still lands correctly when it is switched back on';
end $$;
