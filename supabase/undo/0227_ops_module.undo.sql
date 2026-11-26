-- Undo 0227: the Ops tile, its grant guard and its two functions. Run as postgres (SQL editor).
drop function if exists ops_overview(int);
drop function if exists is_ops_admin();
drop trigger if exists employee_modules_ops_guard on employee_modules;
drop function if exists guard_ops_grant();
delete from employee_modules where module_code = 'ops';
delete from app_modules where code = 'ops';
delete from _migrations where filename = '0227_ops_module.sql';
