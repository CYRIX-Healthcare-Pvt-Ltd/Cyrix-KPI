-- =====================================================================
-- Cyrix KPI  ·  0104  ·  A low core value needs a reason
--
-- Management: rating a core value Satisfactory or Poor requires saying
-- why, and the team member sees it.
--
-- The field went on the form in the previous commit and was optional,
-- because the earlier instruction had been that the MANDATORY remark was
-- the one for a job-role gap. It is mandatory here too.
--
-- Satisfactory and Poor are the bottom two of the five on rating_scale.
-- A core value is a judgement about how somebody conducts themselves
-- rather than a figure they missed, which makes it the score they can do
-- least about without being told what it refers to -- and the reason is
-- shown to them, which is the whole point of collecting it.
--
-- The threshold is read off rating_scale.points rather than compared
-- against the words, so rewording a label cannot silently switch the
-- requirement off. That table is data and somebody will eventually edit
-- it.
--
-- This covers submitting. It deliberately does not stop a manager saving
-- a part-finished score, the same way 0101 does not: being unable to
-- save work in progress would be a worse bug than the one it prevents.
-- The screen gates its own Save button so the manager is told before
-- they press it rather than after.
--
-- 0101's function with one block added, taken from pg_get_functiondef
-- and verified by reversing the addition and diffing to the original.
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

  -- And a low one needs a reason.
  --
  -- Satisfactory and Poor are the bottom two of the five, and a core
  -- value is a judgement about how somebody conducts themselves rather
  -- than a figure they missed -- the score they can do least about
  -- without being told why. The reason is shown to them, which is the
  -- whole point of collecting it.
  --
  -- Read off rating_scale rather than compared against the words, so
  -- rewording a label does not silently switch the requirement off.
  select count(*) into missing
  from core_value_ratings r
  join rating_scale rs on rs.label = r.manager_rating
  where r.submission_id = p_submission_id
    and rs.points <= 40
    and coalesce(btrim(r.manager_remarks), '') = '';
  if missing > 0 then
    raise exception
      '% core value(s) rated Satisfactory or Poor need a reason. % will see it.',
      missing,
      coalesce((select split_part(full_name, ' ', 1) from employees where id = s.employee_id), 'They');
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
-- A low rating with no reason is refused; the same rating with one goes
-- through. Rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  sub_id  uuid;
  auth_id uuid;
  low     text;
  refused boolean := false;
begin
  select s.id, m.auth_user_id
    into sub_id, auth_id
  from kpi_submissions s
  join employees e on e.id = s.employee_id
  join employees m on m.id = e.reporting_manager_id
  where s.status = 'submitted' and m.auth_user_id is not null
  limit 1;

  if sub_id is null then
    raise notice '0104 self-test skipped (no submitted month with a manager who has a login)';
    return;
  end if;

  select label into low from rating_scale where points <= 40 order by points desc limit 1;

  -- Everything else complete, so the new gate is what is being tested.
  update kpi_submission_items
  set manager_achieved = coalesce(manager_achieved, self_achieved, 0)
  where submission_id = sub_id and section <> 'core_values';
  update core_value_ratings
  set manager_rating = low, manager_remarks = null
  where submission_id = sub_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', auth_id, 'role', 'authenticated')::text, true);

  begin
    perform submit_manager_scores(sub_id, 'probe');
  exception when others then
    if sqlerrm like '%need a reason%' then refused := true; else raise; end if;
  end;
  if not refused then
    raise exception 'a low core value was submitted with no reason';
  end if;

  -- With reasons, the same month submits.
  update core_value_ratings
  set manager_remarks = 'probe reason'
  where submission_id = sub_id;
  perform submit_manager_scores(sub_id, 'probe');

  raise notice '0104 self-test passed (no reason refused, reason accepted)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
