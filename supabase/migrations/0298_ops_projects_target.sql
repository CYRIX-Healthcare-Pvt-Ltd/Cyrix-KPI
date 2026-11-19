-- =====================================================================
-- Cyrix KPI  ·  0298  ·  Projects in the Ops uptime checks
--
-- The Projects module (app_modules 'projects', /projects, Vercel project
-- cyrix-projects) went live 15 Nov 2026 and was never added to
-- ops_target, so the 5-minute ops_round() did not check it. Adrian,
-- 19 Nov: "is workplace, projects modules added to the list?"
--
-- Workplace is also restated here (as 0240 does) so this file is right
-- on its own whether or not 0240 has been applied: the old 'inventory'
-- row keeps its id, so its uptime history stays, with the new name and
-- the cyrix-workplace URL.
-- =====================================================================

insert into ops_target (id, name, grp, url, timeout_ms, sort_order) values
  ('projects', 'Projects', 'Vercel', 'https://cyrix-projects.vercel.app/projects/', 10000, 77)
on conflict (id) do update set url = excluded.url, name = excluded.name, active = true;

update ops_target
   set name = 'Workplace', url = 'https://cyrix-workplace.vercel.app/workplace/'
 where id = 'inventory';

do $$
begin
  if not exists (select 1 from ops_target where id = 'projects' and active) then
    raise exception '0298: projects target missing';
  end if;
end $$;
