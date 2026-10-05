-- =====================================================================
-- Cyrix KPI  ·  0145  ·  A start month says what a change reaches
--
-- Somebody changing a KPI they have used since April set "This KPI
-- starts from" to Sep-26 — the month the change was for — and was told:
-- "This KPI already has an assessment for Apr-26, which is before Sep-26.
-- Request the deletion of that month first, or choose an earlier start."
-- The user, 5 Oct: "what is this?"
--
-- The start month is where the KPI began, and a change reaches the months
-- the manager has not reviewed whatever the start (0144). Deleting April
-- would have thrown away an assessed month. The screens now stop the
-- choice at the first assessed month and say why; this says the same
-- thing for any way in that does not.
--
-- Only the message changes. The rule is as it was: the start cannot pass
-- a month already submitted, sent back, reviewed or final.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_kpi_start(p_assignment_id uuid, p_starts_from date)
 RETURNS kpi_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a       kpi_assignments%rowtype;
  month1  date := date_trunc('month', p_starts_from)::date;
  fy_from date;
  fy_to   date;
  earlier date;
  gone    record;
  removed integer := 0;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;

  if not (a.employee_id = current_employee_id()
          or manages_employee(a.employee_id)
          or is_hr_admin()) then
    raise exception 'You can only set the start month on your own KPI';
  end if;

  if p_starts_from is null then
    raise exception 'Choose the month this KPI starts from';
  end if;

  select starts_on, ends_on into fy_from, fy_to
  from financial_years where code = a.financial_year;

  if month1 < fy_from or month1 > fy_to then
    raise exception
      'The start month must be inside FY % (% to %)',
      a.financial_year, to_char(fy_from, 'Mon-YY'), to_char(fy_to, 'Mon-YY');
  end if;

  -- A filed month blocks; a draft does not.
  --
  -- The system opens a draft for every month the KPI covers, so under
  -- the old rule a start could never move forward at all: the month
  -- being moved past always had a shell nobody had touched, and the
  -- setting refused on it. "Delete that month first" was advice with
  -- nothing behind it, since there is no way to delete a draft.
  select min(period_month) into earlier
  from kpi_submissions
  where employee_id = a.employee_id
    and financial_year = a.financial_year
    and period_month < month1
    and status <> 'draft';

  if earlier is not null then
    -- The start is where the KPI began, not the month a change is for: a
    -- change reaches the months the manager has not reviewed, whatever
    -- the start. The old advice, to request the deletion of that month,
    -- would have thrown away an assessed month (0145; the user, 5 Oct).
    raise exception
      'This KPI has been assessed from %, so it starts from % or earlier. '
      'A change to it reaches the months the manager has not reviewed yet; assessed months keep what they were assessed on.',
      to_char(earlier, 'Mon-YY'), to_char(earlier, 'Mon-YY');
  end if;

  -- The drafts the new start leaves behind.
  --
  -- Not ignored, removed: a month the KPI no longer covers would sit
  -- on the employee's list as something to fill in, and open_submission
  -- would refuse it if they tried. Recorded row by row first, with
  -- anything typed into it, so a month cleared here is still readable
  -- in the audit trail rather than gone.
  for gone in
    select s.id, s.period_month, s.employee_remarks,
           (select jsonb_agg(jsonb_build_object(
                     'kra', i.kra, 'section', i.section,
                     'self_achieved', i.self_achieved,
                     'manager_achieved', i.manager_achieved)
                   order by i.sort_order)
            from kpi_submission_items i
            where i.submission_id = s.id
              and (i.self_achieved is not null
                or i.manager_achieved is not null)) as figures
    from kpi_submissions s
    where s.employee_id    = a.employee_id
      and s.financial_year = a.financial_year
      and s.period_month   < month1
      and s.status         = 'draft'
  loop
    perform log_audit('kpi_submission', gone.id, 'draft_removed',
      jsonb_build_object(
        'period',           gone.period_month,
        'why',              'KPI start moved to ' || to_char(month1, 'Mon-YY'),
        'figures',          gone.figures,
        'employee_remarks', gone.employee_remarks));
    delete from kpi_submissions where id = gone.id;
    removed := removed + 1;
  end loop;

  update kpi_assignments set starts_from = month1
  where id = p_assignment_id
  returning * into a;

  perform log_audit('kpi_assignment', p_assignment_id, 'start_month_set',
                    jsonb_build_object('starts_from', month1,
                                       'drafts_removed', removed));
  return a;
end $function$;
