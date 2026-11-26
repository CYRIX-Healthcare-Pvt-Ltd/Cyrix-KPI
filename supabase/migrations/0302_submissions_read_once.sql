-- =====================================================================
-- Cyrix KPI  ·  0302  ·  The KPI read rule worked out once per request
--
-- 20 Nov, after 0301: the core values page still took 0.5 s because the rule
-- on kpi_submissions asked "mine, my team member's, HR or SW admin?" for each
-- of its 7,600 rows (130,000 blocks). Now the person, their direct reports
-- and the admin roles are worked out once. Who may read what is exactly as
-- before (checked for 221 people: HR, SW, managers, staff, test logins).
-- =====================================================================

drop policy if exists submissions_read on kpi_submissions;
create policy submissions_read on kpi_submissions for select to authenticated
  using ((select is_hr_admin())
      or (select is_sw_admin())
      or employee_id = (select current_employee_id())
      or employee_id in (select tm.id from employees tm join employees mgr on mgr.id = tm.reporting_manager_id
                         where mgr.auth_user_id = (select auth.uid())));
