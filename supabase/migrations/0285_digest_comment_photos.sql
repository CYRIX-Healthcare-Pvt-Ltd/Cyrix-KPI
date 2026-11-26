-- =====================================================================
-- Cyrix KPI  ·  0285  ·  Digest comments carry the writer's profile photo
--
-- The user, 12 Nov: "where is my profile picture" under a comment. The photo
-- is the employee row's own avatar (a small data URL, KPI 0037), so it comes
-- with the comments; no photo shows the initials as before.
-- =====================================================================

drop function if exists public.digest_comments_for(uuid);
create function public.digest_comments_for(p_id uuid)
returns table(id uuid, author text, ecode text, body text, created_at timestamptz, mine boolean,
              reply text, reply_desk text, reply_at timestamptz, can_reply boolean, parent_id uuid, avatar text)
language sql stable security definer set search_path to 'public' as $f$
  select c.id, e.full_name, e.ecode, c.body, c.created_at,
         c.employee_id = current_employee_id() or digest_can_post() is not null,
         c.reply, c.reply_desk, c.reply_at, digest_can_edit(c.post_id), c.parent_id, e.avatar
  from digest_comments c join employees e on e.id = c.employee_id
  where c.post_id = p_id and c.deleted_at is null and current_employee_id() is not null
    -- a reply goes with its comment
    and (c.parent_id is null or exists (select 1 from digest_comments t where t.id = c.parent_id and t.deleted_at is null))
  order by c.created_at
$f$;
revoke all on function public.digest_comments_for(uuid) from public, anon;
grant execute on function public.digest_comments_for(uuid) to authenticated;
