-- SW Admin's Digest tab (the user, 14 Oct): every post from IT, HR and Marketing, deleted ones
-- included, with who viewed and commented. A deleted post stays as history, marked with who deleted it.
alter table digest_posts add column if not exists deleted_by uuid references employees(id) on delete set null;

CREATE OR REPLACE FUNCTION public.digest_edit_log(p_id uuid)
 RETURNS TABLE(at timestamp with time zone, ecode text, full_name text, desk text, action text, fields text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (digest_can_edit(p_id) or is_sw_admin()) then raise exception 'Only the desks that can edit it'; end if;
  return query
  select l.at, e.ecode, e.full_name, l.desk, l.action, l.fields
  from digest_post_log l left join employees e on e.id = l.employee_id
  where l.post_id = p_id order by l.at desc, l.id desc limit 200;
end $function$;


CREATE OR REPLACE FUNCTION public.digest_post_people(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, department text, function_name text, seen_at timestamp with time zone, opened_at timestamp with time zone, opens integer, liked_at timestamp with time zone, comments integer, joins integer, joined_at timestamp with time zone, voted text, answered_at timestamp with time zone, answers jsonb, watched_seconds integer, video_seconds integer, watched_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from digest_posts where id = p_id and (digest_can_edit(id) or is_sw_admin())) then
    raise exception 'Only whoever posted it';
  end if;
  return query
  select e.ecode, e.full_name, e.department, e.function_name,
         v.seen_at, v.opened_at, coalesce(v.opens, 0),
         l.created_at,
         (select count(*)::int from digest_comments c where c.post_id = p_id and c.employee_id = e.id and c.deleted_at is null),
         (select count(*)::int from digest_joins j where j.post_id = p_id and j.employee_id = e.id),
         (select min(j.clicked_at) from digest_joins j where j.post_id = p_id and j.employee_id = e.id),
         (select string_agg(o.label, ', ' order by o.position) from digest_votes dv join digest_poll_options o on o.id = dv.option_id where dv.post_id = p_id and dv.employee_id = e.id),
         fr.updated_at, fr.answers,
         vw.watched_seconds, vw.duration_seconds, vw.started_at
  from employees e
  left join digest_views v on v.post_id = p_id and v.employee_id = e.id
  left join digest_likes l on l.post_id = p_id and l.employee_id = e.id
  left join digest_form_responses fr on fr.post_id = p_id and fr.employee_id = e.id
  left join digest_video_views vw on vw.post_id = p_id and vw.employee_id = e.id
  where e.is_active and position('_' in e.ecode) = 0
  order by e.full_name;
end $function$;


CREATE OR REPLACE FUNCTION public.digest_remove(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing can remove a post'; end if;
  update digest_posts set deleted_at = now(), deleted_by = current_employee_id() where id = p_id and posted_as = digest_can_post();
  if not found then raise exception 'Only whoever posted it can delete it'; end if;
end $function$;


create or replace function digest_sw_list()
returns table(id uuid, kind text, title text, body text, posted_as text, author text, created_at timestamptz,
  published_at timestamptz, deleted_at timestamptz, deleted_by text, meet_at timestamptz,
  likes int, comments int, opened int, joined int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator'; end if;
  return query
  select p.id, p.kind, p.title, p.body, p.posted_as, e.full_name, p.created_at, p.published_at, p.deleted_at, d.full_name, p.meet_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         (select count(*)::int from digest_views v where v.post_id = p.id and v.opened_at is not null),
         (select count(distinct j.employee_id)::int from digest_joins j where j.post_id = p.id)
  from digest_posts p left join employees e on e.id = p.posted_by left join employees d on d.id = p.deleted_by
  order by p.created_at desc
  limit 1000;
end $$;
revoke all on function digest_sw_list() from public, anon;
grant execute on function digest_sw_list() to authenticated;
