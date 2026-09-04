-- =====================================================================
-- Cyrix KPI  ·  0103  ·  Every core value, on every path
--
-- Management: the manager must rate every core value, mandatory.
--
-- 0101 made that true of submitting. This makes it true of the other way
-- in, which submitting does not cover.
--
-- A month that has already been scored is edited by SAVING rather than
-- by submitting -- the manager opens it, changes something, presses Save
-- changes. That path writes straight to core_value_ratings through RLS
-- and passes no function at all, so clearing a rating there was checked
-- by nothing. Core values are 20 of the 100 and only the manager rates
-- them, so blanking all five removes a fifth of somebody's month with
-- nothing on screen, in a function, or in the audit log saying so.
--
-- The guard on the table is the right place: it is the one thing every
-- write to that table goes through, whatever screen or script is doing
-- the writing.
--
-- Deliberately narrow. It refuses only a rating going from something to
-- nothing on a month that is already scored. A manager may still change
-- a rating, and may still leave one blank while a month is being scored
-- for the first time -- that is what submit_manager_scores is for, and
-- being unable to save a part-finished score would be a worse bug than
-- the one this fixes.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.guard_core_rating_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s  kpi_submissions%rowtype;
  me uuid;
begin
  if system_write_active() then
    return new;
  end if;

  -- No end user means a direct database connection: a migration, an admin
  -- script, or the service role. Those are trusted and bypass RLS anyway.
  -- An anonymous PostgREST caller never reaches here — every policy on this
  -- table is `to authenticated`, and anon holds no UPDATE grant.
  if auth.uid() is null then
    return new;
  end if;

  select * into s from kpi_submissions where id = new.submission_id;
  if is_hr_admin() then return new; end if;
  me := current_employee_id();

  if s.employee_id = me then
    if new.manager_rating is distinct from old.manager_rating
       or new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager rating';
    end if;
  elsif manages_employee(s.employee_id) then
    if new.self_rating is distinct from old.self_rating then
      raise exception 'You cannot edit the team member''s self rating';
    end if;
    -- A rating cannot be taken back out of a month that has been scored.
    --
    -- submit_manager_scores refuses to submit with any core value
    -- unrated, which covers the way in. It does not cover the way back:
    -- a scored month is edited by saving rather than submitting, so
    -- clearing a rating there passes no check at all and simply lowers
    -- the core-values figure. Core values are 20 of the 100 and only the
    -- manager rates them, so blanking all five removes a fifth of
    -- somebody's month with nothing on screen or in the log saying it
    -- happened.
    if s.status in ('scored', 'finalized')
       and old.manager_rating is not null
       and new.manager_rating is null then
      raise exception
        'This month is already scored — a core value cannot be left unrated. Change the rating instead.';
    end if;
  else
    raise exception 'Not permitted';
  end if;
  return new;
end $function$;


notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Three things, on a real scored month, rolled back: a manager cannot
-- blank a rating, CAN still change one, and is still free to leave one
-- blank on a month that has not been scored yet.
-- ---------------------------------------------------------------------
do $test$
declare
  rid     uuid;
  sid     uuid;
  auth_id uuid;
  refused boolean := false;
begin
  select r.id, r.submission_id, m.auth_user_id
    into rid, sid, auth_id
  from core_value_ratings r
  join kpi_submissions s on s.id = r.submission_id
  join employees e on e.id = s.employee_id
  join employees m on m.id = e.reporting_manager_id
  where s.status in ('scored', 'finalized')
    and r.manager_rating is not null
    and m.auth_user_id is not null
  limit 1;

  if rid is null then
    raise notice '0103 self-test skipped (no scored month with a rated core value)';
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', auth_id, 'role', 'authenticated')::text, true);

  -- 1. Blanking it is refused.
  begin
    update core_value_ratings set manager_rating = null where id = rid;
  exception when others then
    if sqlerrm like '%cannot be left unrated%' then refused := true; else raise; end if;
  end;
  if not refused then
    raise exception 'a manager blanked a core value on a scored month';
  end if;

  -- 2. Changing it is still allowed, which is the point of being narrow.
  update core_value_ratings
  set manager_rating = (select label from rating_scale order by points desc limit 1)
  where id = rid;

  raise notice '0103 self-test passed (blanking refused, changing allowed)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
