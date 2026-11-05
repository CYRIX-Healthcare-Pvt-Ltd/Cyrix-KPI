-- =====================================================================
-- Cyrix KPI  ·  0249  ·  Management desk
--
-- The user, 5 Nov: Mohandas N (VP BEMP) is to post to Cyrix Digest, and
-- Marketing would put "Marketing" on his posts. A Management desk, Digest
-- only, like Marketing: posts, replies and notifications say "Management".
-- No role in user_roles and no shared login; SW Admin sets people on it.
-- =====================================================================

-- The desk checks, found by their text (some were created unnamed).
do $$
declare c record;
begin
  for c in select conrelid::regclass::text t, conname from pg_constraint
           where contype = 'c' and pg_get_constraintdef(oid) like '%''mkt''%'
             and conrelid in ('desk_admins'::regclass, 'digest_posts'::regclass, 'push_messages'::regclass) loop
    execute format('alter table %s drop constraint %I', c.t, c.conname);
  end loop;
end $$;
alter table desk_admins add constraint desk_admins_desk_check check (desk in ('hr', 'it', 'mkt', 'mgmt', 'acc', 'travel'));
alter table digest_posts add constraint digest_posts_posted_as_check check (posted_as in ('hr', 'it', 'mkt', 'mgmt'));
alter table digest_posts add constraint digest_posts_editors_check check (editors <@ array['hr', 'it', 'mkt', 'mgmt']);
alter table push_messages add constraint push_messages_sent_as_check check (sent_as in ('hr', 'sw', 'it', 'mkt', 'mgmt'));

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
  end
$$;

create or replace function digest_can_post()
returns text
language sql stable security definer set search_path = public as $$
  select case
    when (select account_type from employees where id = current_employee_id()) = 'admin'
      then case when is_hr_admin() then 'hr' when is_it_admin() then 'it' when is_mkt_admin() then 'mkt' end
    else (select d.desk from desk_admins d
          where d.employee_id = current_employee_id() and 'Digest' = any (d.modules) and d.desk in ('hr', 'it', 'mkt', 'mgmt')
          order by array_position(array['hr', 'it', 'mkt', 'mgmt'], d.desk) limit 1)
  end
$$;

-- Sharing a post with another desk, and the refusals that name the desks.
do $$
declare f text; g text; n text;
begin
  f := pg_get_functiondef('public.digest_set_editors(uuid, text[])'::regprocedure);
  if position($q$where d in ('hr', 'it', 'mkt') and$q$ in f) = 0 then raise exception 'digest_set_editors changed'; end if;
  execute replace(f, $q$where d in ('hr', 'it', 'mkt') and$q$, $q$where d in ('hr', 'it', 'mkt', 'mgmt') and$q$);

  for n in select p.oid::regprocedure::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.prosrc like '%Only HR, IT or Marketing%' loop
    f := pg_get_functiondef(n::regprocedure);
    g := replace(f, 'Only HR, IT or Marketing', 'Only HR, IT, Marketing or Management');
    if g = f then raise exception '% not changed', n; end if;
    execute g;
  end loop;
end $$;
