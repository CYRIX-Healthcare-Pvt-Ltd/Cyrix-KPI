-- Undo 0230: stop collecting browser errors. Run as postgres (SQL editor). The apps' reporters keep calling
-- ops_report_error(); once it is gone those calls fail quietly (the reporter swallows its own errors).
select cron.unschedule('ops-error-prune') where exists (select 1 from cron.job where jobname = 'ops-error-prune');
drop function if exists ops_errors(int);
drop function if exists ops_report_error(text, text, text, text, text, text);
drop table if exists ops_error;
delete from _migrations where filename = '0230_ops_errors.sql';
