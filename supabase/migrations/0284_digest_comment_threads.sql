-- =====================================================================
-- Cyrix KPI  ·  0284  ·  Anyone can reply to a Digest comment
--
-- The user, 12 Nov: "we need reply option for all comments, anyone can
-- reply". A reply is a comment with parent_id set to the comment it answers;
-- one level deep (a reply to a reply joins the same thread). The desk's own
-- reply (0202) stays as it is.
-- =====================================================================

alter table digest_comments add column if not exists parent_id uuid references digest_comments(id) on delete cascade;
create index if not exists digest_comments_parent on digest_comments(parent_id);

drop function if exists public.digest_add_comment(uuid, text);
create or replace function public.digest_add_comment(p_id uuid, p_body text, p_parent uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); v uuid; top uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from digest_posts where id = p_id and deleted_at is null) then raise exception 'That post is not there any more'; end if;
  if p_parent is not null then
    select coalesce(c.parent_id, c.id) into top from digest_comments c where c.id = p_parent and c.post_id = p_id and c.deleted_at is null;
    if top is null then raise exception 'That comment is not there any more'; end if;
  end if;
  insert into digest_comments (post_id, employee_id, body, parent_id) values (p_id, me, btrim(p_body), top) returning id into v;
  return v;
end $$;
revoke all on function public.digest_add_comment(uuid, text, uuid) from public, anon;
grant execute on function public.digest_add_comment(uuid, text, uuid) to authenticated;

drop function if exists public.digest_comments_for(uuid);
create function public.digest_comments_for(p_id uuid)
returns table(id uuid, author text, ecode text, body text, created_at timestamptz, mine boolean,
              reply text, reply_desk text, reply_at timestamptz, can_reply boolean, parent_id uuid)
language sql stable security definer set search_path to 'public' as $f$
  select c.id, e.full_name, e.ecode, c.body, c.created_at,
         c.employee_id = current_employee_id() or digest_can_post() is not null,
         c.reply, c.reply_desk, c.reply_at, digest_can_edit(c.post_id), c.parent_id
  from digest_comments c join employees e on e.id = c.employee_id
  where c.post_id = p_id and c.deleted_at is null and current_employee_id() is not null
    -- a reply goes with its comment
    and (c.parent_id is null or exists (select 1 from digest_comments t where t.id = c.parent_id and t.deleted_at is null))
  order by c.created_at
$f$;
revoke all on function public.digest_comments_for(uuid) from public, anon;
grant execute on function public.digest_comments_for(uuid) to authenticated;
