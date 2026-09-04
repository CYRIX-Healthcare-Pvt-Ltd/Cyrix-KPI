-- =====================================================================
-- Cyrix KPI  ·  0101  ·  Somebody has to rate the core values, and the
--                        safeguard has to compare like with like
--
-- Both of these are consequences of core values moving to the manager,
-- and both were found while fixing 0100 rather than reported, which is
-- worth saying because neither would have announced itself.
--
-- 1. Nobody was required to rate core values any more.
--
--    The employee's submit was gated on their own ratings, and that gate
--    was the only one. When the ratings moved to the manager the gate
--    became unsatisfiable and 0100 removed it -- correctly, because it
--    named a control the employee could not see -- and that left the
--    block with nobody obliged to fill it.
--
--    An unrated block scores nothing, and core values are 20 of the 100.
--    So a manager who did not scroll that far would take a fifth of
--    somebody's month away, and neither of them would see it happen: the
--    score would simply be twenty points lower than the work.
--
--    The manager's submit now checks it, which is where the judgement
--    lives now.
--
-- 2. The score-cut safeguard could no longer fire.
--
--    A manager scoring somebody more than 5 points below that person's
--    own assessment has to say why, and the reason is shown to them.
--    That compared the two TOTALS, which was like for like while the
--    employee also rated core values.
--
--    It is not any more. The employee's total is job role and ESMS; the
--    manager's is that plus core values. So the manager's figure is now
--    almost always the LARGER of the two, the gap comes out negative,
--    and a safeguard meant to catch a manager marking somebody down had
--    quietly become one that can never trigger.
--
--    It now compares the rows both of them actually filled in -- job
--    role and ESMS -- and the message says so, because "below their own
--    assessment" should name what was measured.
--
-- The live definition with three edits, taken from pg_get_functiondef
-- and verified by reversing all three and diffing to the original.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.submit_manager_scores(p_submission_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s        kpi_submissions%rowtype;
  missing  int;
  gap      numeric;
  who      text;
  -- Mirrored in the client as SCORE_CUT_POINTS. If one moves, move both.
  cut_at   constant numeric := 5;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can score this';
  end if;
  if s.status not in ('submitted','scored') then
    raise exception 'This month is not ready for scoring (current: %)', s.status;
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id
    and section <> 'core_values' and manager_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still need a manager value', missing;
  end if;

  -- And the core values, which only the manager rates now.
  --
  -- Nothing checked this before, because the employee rated them and
  -- their own submit was gated on it. When core values moved to the
  -- manager that gate became unsatisfiable and was removed in 0100 --
  -- which left nobody required to fill them at all. An unrated block
  -- scores nothing, and core values are 20 of the 100, so a manager who
  -- simply did not scroll that far would take a fifth of somebody's
  -- month away without either of them seeing it happen.
  select count(*) into missing
  from core_value_ratings
  where submission_id = p_submission_id and manager_rating is null;
  if missing > 0 then
    raise exception
      '% core value(s) still need your rating. They are worth 20%% of the score.',
      missing;
  end if;

  -- How far below their own assessment this lands.
  -- Compared on the rows BOTH of them assessed: job role and ESMS.
  --
  -- It used to be the two totals, which was like for like while the
  -- employee also rated core values. It is not any more -- their total
  -- is job role and ESMS, the manager's is that plus core values -- so
  -- the manager's figure is now almost always the LARGER of the two and
  -- the gap comes out negative. The safeguard that makes a manager
  -- explain a score well below somebody's own assessment had quietly
  -- stopped being able to fire at all.
  gap := case
    when s.self_job_role_score is null or s.mgr_job_role_score is null then null
    else (coalesce(s.self_job_role_score, 0) + coalesce(s.self_esms_score, 0))
       - (coalesce(s.mgr_job_role_score, 0)  + coalesce(s.mgr_esms_score, 0))
  end;

  if gap is not null and gap > cut_at then
    if p_reason is null or btrim(p_reason) = '' then
      select split_part(full_name, ' ', 1) into who
      from employees where id = s.employee_id;
      raise exception
        'Your score is % points below %''s own assessment on the rows you both filled in. Say why before you submit — they will see it.',
        round(gap, 1), coalesce(who, 'their');
    end if;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status            = 'scored',
      manager_scored_at = now(),
      -- Cleared when the gap closes. A manager who revises upward should
      -- not leave last version's explanation attached to a score it no
      -- longer describes.
      score_cut_reason  = case
        when gap is not null and gap > cut_at then btrim(p_reason)
        else nullif(btrim(coalesce(p_reason, '')), '')
      end
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'manager_scored',
                    jsonb_build_object('gap', gap,
                                       'explained', p_reason is not null));
  return s;
end $function$;


notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Both halves, on a real submission, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  sub_id  uuid;
  mgr_id  uuid;
  auth_id uuid;
  failed  boolean := false;
begin
  select s.id, e.reporting_manager_id, m.auth_user_id
    into sub_id, mgr_id, auth_id
  from kpi_submissions s
  join employees e on e.id = s.employee_id
  join employees m on m.id = e.reporting_manager_id
  where s.status = 'submitted' and m.auth_user_id is not null
  limit 1;

  if sub_id is null then
    raise notice '0101 self-test skipped (no submitted month with a manager who has a login)';
    return;
  end if;

  -- Give every job-role row a manager value so the FIRST gate passes and
  -- the core-value one is what we are actually testing.
  update kpi_submission_items
  set manager_achieved = coalesce(manager_achieved, self_achieved, 0)
  where submission_id = sub_id and section <> 'core_values';

  -- Leave the core values unrated, which is the state that used to slip
  -- straight through.
  update core_value_ratings set manager_rating = null where submission_id = sub_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', auth_id, 'role', 'authenticated')::text, true);

  begin
    perform submit_manager_scores(sub_id, 'probe');
  exception when others then
    if sqlerrm like '%core value(s) still need your rating%' then
      failed := true;
    else
      raise;
    end if;
  end;

  if not failed then
    raise exception 'a manager submitted with every core value unrated';
  end if;

  raise notice '0101 self-test passed (unrated core values are refused)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
