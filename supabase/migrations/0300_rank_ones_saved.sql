-- =====================================================================
-- Cyrix KPI  ·  0300  ·  The Rank 1s list worked out once and kept
--
-- 20 Nov: the database ran out of memory at the morning rush (09:41); the
-- portal home's gold bar worked out every team's Rank 1 on every open (up to
-- 1.5 s each). The user: "ya do that for gold bar". Now the list is worked out
-- once per month and kept; any change that can move it (a scored or finalized
-- KPI, its lines, a person's name, photo, manager, designation or active state)
-- clears the kept copy at once, so the next open works it out again. Drafts do
-- not clear it. The list itself is exactly as 0282.
-- =====================================================================

-- The kept copy: read only through kpi_rank_ones (no row rules give it to anybody).
create table if not exists public.kpi_rank_ones_saved (
  month date primary key,
  rows jsonb not null,
  made_at timestamptz not null default now()
);
alter table public.kpi_rank_ones_saved enable row level security;
revoke all on public.kpi_rank_ones_saved from public, anon, authenticated;

-- 0282's list, unchanged, under its own name.
drop function if exists public.kpi_rank_ones_work(date);
create function public.kpi_rank_ones_work(p_month date)
returns table (manager_name text, manager_ecode text, full_name text, ecode text, designation text, function_name text, period_month date, avatar text)
language sql stable security definer set search_path = public as $$
  with mo as (
    select p_month m
  ), base as (
    select e.reporting_manager_id mgr, e.id, e.ecode, e.full_name, e.designation, e.function_name, e.avatar,
           s.final_total_score sc, s.final_job_role_score js,
           (select i.final_score from kpi_submission_items i where i.submission_id = s.id and i.section = 'job_role'
             order by i.weightage desc, i.sort_order limit 1) kr,
           (select avg(y.final_total_score) from kpi_submissions y where y.employee_id = s.employee_id and y.financial_year = s.financial_year
             and y.status in ('scored', 'finalized') and y.final_total_score is not null) ya
    from kpi_submissions s join employees e on e.id = s.employee_id, mo
    where s.period_month = mo.m and s.status in ('scored', 'finalized') and s.final_total_score is not null
      and e.is_active and e.reporting_manager_id is not null
      and upper(e.ecode) not in ('E6666', 'E7777', 'E8888', 'E9999') and e.full_name not ilike '%- test%'
  ), ranked as (
    select b.*, count(*) over (partition by b.mgr) n,
           row_number() over (partition by b.mgr order by b.sc desc, b.js desc nulls last, b.kr desc nulls last, b.ya desc nulls last, b.full_name) rk
    from base b
  )
  select m.full_name, m.ecode, r.full_name, r.ecode, r.designation, r.function_name::text, (select mo.m from mo), r.avatar
  from ranked r join employees m on m.id = r.mgr
  where r.rk = 1 and r.n > 1
    and r.sc >= 50   -- no Poor Rank 1s (0282)
  order by m.full_name, r.full_name
$$;
revoke all on function public.kpi_rank_ones_work(date) from public, anon, authenticated;

-- What the portal and the Rank 1 message (0281) call: the kept copy, worked out when there is none.
drop function if exists public.kpi_rank_ones(date);
create function public.kpi_rank_ones(p_month date default null)
returns table (manager_name text, manager_ecode text, full_name text, ecode text, designation text, function_name text, period_month date, avatar text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_month date := coalesce(p_month, (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) - interval '1 month')::date);
  v_rows jsonb;
begin
  if not public.portal_rank_ones_on() then return; end if;
  select s.rows into v_rows from kpi_rank_ones_saved s where s.month = v_month;
  if v_rows is null then
    select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into v_rows from kpi_rank_ones_work(v_month) w;
    insert into kpi_rank_ones_saved (month, rows) values (v_month, v_rows)
      on conflict (month) do update set rows = excluded.rows, made_at = now();
  end if;
  return query
    select x.manager_name, x.manager_ecode, x.full_name, x.ecode, x.designation, x.function_name, x.period_month, x.avatar
    from jsonb_to_recordset(v_rows) as x(manager_name text, manager_ecode text, full_name text, ecode text, designation text, function_name text, period_month date, avatar text)
    order by x.manager_name, x.full_name;
end $$;
revoke all on function public.kpi_rank_ones(date) from public, anon;
grant execute on function public.kpi_rank_ones(date) to authenticated;

-- Clearing the kept copy when the list can change.
create or replace function public.kpi_rank_ones_clear_sub() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' and old.status in ('scored', 'finalized') then delete from kpi_rank_ones_saved where month = old.period_month; end if;
  if tg_op <> 'DELETE' and new.status in ('scored', 'finalized') then delete from kpi_rank_ones_saved where month = new.period_month; end if;
  return null;
end $$;
drop trigger if exists kpi_rank_ones_clear on public.kpi_submissions;
create trigger kpi_rank_ones_clear after insert or update or delete on public.kpi_submissions
  for each row execute function public.kpi_rank_ones_clear_sub();

create or replace function public.kpi_rank_ones_clear_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from kpi_rank_ones_saved k using kpi_submissions s
   where s.id = coalesce(new.submission_id, old.submission_id) and s.status in ('scored', 'finalized') and k.month = s.period_month;
  return null;
end $$;
drop trigger if exists kpi_rank_ones_clear on public.kpi_submission_items;
create trigger kpi_rank_ones_clear after insert or update or delete on public.kpi_submission_items
  for each row execute function public.kpi_rank_ones_clear_item();

create or replace function public.kpi_rank_ones_clear_all() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from kpi_rank_ones_saved;
  return null;
end $$;
drop trigger if exists kpi_rank_ones_clear on public.employees;
create trigger kpi_rank_ones_clear after insert or delete or update of full_name, ecode, designation, function_name, avatar, reporting_manager_id, is_active
  on public.employees for each statement execute function public.kpi_rank_ones_clear_all();
