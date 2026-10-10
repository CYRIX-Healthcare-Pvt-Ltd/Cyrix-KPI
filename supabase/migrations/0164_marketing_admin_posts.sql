-- =====================================================================
-- Cyrix KPI  ·  0164  ·  MRK_ADMIN: Marketing posts to Cyrix Digest
--
-- The user, 10 Oct: "we need marketing admin also ie MRK_ADMIN, he only
-- needs a tab to post things; when Marketing posts it should show posted
-- by Marketing — HR, IT". Made as IT_ADMIN was (0151): the record and its
-- role here, with no login; SW_ADMIN creates the login from its record.
-- KPI only, and in KPI only the Digest tab.
-- =====================================================================

alter table public.user_roles drop constraint user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role = any (array['hr_admin', 'super_admin', 'sw_admin', 'it_admin', 'mkt_admin']));

create or replace function public.is_mkt_admin()
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from user_roles where employee_id = current_employee_id() and role = 'mkt_admin')
$f$;
revoke execute on function public.is_mkt_admin() from public, anon;
grant execute on function public.is_mkt_admin() to authenticated;

insert into public.employees (ecode, full_name, designation, department, is_active, must_change_password)
values ('MRK_ADMIN', 'Marketing', 'Marketing Administrator', 'Marketing', true, true)
on conflict (ecode) do nothing;
insert into public.user_roles (employee_id, role)
select id, 'mkt_admin' from public.employees where ecode = 'MRK_ADMIN'
on conflict do nothing;
delete from public.employee_modules
 where employee_id = (select id from public.employees where ecode = 'MRK_ADMIN') and module_code <> 'kpi';
insert into public.employee_modules (employee_id, module_code)
select id, 'kpi' from public.employees where ecode = 'MRK_ADMIN'
on conflict do nothing;

-- Posts and their notifications carry who posted: HR, IT or Marketing.
alter table public.digest_posts drop constraint if exists digest_posts_posted_as_check;
alter table public.digest_posts add constraint digest_posts_posted_as_check check (posted_as in ('hr', 'it', 'mkt'));
alter table public.push_messages drop constraint if exists push_messages_sent_as_check;
alter table public.push_messages add constraint push_messages_sent_as_check check (sent_as in ('hr', 'sw', 'it', 'mkt'));

create or replace function public.digest_can_post()
returns text
language sql stable security definer set search_path = public as $$
  select case when is_hr_admin() then 'hr' when is_it_admin() then 'it' when is_mkt_admin() then 'mkt' end
$$;

drop policy if exists digest_upload on storage.objects;
create policy digest_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'digest' and public.digest_can_post() is not null);
drop policy if exists digest_remove on storage.objects;
create policy digest_remove on storage.objects for delete to authenticated
  using (bucket_id = 'digest' and public.digest_can_post() is not null);

-- The messages name all three who may post.
CREATE OR REPLACE FUNCTION public.digest_save(p_id uuid, p_kind text, p_title text, p_body text, p_image_url text, p_color text, p_meet_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_meet_minutes integer DEFAULT NULL::integer, p_meet_link text DEFAULT NULL::text, p_meet_place text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  desk text := digest_can_post();
  v    uuid;
begin
  if desk is null then raise exception 'Only HR, IT or Marketing can post to Cyrix Digest'; end if;
  if p_kind = 'meeting' and (p_meet_at is null or coalesce(p_meet_link, '') !~ '^https://') then
    raise exception 'A meeting needs a date and time, and a link starting with https://';
  end if;
  if p_id is null then
    insert into digest_posts (kind, title, body, image_url, color, meet_at, meet_minutes, meet_link, meet_place, posted_by, posted_as)
    values (p_kind, btrim(p_title), coalesce(p_body, ''), nullif(p_image_url, ''), coalesce(p_color, 'red'),
            case when p_kind = 'meeting' then p_meet_at end, case when p_kind = 'meeting' then p_meet_minutes end,
            case when p_kind = 'meeting' then btrim(p_meet_link) end, case when p_kind = 'meeting' then nullif(btrim(p_meet_place), '') end,
            current_employee_id(), desk)
    returning id into v;
  else
    update digest_posts set kind = p_kind, title = btrim(p_title), body = coalesce(p_body, ''),
      image_url = nullif(p_image_url, ''), color = coalesce(p_color, 'red'),
      meet_at = case when p_kind = 'meeting' then p_meet_at end,
      meet_minutes = case when p_kind = 'meeting' then p_meet_minutes end,
      meet_link = case when p_kind = 'meeting' then btrim(p_meet_link) end,
      meet_place = case when p_kind = 'meeting' then nullif(btrim(p_meet_place), '') end,
      updated_at = now()
    where id = p_id and deleted_at is null
    returning id into v;
    if v is null then raise exception 'That post is not there any more'; end if;
  end if;
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION public.digest_remove(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing can remove a post'; end if;
  update digest_posts set deleted_at = now() where id = p_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.digest_admin_list()
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, comments integer, joined integer, clicks integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing'; end if;
  return query
  select p.id, p.kind, p.title, p.body, p.image_url, p.color, p.meet_at, p.meet_minutes, p.meet_link, p.meet_place,
         p.posted_as, e.full_name, p.created_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         (select count(distinct j.employee_id)::int from digest_joins j where j.post_id = p.id),
         (select count(*)::int from digest_joins j where j.post_id = p.id)
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null
  order by p.created_at desc
  limit 100;
end $function$
;

CREATE OR REPLACE FUNCTION public.digest_join_report(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, department text, clicks integer, first_at timestamp with time zone, last_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing'; end if;
  return query
  select e.ecode, e.full_name, e.department, count(*)::int, min(j.clicked_at), max(j.clicked_at)
  from digest_joins j join employees e on e.id = j.employee_id
  where j.post_id = p_id
  group by e.ecode, e.full_name, e.department
  order by min(j.clicked_at);
end $function$
;

CREATE OR REPLACE FUNCTION public.digest_likers(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing'; end if;
  return query
  select e.ecode, e.full_name, l.created_at from digest_likes l join employees e on e.id = l.employee_id
  where l.post_id = p_id order by l.created_at;
end $function$
;

