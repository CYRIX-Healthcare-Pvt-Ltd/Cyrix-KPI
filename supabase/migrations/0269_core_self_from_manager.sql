/*
  0269 — Turning on "Team member rates core values" for a KPI that already has months (the user, 9 Nov: "for earlier
  month ... only manager may have did it so", then "manager gave the core value, so make it same for their entry, and
  split the average in sub core values also").

  1. Every month the manager has already scored: the team member's own entry for each core value
     takes the manager's rating, and each of its parts is filled with that same rating for both of them, so a core
     value's average — and the month's score — stays exactly what the manager gave. A rating the team member already
     gave themselves stays theirs. Done when the tick goes on; KPIs that already have it are left as they are.
  2. A month the manager did not score by the last day takes the team member's own core value rating only when there
     is one; a month without one (filed before the tick) keeps full marks for core values, as before, instead of 0.
*/

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The manager's ratings into the team member's entry and the parts, on the months the manager rated.
create or replace function public.core_self_from_manager(p_assignment_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $f$
declare prev text := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off'); n int := 0; sid uuid; was numeric;
begin
  perform set_config('cyrix.system_write', 'on', true);
  for sid in
    select distinct s.id from kpi_submissions s join core_value_ratings r on r.submission_id = s.id
    where s.assignment_id = p_assignment_id and s.status in ('scored', 'finalized') and r.manager_rating is not null
      and (r.self_rating is null or not exists (select 1 from core_value_part_ratings x where x.rating_id = r.id))
  loop
    -- The core values figure the month was scored on: it stays, whatever weights the KPI has today.
    select i.manager_achieved into was from kpi_submission_items i where i.submission_id = sid and i.section = 'core_values' limit 1;
    -- The parts of each core value the manager rated, both ratings the manager's.
    insert into core_value_part_ratings (submission_id, rating_id, part_id, label, is_goal, sort_order, self_rating, manager_rating)
    select r.submission_id, r.id, p.id, p.label, p.is_goal, p.sort_order, coalesce(r.self_rating, r.manager_rating), r.manager_rating
    from core_value_ratings r
    join core_value_parts p on p.core_value_id = r.core_value_id and p.is_active
    where r.submission_id = sid and r.manager_rating is not null
      and not exists (select 1 from core_value_part_ratings x where x.rating_id = r.id)
    on conflict do nothing;
    -- Parts already there (a month that had them) take the manager's rating where a side is empty.
    update core_value_part_ratings x
       set self_rating = coalesce(x.self_rating, r.self_rating, r.manager_rating), manager_rating = coalesce(x.manager_rating, r.manager_rating)
      from core_value_ratings r
     where r.id = x.rating_id and r.submission_id = sid and r.manager_rating is not null
       and (x.self_rating is null or x.manager_rating is null);
    update core_value_ratings r set self_rating = r.manager_rating
     where r.submission_id = sid and r.manager_rating is not null and r.self_rating is null;
    update kpi_submission_items i set manager_achieved = was, self_achieved = coalesce(was, i.self_achieved)
     where i.submission_id = sid and i.section = 'core_values' and was is not null;
    perform recompute_submission_totals(sid);
    n := n + 1;
  end loop;
  perform set_config('cyrix.system_write', prev, true);
  return n;
end $f$;
revoke all on function public.core_self_from_manager(uuid) from public, anon, authenticated;

-- The tick: switched on, the months the manager rated are filled in as above.
CREATE OR REPLACE FUNCTION public.set_core_value_options(p_assignment_id uuid, p_self boolean, p_weights jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a kpi_assignments%rowtype; total numeric;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'KPI not found'; end if;
  if not (a.employee_id = current_employee_id() or manages_employee(a.employee_id) or is_hr_admin() or is_sw_admin()) then
    raise exception 'Not permitted';
  end if;
  if p_weights is not null then
    select sum((v)::numeric) into total from jsonb_each_text(p_weights) as e(k, v);
    if total is null or abs(total - a.core_values_weight) > 0.01 then
      raise exception 'Core value weights must add up to %', a.core_values_weight || '%';
    end if;
  end if;
  update kpi_assignments set core_self_rating = coalesce(p_self, false), core_value_weights = p_weights where id = p_assignment_id;
  if coalesce(p_self, false) then
    perform ensure_core_parts(s.id) from kpi_submissions s where s.assignment_id = p_assignment_id and s.status in ('draft', 'returned');
    if not a.core_self_rating then perform core_self_from_manager(p_assignment_id); end if;
  else
    perform set_config('cyrix.system_write', 'on', true);
    delete from core_value_part_ratings p using kpi_submissions s
     where s.id = p.submission_id and s.assignment_id = p_assignment_id and s.status in ('draft', 'returned');
    perform set_config('cyrix.system_write', 'off', true);
  end if;
  perform log_audit('kpi_assignment', p_assignment_id, 'core_value_options',
    jsonb_build_object('self', coalesce(p_self, false), 'weights', p_weights));
end $function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. A month not scored by the manager: the team member's own core value rating only when there is one.
CREATE OR REPLACE FUNCTION public.recompute_submission_totals(p_submission_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  prev_write text;
  blend  jsonb;
  self_w numeric;
  mgr_w  numeric;
begin
  prev_write := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off');
  perform set_config('cyrix.system_write', 'on', true);

  select value into blend from app_settings where key = 'score_blend';
  -- The fallback is the policy, not the old policy.
  --
  -- These defaulted to 0.5/0.5, which was right until 0095 made the
  -- manager's figure the score. The stored row says 0/1 and is what
  -- actually runs, so nothing is wrong today -- but a fallback is a
  -- promise about what happens when the row is missing, and this one
  -- promised to go back to averaging. Deleting a settings row would have
  -- silently rescored the company back to a rule management withdrew.
  self_w := coalesce((blend->>'self_weight')::numeric,    0);
  mgr_w  := coalesce((blend->>'manager_weight')::numeric, 1);

  update kpi_submission_items i
  set
    self_score    = calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                   i.self_achieved, i.rule_params),
    manager_score = case
                      when i.manager_achieved is null then null
                      else calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                          i.manager_achieved, i.rule_params)
                    end,
    final_score   = case
                      when i.manager_achieved is null then null
                      else round(
                        self_w * calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                                i.self_achieved, i.rule_params)
                      + mgr_w  * calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                                i.manager_achieved, i.rule_params), 4)
                    end
  where i.submission_id = p_submission_id;

  update kpi_submissions s
  set
    self_job_role_score  = t.self_job,
    self_esms_score      = t.self_esms,
    self_core_score      = t.self_core,
    self_total_score     = coalesce(t.self_job, 0) + coalesce(t.self_esms, 0)
                         + coalesce(t.self_core, 0),
    mgr_job_role_score   = t.mgr_job,
    mgr_esms_score       = t.mgr_esms,
    mgr_core_score       = t.mgr_core,
    mgr_total_score      = case when t.mgr_scored_rows = 0 then null
                           else coalesce(t.mgr_job, 0) + coalesce(t.mgr_esms, 0)
                              + coalesce(t.mgr_core, 0) end,
    final_job_role_score = t.fin_job,
    final_esms_score     = t.fin_esms,
    final_core_score     = t.fin_core,
    final_total_score    = case when t.fin_scored_rows = 0 then null
                           else coalesce(t.fin_job, 0) + coalesce(t.fin_esms, 0)
                              + coalesce(t.fin_core, 0) end
  from (
    select
      sum(self_score)    filter (where section = 'job_role')    as self_job,
      sum(self_score)    filter (where section = 'esms')        as self_esms,
      sum(self_score)    filter (where section = 'core_values') as self_core,
      sum(manager_score) filter (where section = 'job_role')    as mgr_job,
      sum(manager_score) filter (where section = 'esms')        as mgr_esms,
      sum(manager_score) filter (where section = 'core_values') as mgr_core,
      sum(final_score)   filter (where section = 'job_role')    as fin_job,
      sum(final_score)   filter (where section = 'esms')        as fin_esms,
      sum(final_score)   filter (where section = 'core_values') as fin_core,
      count(manager_score) as mgr_scored_rows,
      count(final_score)   as fin_scored_rows
    from kpi_submission_items
    where submission_id = p_submission_id
  ) t
  where s.id = p_submission_id;

  -- A missed last day (0153). Nothing submitted: the month is 0.
  -- Not scored by the manager: the team member's own job role and ESMS,
  -- with full marks for core values, which only the manager rates.
  update kpi_submissions s
  set final_job_role_score = case when s.deadline_outcome = 'not_submitted' then 0 else coalesce(s.self_job_role_score, 0) end,
      final_esms_score     = case when not t.has_esms then null
                                  when s.deadline_outcome = 'not_submitted' then 0
                                  else coalesce(s.self_esms_score, 0) end,
      -- A KPI where the team member rates their own core values takes their rating (0214).
      final_core_score     = case when s.deadline_outcome = 'not_submitted' then 0
                                  when t.core_self and s.self_core_score is not null then s.self_core_score else t.core_full end,
      final_total_score    = case when s.deadline_outcome = 'not_submitted' then 0
                                  else coalesce(s.self_job_role_score, 0) + coalesce(s.self_esms_score, 0)
                                     + case when t.core_self and s.self_core_score is not null then s.self_core_score else t.core_full end end
  from (
    select coalesce(sum(weightage) filter (where section = 'core_values'), 0) as core_full,
           bool_or(section = 'esms') as has_esms,
           coalesce((select a.core_self_rating from kpi_submissions x join kpi_assignments a on a.id = x.assignment_id
                     where x.id = p_submission_id), false) as core_self
    from kpi_submission_items where submission_id = p_submission_id
  ) t
  where s.id = p_submission_id and s.deadline_outcome is not null;

  perform set_config('cyrix.system_write', prev_write, true);
end $function$;
