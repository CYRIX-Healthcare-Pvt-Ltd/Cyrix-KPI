-- =====================================================================
-- Cyrix KPI  ·  0216  ·  SW Admin reads every KPI, for the KPI report
--
-- The user, 19 Oct: "add this KPI report under KPI tab also for sw admin".
-- The report reads kpi_submissions and kpi_assignments as whoever is
-- looking (security invoker), and their read rules let only HR Admin see
-- everybody — a SW Admin who is not also HR would get an empty report.
-- SW Admin now reads them too. Reading only: who may write is unchanged.
-- =====================================================================

alter policy submissions_read on public.kpi_submissions
  using ((employee_id = current_employee_id()) or manages_employee(employee_id) or is_hr_admin() or is_sw_admin());

alter policy assignments_read on public.kpi_assignments
  using ((employee_id = current_employee_id()) or manages_employee(employee_id) or is_hr_admin() or is_sw_admin());
