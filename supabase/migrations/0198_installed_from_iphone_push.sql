-- Installs before 0197 were never recorded. An iPhone gets notifications only from the installed
-- app, so every iPhone with a push subscription has it installed (the user, 15 Oct).
insert into public.app_installs (employee_id, platform, first_seen_at, last_seen_at)
select distinct on (employee_id) employee_id, 'iPhone', created_at, coalesce(last_seen_at, created_at)
from public.push_subscriptions
where user_agent ~ '(iPhone|iPad)'
order by employee_id, created_at
on conflict (employee_id) do nothing;
