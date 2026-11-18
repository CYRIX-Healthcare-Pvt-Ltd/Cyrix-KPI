-- =====================================================================
-- Cyrix KPI  ·  0297  ·  Software admin desk (Digest)
--
-- The user, 18 Nov: SW Admin → Admins gets one more desk, "Software admin",
-- to post to Cyrix Digest under that tag ("swadmin cant post from sw admin
-- id"). Digest only, like Management: no role in user_roles.
-- =====================================================================

do $$
declare c record;
begin
  for c in select conrelid::regclass::text t, conname from pg_constraint
           where contype = 'c' and pg_get_constraintdef(oid) like '%''mgmt''%'
             and conrelid in ('desk_admins'::regclass, 'digest_posts'::regclass) loop
    execute format('alter table %s drop constraint %I', c.t, c.conname);
  end loop;
end $$;
alter table desk_admins add constraint desk_admins_desk_check check (desk in ('hr', 'it', 'mkt', 'mgmt', 'acc', 'travel', 'sw'));
alter table digest_posts add constraint digest_posts_posted_as_check check (posted_as in ('hr', 'it', 'mkt', 'mgmt', 'sw'));
alter table digest_posts add constraint digest_posts_editors_check check (editors <@ array['hr', 'it', 'mkt', 'mgmt', 'sw']);

create or replace function desk_modules(p_desk text)
returns text[]
language sql immutable as $$
  select case p_desk
    when 'hr' then array['KPI', 'Digest']
    when 'it' then array['Logins', 'Support', 'Digest']
    when 'mkt' then array['Digest']
    when 'mgmt' then array['Digest']
    when 'acc' then array['Travel Expense']
    when 'travel' then array['Travel Expense']
    when 'sw' then array['Digest']
  end
$$;

-- Undo the first try of this morning, when 'sw' gave sw_admin.
create or replace function desk_role(p_desk text, p_modules text[])
returns text
language sql immutable as $$
  select case
    when p_desk = 'hr' and 'KPI' = any (p_modules) then 'hr_admin'
    when p_desk = 'it' and (p_modules && array['Logins', 'Support']) then 'it_admin'
    when p_desk = 'acc' then 'acc_admin'
    when p_desk = 'travel' then 'travel_desk'
  end
$$;

create or replace function digest_can_post()
returns text
language sql stable security definer set search_path = public as $$
  select case
    when (select account_type from employees where id = current_employee_id()) = 'admin'
      then case when is_hr_admin() then 'hr' when is_it_admin() then 'it' when is_mkt_admin() then 'mkt' end
    else (select d.desk from desk_admins d
          where d.employee_id = current_employee_id() and 'Digest' = any (d.modules) and d.desk in ('hr', 'it', 'mkt', 'mgmt', 'sw')
          order by array_position(array['hr', 'it', 'mkt', 'mgmt', 'sw'], d.desk) limit 1)
  end
$$;

do $$
declare f text; g text; n text;
begin
  f := pg_get_functiondef('public.digest_set_editors(uuid, text[])'::regprocedure);
  if position($q$where d in ('hr', 'it', 'mkt', 'mgmt') and$q$ in f) = 0 then raise exception 'digest_set_editors changed'; end if;
  execute replace(f, $q$where d in ('hr', 'it', 'mkt', 'mgmt') and$q$, $q$where d in ('hr', 'it', 'mkt', 'mgmt', 'sw') and$q$);

  for n in select p.oid::regprocedure::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.prosrc like '%Only HR, IT, Marketing or Management%' loop
    f := pg_get_functiondef(n::regprocedure);
    execute replace(f, 'Only HR, IT, Marketing or Management', 'Only HR, IT, Marketing, Management or Software admin');
  end loop;
end $$;

-- Any other function that lists the Digest desks by name.
select string_agg(p.proname, ', ') left_over from pg_proc p join pg_namespace s on s.oid = p.pronamespace
where s.nspname = 'public' and p.prosrc like '%''mkt'', ''mgmt''%' and p.prosrc not like '%''sw''%';

do $$
declare f text; g text;
begin
  f := pg_get_functiondef('public.digest_editor_people'::regproc);
  g := replace(replace(f, $q$d.desk in ('hr', 'it', 'mkt', 'mgmt')$q$, $q$d.desk in ('hr', 'it', 'mkt', 'mgmt', 'sw')$q$),
               $q$array['mgmt', 'hr', 'it', 'mkt']$q$, $q$array['mgmt', 'hr', 'it', 'mkt', 'sw']$q$);
  if g = f then raise exception 'digest_editor_people changed'; end if;
  execute g;
end $$;
