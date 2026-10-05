-- =====================================================================
-- Cyrix KPI  ·  0142  ·  A finalised month lets go of a deleted KPI row
--
-- Saving a KPI writes its rows afresh and then deletes the old ones. A
-- month's rows point at the KPI rows they were made from, and the foreign
-- key unlinks them when those are deleted — an UPDATE of the month's rows,
-- which guard_submission_item_columns refused on a finalised month: "This
-- month is finalised and cannot be changed".
--
-- So nobody whose KPI has a finalised month could save it again — which is
-- exactly who an approved revision hands a KPI back to. Ammu Gopan's
-- revision came back on 3 Oct, and each of her ten tries to send it failed
-- after the new rows were written, leaving her KPI with eleven copies of
-- each row. E2034 has nine.
--
-- The guard now lets through an update that only unlinks a row
-- (assignment_item_id set null, everything else as it was), on any month.
-- Anything else on a finalised month is refused as before. The month keeps
-- its own copy of the KRA, the target and every score.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.guard_submission_item_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s     kpi_submissions%rowtype;
  me    uuid;
  is_hr boolean;
begin
  if system_write_active() then return new; end if;
  if auth.uid() is null then return new; end if;

  -- A KPI row deleted while a month still points at it: the foreign key
  -- unlinks the month's copy (assignment_item_id set null) and nothing else
  -- about the month changes. Allowed on a finalised month too: the month
  -- keeps its own KRA, target and scores. Refusing it stopped any KPI with a
  -- finalised month from being saved again, and every try left a copy of
  -- its rows behind (0142; Ammu Gopan, 5 Oct).
  if new.assignment_item_id is null and old.assignment_item_id is not null
     and (to_jsonb(new) - 'assignment_item_id') = (to_jsonb(old) - 'assignment_item_id') then
    return new;
  end if;

  select * into s from kpi_submissions where id = new.submission_id;
  me    := current_employee_id();
  is_hr := is_hr_admin() or is_sw_admin();

  if s.status = 'finalized' and not is_hr then
    raise exception 'This month is finalised and cannot be changed';
  end if;
  if is_hr then return new; end if;

  -- Weightage, KRA and the scoring rule are the agreed contract for the
  -- year. The target is the one part that may move month to month.
  if new.weightage is distinct from old.weightage
     or new.scoring_rule is distinct from old.scoring_rule
     or new.rule_params is distinct from old.rule_params
     or new.kra is distinct from old.kra then
    raise exception 'The KRA, weightage and scoring rule are fixed for the year';
  end if;

  if s.employee_id = me then
    if new.manager_achieved is distinct from old.manager_achieved
       or new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager assessment';
    end if;
  elsif manages_employee(s.employee_id) then
    if new.self_achieved is distinct from old.self_achieved
       or new.self_remarks is distinct from old.self_remarks then
      raise exception 'You cannot edit the team member''s self assessment';
    end if;
  else
    raise exception 'Not permitted';
  end if;

  new.self_score    := old.self_score;
  new.manager_score := old.manager_score;
  new.final_score   := old.final_score;
  return new;
end $function$;
