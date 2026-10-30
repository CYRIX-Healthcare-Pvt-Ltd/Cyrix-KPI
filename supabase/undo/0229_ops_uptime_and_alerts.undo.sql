-- Undo 0229: stop the Ops checks and alerts. Run as postgres (SQL editor).
select cron.unschedule('ops-round') where exists (select 1 from cron.job where jobname = 'ops-round');
drop function if exists ops_uptime(int);
drop function if exists ops_round();
drop function if exists ops_alert(text, text, text);
drop table if exists ops_incident, ops_pending, ops_check, ops_target;
-- Alerts already sent stay in the bell history; the kind check keeps allowing 'ops' so those rows remain valid.
delete from _migrations where filename = '0229_ops_uptime_and_alerts.sql';
