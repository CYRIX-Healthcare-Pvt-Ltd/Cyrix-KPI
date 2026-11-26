-- Undo 0237.
select cron.unschedule('ops-pw-scan') where exists (select 1 from cron.job where jobname = 'ops-pw-scan');
drop function if exists ops_security();
drop function if exists ops_pw_scan(int);
drop table if exists ops_pw_check;
