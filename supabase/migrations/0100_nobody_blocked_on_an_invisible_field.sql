-- =====================================================================
-- Cyrix KPI  ·  0100  ·  Nobody can be blocked on a field they cannot see
--
-- Reported from the floor: every employee pressing Submit got
-- "5 core value(s) have not been rated", and there was nothing on the
-- form to rate. The month could not be submitted by anybody.
--
-- submit_self_assessment has required every core_value_ratings.self_rating
-- to be filled since 0005. That was correct for as long as the employee
-- rated their own core values. When those moved to the manager the
-- dropdown came off the form and the gate stayed behind it, so a check
-- that had always passed became one that could never pass -- and the
-- message it printed named a control the person could not see, which is
-- the worst kind of validation error: it tells you to do something and
-- gives you no way to do it.
--
-- The gate goes. Nothing replaces it here, because there is nothing for
-- the employee to have missed: the manager's core-value ratings are
-- checked when the MANAGER submits, which is where that judgement now
-- lives.
--
-- What stays is every other check, all of which still describe something
-- the person can act on: their own job role rows must have a figure,
-- they can only submit their own month, and a month already submitted
-- cannot be submitted twice.
--
-- This is the live definition with that one block replaced, taken from
-- pg_get_functiondef rather than retyped, and verified by putting the
-- block back and diffing to the original.
--
-- Worth recording as a pattern rather than a one-off: 0095 to 0099
-- changed what the form asks for, and the checks behind the form live in
-- functions written years earlier. This is the second such break in a
-- week -- strip-data.mjs in the BEMMP repo was the other -- and both
-- failed silently in the sense that the code was still doing exactly
-- what it was written to do.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.submit_self_assessment(p_submission_id uuid)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s       kpi_submissions%rowtype;
  missing int;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if s.employee_id <> current_employee_id() then
    raise exception 'You can only submit your own assessment';
  end if;
  if s.status not in ('draft','returned') then
    raise exception 'This month has already been submitted (current: %)', s.status;
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id
    and section <> 'core_values' and self_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still have no achieved value', missing;
  end if;

  -- No core-value gate. Those moved to the manager, so there is nothing
  -- here for the employee to have missed.
  --
  -- This required every core_value_ratings.self_rating to be filled, and
  -- once the dropdown that filled them was taken off the form the check
  -- could not be satisfied by anybody. Every submission failed with
  -- "5 core value(s) have not been rated", naming a control the person
  -- could not see. The manager's ratings are checked when the MANAGER
  -- submits, which is where that judgement now lives.

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'submitted', self_submitted_at = now()
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'self_submitted', '{}'::jsonb);
  return s;
end $function$;


notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Proves the thing that was broken: a draft whose core values are
-- unrated -- which is now every draft -- submits. Rolled back, so no
-- real month is moved.
-- ---------------------------------------------------------------------
do $test$
declare
  sub_id  uuid;
  emp_id  uuid;
  auth_id uuid;
  unrated int;
  after   text;
begin
  -- A real draft belonging to somebody with a login.
  select s.id, s.employee_id, e.auth_user_id
    into sub_id, emp_id, auth_id
  from kpi_submissions s
  join employees e on e.id = s.employee_id
  where s.status in ('draft', 'returned')
    and e.auth_user_id is not null
    and not exists (
      select 1 from kpi_submission_items i
      where i.submission_id = s.id
        and i.section <> 'core_values' and i.self_achieved is null)
  limit 1;

  if sub_id is null then
    raise notice '0100 self-test skipped (no complete draft to submit)';
    return;
  end if;

  -- The state that was failing: core values not rated by the employee.
  select count(*) into unrated
  from core_value_ratings
  where submission_id = sub_id and self_rating is null;

  perform set_config('request.jwt.claims',
    json_build_object('sub', auth_id, 'role', 'authenticated')::text, true);

  perform submit_self_assessment(sub_id);

  select status into after from kpi_submissions where id = sub_id;
  if after <> 'submitted' then
    raise exception 'submit left the month at %, expected submitted', after;
  end if;

  raise notice '0100 self-test passed (submitted with % core value(s) unrated)', unrated;
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
