-- Digest analytics count employees only: test logins out too, not just *_ADMIN (0203; 15 Oct).
CREATE OR REPLACE FUNCTION public.digest_post_people(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, department text, function_name text, seen_at timestamp with time zone, opened_at timestamp with time zone, opens integer, liked_at timestamp with time zone, comments integer, joins integer, joined_at timestamp with time zone, voted text, answered_at timestamp with time zone, answers jsonb, watched_seconds integer, video_seconds integer, watched_at timestamp with time zone, last_opened timestamp with time zone)
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
         vw.watched_seconds, vw.duration_seconds, vw.started_at, v.last_opened
  from employees e
  left join digest_views v on v.post_id = p_id and v.employee_id = e.id
  left join digest_likes l on l.post_id = p_id and l.employee_id = e.id
  left join digest_form_responses fr on fr.post_id = p_id and fr.employee_id = e.id
  left join digest_video_views vw on vw.post_id = p_id and vw.employee_id = e.id
  where e.is_active and e.account_type = 'employee'
  order by e.full_name;
end $function$;

