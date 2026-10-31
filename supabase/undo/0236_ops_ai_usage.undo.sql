-- Undo 0236.
select cron.unschedule('ops-ai-prune') where exists (select 1 from cron.job where jobname = 'ops-ai-prune');
drop function if exists ops_ai(int);
drop function if exists ops_ai_cost(text, bigint, bigint, bigint);
drop function if exists ops_report_ai(text, text, text, int, int, int);
drop table if exists ops_ai_usage;
drop table if exists ops_ai_price;
