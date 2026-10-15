-- The posting desk replies to a comment (the user, 15 Oct: "Sometimes link not open, please provide
-- meeting ID and password"). One reply per comment, shown under it with the desk's name; editable,
-- and cleared by saving it empty. Only a desk that can edit the post may reply.
alter table digest_comments add column if not exists reply text;
alter table digest_comments add column if not exists reply_desk text;
alter table digest_comments add column if not exists reply_by uuid references employees(id) on delete set null;
alter table digest_comments add column if not exists reply_at timestamptz;

create or replace function public.digest_reply_comment(p_comment uuid, p_body text)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare c record; desk text := digest_can_post();
begin
  select dc.id, dc.post_id, dc.employee_id into c from digest_comments dc where dc.id = p_comment and dc.deleted_at is null;
  if not found then raise exception 'That comment is not there any more'; end if;
  if not digest_can_edit(c.post_id) then raise exception 'Only a desk that can edit the post may reply'; end if;
  update digest_comments set
    reply = nullif(btrim(coalesce(p_body, '')), ''),
    reply_desk = case when nullif(btrim(coalesce(p_body, '')), '') is null then null else desk end,
    reply_by = case when nullif(btrim(coalesce(p_body, '')), '') is null then null else current_employee_id() end,
    reply_at = case when nullif(btrim(coalesce(p_body, '')), '') is null then null else now() end
  where id = p_comment;
  return c.employee_id;
end $f$;
revoke all on function public.digest_reply_comment(uuid, text) from public, anon;
grant execute on function public.digest_reply_comment(uuid, text) to authenticated;

drop function if exists public.digest_comments_for(uuid);
create function public.digest_comments_for(p_id uuid)
returns table(id uuid, author text, ecode text, body text, created_at timestamptz, mine boolean,
              reply text, reply_desk text, reply_at timestamptz, can_reply boolean)
language sql stable security definer set search_path to 'public' as $f$
  select c.id, e.full_name, e.ecode, c.body, c.created_at,
         c.employee_id = current_employee_id() or digest_can_post() is not null,
         c.reply, c.reply_desk, c.reply_at, digest_can_edit(c.post_id)
  from digest_comments c join employees e on e.id = c.employee_id
  where c.post_id = p_id and c.deleted_at is null and current_employee_id() is not null
  order by c.created_at
$f$;
revoke all on function public.digest_comments_for(uuid) from public, anon;
grant execute on function public.digest_comments_for(uuid) to authenticated;
