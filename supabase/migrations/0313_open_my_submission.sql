-- =====================================================================
-- Cyrix KPI  ·  0313  ·  Start month opens only your own month
--
-- open_submission(employee, month) returns the whole kpi_submissions row,
-- scores and remarks included, and never checked the caller: any
-- signed-in employee could pass a colleague's id and read that month, or
-- create it in their name (audit finding H1).
--
-- 0239 tried a caller check inside open_submission, but open_submission
-- also runs inside settle_due_submissions (run when anyone opens the
-- app), approve_assignment, bulk_assign_kpi, kpi_reopen_month and others,
-- where the signed-in person is not the employee — those would be
-- refused. 0239 is therefore NOT applied; this replaces it (the user,
-- 26 Nov 2026: "ok build it").
--
--   * open_my_submission(month): the Start month button; always the
--     signed-in person's own month.
--   * open_submission is no longer callable from the browser. The
--     database functions above run as their owner and keep calling it.
--   * Managers, HR and SW Admin read months through kpi_submissions'
--     own row rule (submissions_read), which does not change.
-- =====================================================================

-- Part 1 — the new function (applied first, before the app switches to it).
CREATE OR REPLACE FUNCTION public.open_my_submission(p_period_month date)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id();
begin
  if me is null then
    raise exception 'Sign in to start a month.' using errcode = '42501';
  end if;
  return open_submission(me, p_period_month);
end $function$;

revoke all on function public.open_my_submission(date) from public, anon;
grant execute on function public.open_my_submission(date) to authenticated, service_role;

-- Part 2 — applied once the app uses open_my_submission (open tabs reload onto it).
-- revoke execute on function public.open_submission(uuid, date) from public, anon, authenticated;
