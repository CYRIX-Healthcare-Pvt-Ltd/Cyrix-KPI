-- =====================================================================
-- Cyrix KPI  ·  0301  ·  Core value rules worked out once per request
--
-- 20 Nov: the database ran out of memory at the morning rush (09:41). The
-- core values page was the heaviest KPI query: 1.3 s and 1.4 million blocks
-- per open, because the read rule on core_value_ratings asked "is this my KPI,
-- my team member's, or am I HR?" (three lookups) for every one of its 38,000
-- rows. The user: "ok do kpi". Now the person, their direct reports and HR are
-- worked out once and each row is a quick look-up. Who may read or change
-- what is exactly as 0006.
-- =====================================================================

drop policy if exists core_ratings_read on core_value_ratings;
create policy core_ratings_read on core_value_ratings for select to authenticated
  using (submission_id in (
    select s.id from kpi_submissions s
    where (select is_hr_admin())
       or s.employee_id = (select current_employee_id())
       or s.employee_id in (select tm.id from employees tm join employees mgr on mgr.id = tm.reporting_manager_id
                            where mgr.auth_user_id = (select auth.uid()))));

drop policy if exists core_ratings_update on core_value_ratings;
create policy core_ratings_update on core_value_ratings for update to authenticated
  using (submission_id in (
    select s.id from kpi_submissions s
    where s.status <> 'finalized'
      and ((select is_hr_admin())
        or (s.employee_id = (select current_employee_id()) and s.status in ('draft', 'returned'))
        or (s.status in ('submitted', 'scored')
            and s.employee_id in (select tm.id from employees tm join employees mgr on mgr.id = tm.reporting_manager_id
                                  where mgr.auth_user_id = (select auth.uid()))))));
