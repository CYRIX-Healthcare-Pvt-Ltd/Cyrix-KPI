-- =====================================================================
-- Cyrix KPI  ·  0025  ·  ESMS reports as its own figure
--
-- 0024 folded ESMS into the core values roll-up. That kept the reported
-- split at 80 / 20 and left every view downstream untouched, which was
-- the cheap answer and the wrong one: ESMS is its own band on the sheet
-- and its own obligation, and a person who misses their ESMS target
-- should be able to see that rather than watching one blended number
-- drop for reasons it does not explain.
--
--   with ESMS       Job role 80   ·  ESMS 5  ·  Core values 15
--   without         Job role 80              ·  Core values 20
--
-- So it gets its own stored score. Null for everyone who does not carry
-- ESMS — which is the distinction the screens read to decide whether to
-- print two figures or three.
-- =====================================================================

alter table kpi_submissions
  add column if not exists self_esms_score  numeric(9,4),
  add column if not exists mgr_esms_score   numeric(9,4),
  add column if not exists final_esms_score numeric(9,4);

comment on column kpi_submissions.final_esms_score is
  'Null when this person carries no ESMS obligation, which is how the '
  'screens tell a three-way split from a two-way one.';


-- ---------------------------------------------------------------------
-- The roll-up, three ways.
--
-- 0024 changed the core filter to "everything that is not the job role"
-- so ESMS had somewhere to land. It goes back to naming core values, and
-- the total names all three — which is also the assertion that nothing
-- can fall between them: a section that belonged to no filter used to be
-- silently dropped from the total, and now would have to be dropped from
-- a sum of three named things.
-- ---------------------------------------------------------------------
create or replace function recompute_submission_totals(p_submission_id uuid)
returns void
language plpgsql
as $$
declare
  blend  jsonb;
  self_w numeric;
  mgr_w  numeric;
begin
  perform set_config('cyrix.system_write', 'on', true);

  select value into blend from app_settings where key = 'score_blend';
  self_w := coalesce((blend->>'self_weight')::numeric,    0.5);
  mgr_w  := coalesce((blend->>'manager_weight')::numeric, 0.5);

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

  perform set_config('cyrix.system_write', 'off', true);
end $$;


-- ---------------------------------------------------------------------
-- Backfill.
--
-- Only the months that already exist, and only through the function that
-- owns these numbers — recomputing rather than arithmetic on the stored
-- figures, so a month that was rolled up under the old rule ends up
-- identical to one rolled up today.
-- ---------------------------------------------------------------------
do $$
declare
  sid uuid;
  n   int := 0;
begin
  for sid in select id from kpi_submissions loop
    perform recompute_submission_totals(sid);
    n := n + 1;
  end loop;
  raise notice '0025 recomputed % submission(s)', n;
end $$;


-- ---------------------------------------------------------------------
-- The year's averages gain the same third figure.
--
-- Dropped and recreated rather than replaced: the new column belongs
-- beside the other two averages, and CREATE OR REPLACE VIEW can only
-- append. security_invoker has to be restated with it — without it the
-- view would go back to running as its owner, which is the hole 0018
-- closed.
-- ---------------------------------------------------------------------
drop view if exists v_annual_summary;

create view v_annual_summary
with (security_invoker = true) as
select
  s.employee_id,
  e.ecode,
  e.full_name,
  e.reporting_manager_id,
  s.financial_year,
  count(*) filter (where s.status = 'finalized')          as months_finalized,
  count(*)                                                as months_scored,
  round(avg(s.final_job_role_score), 2)                   as avg_job_role_score,
  -- Null all year for anyone who carries no ESMS, rather than zero: they
  -- did not score nothing on it, it does not apply to them.
  round(avg(s.final_esms_score), 2)                       as avg_esms_score,
  round(avg(s.final_core_score), 2)                       as avg_core_values_score,
  round(avg(s.final_total_score), 2)                      as avg_total_score,
  min(s.final_total_score)                                as lowest_month,
  max(s.final_total_score)                                as highest_month
from kpi_submissions s
join employees e on e.id = s.employee_id
where s.status in ('scored','finalized')
group by s.employee_id, e.ecode, e.full_name, e.reporting_manager_id, s.financial_year;

grant select on v_annual_summary to authenticated;


-- ---------------------------------------------------------------------
-- Self-test: score one of each and check the arithmetic.
-- ---------------------------------------------------------------------
do $$
declare
  fy       text;
  emp      uuid;
  aid      uuid;
  sid      uuid;
  s        kpi_submissions%rowtype;
  n_leak   int;
  invoker  boolean;
begin
  select code into fy from financial_years where is_current;

  select e.id into emp from employees e
  where e.is_active and e.reporting_manager_id is not null
    and not exists (
      select 1 from kpi_assignments ka
      where ka.employee_id = e.id and ka.financial_year = fy
        and ka.status in ('draft','pending_approval','active'))
    and not exists (
      select 1 from kpi_submissions ks where ks.employee_id = e.id)
  limit 1;
  if emp is null then
    raise notice '0025 self-test skipped — no employee free of KPIs and months';
    return;
  end if;

  -- Built as a draft and approved afterwards, in that order: set_esms
  -- refuses to touch an approved KPI, which is the rule it is meant to
  -- enforce and not something to work around here.
  insert into kpi_assignments (employee_id, financial_year, status)
  values (emp, fy, 'draft') returning id into aid;

  insert into kpi_assignment_items (
    assignment_id, section, kra, weightage, target_value, scoring_rule, sort_order)
  values (aid, 'job_role', 'Audit Planning', 80, 100, 'higher_capped', 1);

  perform set_esms(aid, true);
  update kpi_assignments set status = 'active' where id = aid;

  insert into kpi_submissions (assignment_id, employee_id, financial_year,
                               period_month, status)
  values (aid, emp, fy, date_trunc('month', current_date)::date - interval '1 month',
          'draft')
  returning id into sid;

  insert into kpi_submission_items (
    submission_id, assignment_item_id, section, kra, weightage, target_value,
    scoring_rule, sort_order, self_achieved, manager_achieved)
  select sid, ai.id, ai.section, ai.kra, ai.weightage, ai.target_value,
         ai.scoring_rule, ai.sort_order, 100, 100
  from kpi_assignment_items ai where ai.assignment_id = aid;

  perform recompute_submission_totals(sid);
  select * into s from kpi_submissions where id = sid;

  -- Everything at target: 80 + 5 + 15, each in its own column.
  if s.final_job_role_score <> 80 then
    raise exception 'job role scored % of 80', s.final_job_role_score;
  end if;
  if s.final_esms_score is null or s.final_esms_score <> 5 then
    raise exception 'ESMS scored % of 5', coalesce(s.final_esms_score::text, 'null');
  end if;
  if s.final_core_score <> 15 then
    raise exception 'core values scored % of 15', s.final_core_score;
  end if;
  if s.final_total_score <> 100 then
    raise exception
      'the three sections total % rather than 100 — one of them is being '
      'counted twice or not at all', s.final_total_score;
  end if;

  -- Turning ESMS off must leave nothing behind in the ESMS column.
  update kpi_assignments set status = 'draft' where id = aid;
  perform set_esms(aid, false);
  delete from kpi_submission_items where submission_id = sid;
  insert into kpi_submission_items (
    submission_id, assignment_item_id, section, kra, weightage, target_value,
    scoring_rule, sort_order, self_achieved, manager_achieved)
  select sid, ai.id, ai.section, ai.kra, ai.weightage, ai.target_value,
         ai.scoring_rule, ai.sort_order, 100, 100
  from kpi_assignment_items ai where ai.assignment_id = aid;

  perform recompute_submission_totals(sid);
  select * into s from kpi_submissions where id = sid;

  if s.final_esms_score is not null then
    raise exception
      'a person with no ESMS carries a score of % for it', s.final_esms_score;
  end if;
  if s.final_core_score <> 20 or s.final_total_score <> 100 then
    raise exception 'without ESMS the split is %/% rather than 80/20 = 100',
      s.final_job_role_score, s.final_core_score;
  end if;

  delete from kpi_submissions where id = sid;
  delete from kpi_assignments where id = aid;

  -- The rebuilt view must still be scoped to the caller.
  select c.reloptions @> array['security_invoker=true'] into invoker
  from pg_class c where c.relname = 'v_annual_summary';
  if not coalesce(invoker, false) then
    raise exception 'v_annual_summary was rebuilt without security_invoker';
  end if;

  -- And nothing anywhere should have a total that misses a section.
  select count(*) into n_leak from kpi_submissions
  where final_total_score is not null
    and abs(final_total_score
            - (coalesce(final_job_role_score, 0) + coalesce(final_esms_score, 0)
               + coalesce(final_core_score, 0))) > 0.0001;
  if n_leak > 0 then
    raise exception '% month(s) have a total that does not match its parts', n_leak;
  end if;

  raise notice
    '0025 self-test passed — 80/5/15 and 80/20 both total 100, ESMS is null '
    'for those without it, and the view is still invoker-scoped';
end $$;
