/*
  0296 (the user, 18 Nov): "All months, keep the figures" took a KPI's new wording, weightage and rule into every month
  but left each month's old target (Joseph P V E1081: Technical Training target 2 changed to 100, the months kept 2).
  A month whose target was the KPI's old one now takes the new one; a month given its own target keeps it.
*/
do $$
declare f text;
  a0 text := $q$  /* ---- the KPI's own rows, by id ---------------------------------- */$q$;
  b0 text := $q$  drop table if exists _old_targets;
  create temp table _old_targets on commit drop as
    select id, target_value from kpi_assignment_items where assignment_id = p_assignment_id and section = 'job_role';

  /* ---- the KPI's own rows, by id ---------------------------------- */$q$;
  a1 text := $q$       set kra = ai.kra, kpi_description = ai.kpi_description, weightage = ai.weightage,
           target_unit = ai.target_unit,$q$;
  b1 text := $q$       set kra = ai.kra, kpi_description = ai.kpi_description, weightage = ai.weightage,
           target_value = case when ot.target_value is distinct from ai.target_value
                                and si.target_value is not distinct from ot.target_value
                               then ai.target_value else si.target_value end,
           target_unit = ai.target_unit,$q$;
  a2 text := $q$      from kpi_assignment_items ai
     where si.submission_id = sm.id and si.section = 'job_role'
       and ai.id = si.assignment_item_id and ai.section = 'job_role';$q$;
  b2 text := $q$      from kpi_assignment_items ai left join _old_targets ot on ot.id = ai.id
     where si.submission_id = sm.id and si.section = 'job_role'
       and ai.id = si.assignment_item_id and ai.section = 'job_role';$q$;
begin
  f := pg_get_functiondef('public.sync_assignment_rows_by_id(uuid,jsonb,text)'::regprocedure);
  if position(a0 in f) = 0 or position(a1 in f) = 0 or position(a2 in f) = 0 then raise exception 'sync_assignment_rows_by_id changed'; end if;
  execute replace(replace(replace(f, a0, b0), a1, b1), a2, b2);
end $$;

-- Joseph P V's months: the target he was given, 100, in every month.
select set_config('cyrix.system_write', 'on', true);
update kpi_submission_items set target_value = 100
 where assignment_item_id = '90c7dafd-3f17-46f4-869d-e78346b423e2' and target_value = 2;
select recompute_submission_totals(s.id) from kpi_submissions s
 where s.id in (select submission_id from kpi_submission_items where assignment_item_id = '90c7dafd-3f17-46f4-869d-e78346b423e2');
