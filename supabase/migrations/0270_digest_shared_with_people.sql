/*
  0270 — A Cyrix Digest post belongs to the person who posted it, and is shared with people, not desks (the user,
  9 Nov: "tincy posted it but anyone can management edit it?" … "ya change desk to person"; the screen shows the people
  who can post grouped by desk, "first dept and then person").

  A person already could edit only their own posts (digest_mine): what changes is sharing. The poster ticks people —
  anyone who can post on the Digest, from any desk — and they can edit and publish it; deleting and sharing stay the
  poster's. The shared desk logins keep sharing with desks as before.
*/
alter table digest_posts add column if not exists editor_ids uuid[] not null default '{}';

-- Who may edit: the poster, or a person it is shared with; a desk login, its desk or a desk it is shared with.
create or replace function public.digest_mine(p_posted_by uuid, p_posted_as text, p_editors text[], p_editor_ids uuid[])
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select case
    when digest_can_post() is null then false
    when (select account_type from employees where id = current_employee_id()) = 'admin'
      then p_posted_as = digest_can_post() or digest_can_post() = any (coalesce(p_editors, '{}'))
    else p_posted_by = current_employee_id() or current_employee_id() = any (coalesce(p_editor_ids, '{}'))
  end
$f$;
revoke all on function public.digest_mine(uuid, text, text[], uuid[]) from public, anon;
grant execute on function public.digest_mine(uuid, text, text[], uuid[]) to authenticated;

create or replace function public.digest_can_edit(p_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from digest_posts p
                 where p.id = p_id and p.deleted_at is null
                   and digest_mine(p.posted_by, p.posted_as, p.editors, p.editor_ids))
$f$;

-- The people who can post on the Digest, by desk, and whether this post is shared with each (the poster left out).
create or replace function public.digest_editor_people(p_id uuid)
returns table (employee_id uuid, ecode text, full_name text, desk text, ticked boolean)
language plpgsql stable security definer set search_path to 'public' as $f$
declare p digest_posts;
begin
  select * into p from digest_posts where id = p_id and deleted_at is null;
  if not found or not (digest_mine(p.posted_by, p.posted_as, '{}', '{}') or digest_can_edit(p_id) or is_sw_admin()) then
    raise exception 'Only whoever posted it can share it';
  end if;
  return query
  select distinct on (e.id) e.id, e.ecode, e.full_name, d.desk, e.id = any (p.editor_ids)
  from desk_admins d join employees e on e.id = d.employee_id
  where 'Digest' = any (d.modules) and d.desk in ('hr', 'it', 'mkt', 'mgmt') and e.is_active
    and e.id is distinct from p.posted_by and coalesce(e.account_type, '') <> 'admin'
    and (e.ecode not in ('E6666', 'E7777', 'E8888', 'E9999') or e.id = any (p.editor_ids))
  order by e.id, array_position(array['mgmt', 'hr', 'it', 'mkt'], d.desk);
end $f$;
revoke all on function public.digest_editor_people(uuid) from public, anon;
grant execute on function public.digest_editor_people(uuid) to authenticated;

-- The poster shares it with people: only people who can post on the Digest, never the poster.
create or replace function public.digest_set_editor_people(p_id uuid, p_people uuid[])
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  update digest_posts p
  set editor_ids = (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_people, '{}')) x
                    where x is distinct from p.posted_by
                      and exists (select 1 from desk_admins d where d.employee_id = x and 'Digest' = any (d.modules)))
  where p.id = p_id and p.deleted_at is null and digest_mine(p.posted_by, p.posted_as, '{}', '{}');
  if not found then raise exception 'Only whoever posted it can share it'; end if;
end $f$;
revoke all on function public.digest_set_editor_people(uuid, uuid[]) from public, anon;
grant execute on function public.digest_set_editor_people(uuid, uuid[]) to authenticated;

-- The list: posts shared with a person too; "editors" carries the desks and then the people's names.
CREATE OR REPLACE FUNCTION public.digest_admin_list()
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, comments integer, joined integer, clicks integer, mine boolean, vac_location text, apply_by date, apply_link text, show_until date, published_at timestamp with time zone, can_edit boolean, editors text[], opened integer, join_early integer, video_id text, pdf_url text, pdf_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare desk text := digest_can_post();
begin
  if desk is null then raise exception 'Only HR, IT, Marketing or Management'; end if;
  return query
  select p.id, p.kind, p.title, p.body, p.image_url, p.color, p.meet_at, p.meet_minutes, p.meet_link, p.meet_place,
         p.posted_as, e.full_name, p.created_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         (select count(distinct j.employee_id)::int from digest_joins j where j.post_id = p.id),
         (select count(*)::int from digest_joins j where j.post_id = p.id),
         digest_mine(p.posted_by, p.posted_as, '{}'),
         p.vac_location, p.apply_by, p.apply_link, case when p.kind = 'meeting' then (p.meet_at at time zone 'Asia/Kolkata')::date
              else digest_last_day(p.kind, p.show_until, p.apply_by, p.closes_at) end,
         p.published_at,
         true, p.editors || coalesce((select array_agg(x.full_name order by x.full_name) from employees x where x.id = any (p.editor_ids)), '{}'),
         (select count(*)::int from digest_views v where v.post_id = p.id and v.opened_at is not null),
         p.join_early, p.video_id,
         p.pdf_url, p.pdf_name
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and digest_mine(p.posted_by, p.posted_as, p.editors, p.editor_ids)
  order by p.created_at desc
  limit 500;
end $function$;

-- The history names the people a post is shared with.
CREATE OR REPLACE FUNCTION public.digest_posts_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare changed text[];
begin
  if tg_op = 'INSERT' then
    perform digest_log(new.id, 'created', '{}');
    return new;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    perform digest_log(new.id, 'deleted', '{}'); return new;
  end if;
  if old.published_at is null and new.published_at is not null and old.created_at < now() - interval '5 seconds' then
    perform digest_log(new.id, 'published', '{}');
  elsif old.published_at is not null and new.published_at is null and old.created_at < now() - interval '5 seconds' then
    perform digest_log(new.id, 'drafted', '{}');
  end if;
  if new.editors is distinct from old.editors then
    perform digest_log(new.id, 'access', new.editors);
  end if;
  -- The people it is shared with (0270): their names, as the history reads them.
  if new.editor_ids is distinct from old.editor_ids then
    perform digest_log(new.id, 'access', coalesce((select array_agg(x.full_name || ' (' || x.ecode || ')' order by x.full_name)
                                                   from employees x where x.id = any (new.editor_ids)), '{}'));
  end if;
  select coalesce(array_agg(k order by k), '{}') into changed
  from jsonb_each(to_jsonb(new)) n(k, v)
  where k not in ('id', 'published_at', 'deleted_at', 'editors', 'editor_ids', 'created_at', 'updated_at', 'posted_by', 'posted_as')
    and (to_jsonb(old) -> k) is distinct from v;
  if cardinality(changed) > 0 then perform digest_log(new.id, 'edited', changed); end if;
  return new;
end $function$;
