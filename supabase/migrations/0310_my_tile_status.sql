-- =====================================================================
-- Cyrix KPI  ·  0310  ·  What each portal tile has to say (the user, 25 Nov)
--
-- One call when app.cyrix.in opens, never on a timer. One row per module
-- the caller is given that has something to show:
--
--   n / label  how much is waiting on them there
--                kpi:   KPI's own action lines from the bell (approvals,
--                       scoring, score queries, record requests, a plan sent
--                       back, a month returned; HR's leavers and records)
--                tasks: open My Task items due today or late, once released
--   is_new     HR gave them this module in the last 7 days
--   down       the module's own uptime check (Ops, 0229) failed its last two
--              runs, the newest within 15 minutes. Two, not one, so a single
--              slow answer does not paint a tile red.
--
-- Security definer and keyed on current_employee_id(), so a caller only ever
-- sees their own counts. bell_notifications_all stays ungranted; it is
-- called here for one id, the caller's.
-- =====================================================================

create or replace function public.my_tile_status()
returns table (code text, n integer, label text, is_new boolean, down boolean)
language sql stable security definer set search_path = public as $$
  with me as (select current_employee_id() as id),
  mods as (
    select em.module_code as code, em.granted_at
    from employee_modules em join app_modules m on m.code = em.module_code and m.is_active
    where em.employee_id = (select id from me)
  ),
  kpi as (
    select sum(b.n)::int as n
    from bell_notifications_all(array[(select id from me)]) b
    where b.kind in ('approvals', 'scoring', 'score_query', 'records_manager', 'records_hr', 'leavers',
                     'kpi_rejected', 'month_returned')
  ),
  tasks as (
    select count(*)::int as n
    from task_items t
    where t.employee_id = (select id from me)
      and t.status = 'open'
      and t.due_on <= (now() at time zone 'Asia/Kolkata')::date
      and (t.release_on is null or ((t.release_on + time '09:00') at time zone 'Asia/Kolkata') <= now())
  ),
  -- The Ops target behind each module, where its id differs from the module code.
  target as (
    select c.code, coalesce(x.target, c.code) as target_id
    from mods c
    left join (values ('workplace', 'inventory')) as x(code, target) on x.code = c.code
  ),
  last2 as (
    select t.code, k.ok, k.at, row_number() over (partition by t.code order by k.at desc) as rn
    from target t
    join lateral (select ok, at from ops_check c where c.target_id = t.target_id order by at desc limit 2) k on true
  ),
  health as (
    select code, bool_and(not ok) and max(at) > now() - interval '15 minutes' as down
    from last2 group by code having count(*) = 2
  )
  select c.code,
         case c.code when 'kpi' then nullif((select n from kpi), 0)
                     when 'tasks' then nullif((select n from tasks), 0) end as n,
         case c.code when 'kpi' then 'waiting on you'
                     when 'tasks' then 'due today or late' end as label,
         c.granted_at > now() - interval '7 days' as is_new,
         coalesce(h.down, false) as down
  from mods c left join health h on h.code = c.code
$$;

revoke all on function public.my_tile_status() from public, anon;
grant execute on function public.my_tile_status() to authenticated;

comment on function public.my_tile_status() is
  'Portal tiles (0310): per module the caller holds, how much waits on them, whether it is new to them, and whether it is down.';
