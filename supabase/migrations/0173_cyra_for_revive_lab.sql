-- =====================================================================
-- Cyrix KPI  ·  0173  ·  CYRA for everyone with Revive Lab
--
-- The user, 12 Oct: "assign this module to those who have revive lab
-- module". A one-time grant; from here on CYRA is given or taken in
-- Administration like any other module.
-- =====================================================================

insert into employee_modules (employee_id, module_code)
select employee_id, 'cyra' from employee_modules where module_code = 'revive'
on conflict do nothing;
