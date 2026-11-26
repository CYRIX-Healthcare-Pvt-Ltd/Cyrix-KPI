-- =====================================================================
-- Cyrix KPI  ·  0299  ·  SW Admin approves Digest posts and notifications
--
-- The user, 19 Nov (Joy sir): "for all posts, whoever posts something,
-- before posting, they need to take sw admin approval ... same all edit
-- access like user haves, and notification also need approval".
--   · A post's first publishing waits for SW Admin (approval = 'pending');
--     edits of a post already live do not (the user's answer).
--   · SW Admin can change a waiting post as its poster can, approve it, or
--     send it back with a reason (approval = 'returned'; the poster's bell).
--   · A notification typed by a desk (Send notification, or a post's
--     notification sent again) waits in push_requests the same way.
--   · SW Admin's own posts and notifications go straight out; the SW_ADMIN
--     login posts to the Digest as "Software admin".
-- =====================================================================

alter table digest_posts add column if not exists approval text check (approval in ('pending', 'returned'));
alter table digest_posts add column if not exists approval_note text;
alter table digest_posts add column if not exists approval_at timestamptz;
alter table digest_posts add column if not exists approval_by uuid references employees (id) on delete set null;

-- The SW_ADMIN login posts as Software admin.
create or replace function digest_can_post()
returns text
language sql stable security definer set search_path = public as $$
  select case
    when (select account_type from employees where id = current_employee_id()) = 'admin'
      then case when is_hr_admin() then 'hr' when is_it_admin() then 'it' when is_mkt_admin() then 'mkt' when is_sw_admin() then 'sw' end
    else (select d.desk from desk_admins d
          where d.employee_id = current_employee_id() and 'Digest' = any (d.modules) and d.desk in ('hr', 'it', 'mkt', 'mgmt', 'sw')
          order by array_position(array['hr', 'it', 'mkt', 'mgmt', 'sw'], d.desk) limit 1)
  end
$$;

-- SW Admin edits a post waiting for approval as its poster can.
create or replace function digest_can_edit(p_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from digest_posts p
                 where p.id = p_id and p.deleted_at is null
                   and (digest_mine(p.posted_by, p.posted_as, p.editors, p.editor_ids)
                        or (p.approval = 'pending' and is_sw_admin())))
$$;

-- A small message into one person's bell.
create or replace function digest_bell(p_to uuid, p_title text, p_body text, p_post uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  if p_to is null then return; end if;
  insert into push_messages (kind, title, body, url, target, sent_by, sent_as)
  values ('manual', left(p_title, 80), left(coalesce(p_body, ''), 400), '/kpi/digest', jsonb_build_object('kind', 'digest', 'post', p_post), current_employee_id(), 'sw')
  returning id into m;
  insert into push_inbox (message_id, employee_id) values (m, p_to);
end $$;
revoke all on function digest_bell(uuid, text, text, uuid) from public, anon, authenticated;

-- Publishing: the first time, from anyone but SW Admin, it waits.
create or replace function digest_set_published(p_id uuid, p_published boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare first_time boolean;
begin
  select p_published and published_at is null into first_time
  from digest_posts where id = p_id and deleted_at is null and digest_can_edit(id);
  if not found then raise exception 'Only whoever posted it can publish it'; end if;
  if first_time and not is_sw_admin() then
    update digest_posts set approval = 'pending', approval_note = null, approval_at = now(), approval_by = null where id = p_id;
    return;
  end if;
  -- The first publishing (0260): what the test left is cleared before anybody else sees it.
  if first_time then perform digest_clear_test(p_id); end if;
  -- SW Admin publishing a post that waited for it: the poster is told, as on Approve.
  if first_time and exists (select 1 from digest_posts where id = p_id and approval = 'pending') then
    perform digest_bell((select posted_by from digest_posts where id = p_id), 'Approved · ' || (select title from digest_posts where id = p_id),
                        'SW Admin approved it. It is on Cyrix Digest now.', p_id);
  end if;
  update digest_posts
  set published_at = case when p_published then coalesce(published_at, now()) end,
      testers = case when p_published then '{}' else testers end,
      approval = case when p_published then null else approval end,
      approval_by = case when first_time then current_employee_id() else approval_by end,
      approval_at = case when first_time then now() else approval_at end
  where id = p_id;
end $$;

create or replace function digest_approve(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare p digest_posts;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin approves'; end if;
  select * into p from digest_posts where id = p_id and deleted_at is null;
  if p.id is null or p.approval is distinct from 'pending' then raise exception 'It is not waiting for approval'; end if;
  perform digest_clear_test(p_id);
  update digest_posts set published_at = now(), testers = '{}', approval = null, approval_note = null,
    approval_at = now(), approval_by = current_employee_id()
  where id = p_id;
  perform digest_bell(p.posted_by, 'Approved · ' || p.title, 'SW Admin approved it. It is on Cyrix Digest now.', p_id);
  perform log_audit('digest_post', p_id, 'approved', '{}'::jsonb);
end $$;

create or replace function digest_send_back(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare p digest_posts;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sends back'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Type the reason'; end if;
  select * into p from digest_posts where id = p_id and deleted_at is null;
  if p.id is null or p.approval is distinct from 'pending' then raise exception 'It is not waiting for approval'; end if;
  update digest_posts set approval = 'returned', approval_note = btrim(p_reason), approval_at = now(), approval_by = current_employee_id()
  where id = p_id;
  perform digest_bell(p.posted_by, 'Sent back · ' || p.title, btrim(p_reason), p_id);
  perform log_audit('digest_post', p_id, 'sent back', jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- The poster's list carries the approval; SW Admin's also the posts waiting.
drop function if exists digest_admin_list();
create function digest_admin_list()
returns table (id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamptz, meet_minutes integer,
  meet_link text, meet_place text, posted_as text, author text, created_at timestamptz, likes integer, comments integer, joined integer,
  clicks integer, mine boolean, vac_location text, apply_by date, apply_link text, show_until date, published_at timestamptz,
  can_edit boolean, editors text[], opened integer, join_early integer, video_id text, pdf_url text, pdf_name text,
  approval text, approval_note text)
language plpgsql stable security definer set search_path = public as $$
declare desk text := digest_can_post();
begin
  if desk is null then raise exception 'Only HR, IT, Marketing, Management or Software admin'; end if;
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
         p.pdf_url, p.pdf_name,
         p.approval, p.approval_note
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and (digest_mine(p.posted_by, p.posted_as, p.editors, p.editor_ids) or (p.approval = 'pending' and is_sw_admin()))
  order by (p.approval = 'pending') desc nulls last, p.created_at desc
  limit 500;
end $$;
revoke all on function digest_admin_list() from public, anon;
grant execute on function digest_admin_list() to authenticated;

drop function if exists digest_sw_list();
create function digest_sw_list()
returns table (id uuid, kind text, title text, body text, posted_as text, author text, created_at timestamptz, published_at timestamptz,
  deleted_at timestamptz, deleted_by text, meet_at timestamptz, likes integer, comments integer, opened integer, joined integer, ended boolean,
  approval text, approval_note text, approval_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator'; end if;
  return query
  select p.id, p.kind, p.title, p.body, p.posted_as, e.full_name, p.created_at, p.published_at, p.deleted_at, d.full_name, p.meet_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         (select count(*)::int from digest_views v where v.post_id = p.id and v.opened_at is not null),
         (select count(distinct j.employee_id)::int from digest_joins j where j.post_id = p.id),
         digest_ended(p.kind, p.meet_at, p.meet_minutes, p.show_until, p.apply_by, p.closes_at),
         p.approval, p.approval_note, p.approval_at
  from digest_posts p left join employees e on e.id = p.posted_by left join employees d on d.id = p.deleted_by
  order by p.created_at desc
  limit 1000;
end $$;
revoke all on function digest_sw_list() from public, anon;
grant execute on function digest_sw_list() to authenticated;

-- ---------------------------------------------------------------------
-- Notifications typed by a desk wait here until SW Admin sends them.

create table if not exists push_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('send', 'digest')),
  sent_as text not null,
  payload jsonb not null,
  title text not null,
  body text not null default '',
  people integer,
  asked_by uuid references employees (id) on delete set null,
  asked_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'returned')),
  note text,
  decided_by uuid references employees (id) on delete set null,
  decided_at timestamptz
);
alter table push_requests enable row level security;
revoke all on push_requests from anon, authenticated;

create or replace function push_ask(p_kind text, p_as text, p_payload jsonb, p_title text, p_body text, p_people integer default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if p_kind = 'send' and not push_desk_ok(p_as) then raise exception 'Only HR Admin can send from here'; end if;
  if p_kind = 'digest' and not digest_can_edit((p_payload ->> 'post_id')::uuid) then raise exception 'Only a desk that can edit it'; end if;
  if p_kind not in ('send', 'digest') then raise exception 'Not allowed'; end if;
  insert into push_requests (kind, sent_as, payload, title, body, people, asked_by)
  values (p_kind, p_as, p_payload, left(btrim(p_title), 120), left(coalesce(p_body, ''), 400), p_people, current_employee_id())
  returning id into v;
  return v;
end $$;

create or replace function push_request_list()
returns table (id uuid, kind text, sent_as text, payload jsonb, title text, body text, people integer, asked_by text, asked_at timestamptz,
  status text, note text, decided_by text, decided_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator'; end if;
  return query
  select r.id, r.kind, r.sent_as, r.payload, r.title, r.body, r.people,
         case when a.id is null then null else a.full_name || ' (' || a.ecode || ')' end, r.asked_at,
         r.status, r.note, case when b.id is null then null else b.full_name || ' (' || b.ecode || ')' end, r.decided_at
  from push_requests r left join employees a on a.id = r.asked_by left join employees b on b.id = r.decided_by
  order by (r.status = 'pending') desc, r.asked_at desc
  limit 300;
end $$;

-- The desk's own, to see what is waiting or sent back.
create or replace function push_my_requests()
returns table (id uuid, kind text, title text, body text, asked_at timestamptz, status text, note text)
language sql stable security definer set search_path = public as $$
  select r.id, r.kind, r.title, r.body, r.asked_at, r.status, r.note from push_requests r
  where r.asked_by = current_employee_id() and r.status <> 'sent'
  order by r.asked_at desc limit 50
$$;

-- Sent back with a reason; sending is done by the push function, which marks it sent.
create or replace function push_request_send_back(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare r push_requests;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sends back'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Type the reason'; end if;
  update push_requests set status = 'returned', note = btrim(p_reason), decided_by = current_employee_id(), decided_at = now()
  where id = p_id and status = 'pending' returning * into r;
  if r.id is null then raise exception 'It is not waiting for approval'; end if;
  perform digest_bell(r.asked_by, 'Notification sent back · ' || r.title, btrim(p_reason), null);
end $$;

-- The count on SW Admin's Digest tab.
create or replace function digest_waiting_count()
returns integer
language sql stable security definer set search_path = public as $$
  select case when is_sw_admin() then
    (select count(*)::int from digest_posts where approval = 'pending' and deleted_at is null)
    + (select count(*)::int from push_requests where status = 'pending')
  else 0 end
$$;

revoke all on function digest_approve(uuid) from public, anon;
revoke all on function digest_send_back(uuid, text) from public, anon;
revoke all on function push_ask(text, text, jsonb, text, text, integer) from public, anon;
revoke all on function push_request_list() from public, anon;
revoke all on function push_my_requests() from public, anon;
revoke all on function push_request_send_back(uuid, text) from public, anon;
revoke all on function digest_waiting_count() from public, anon;
grant execute on function digest_approve(uuid) to authenticated;
grant execute on function digest_send_back(uuid, text) to authenticated;
grant execute on function push_ask(text, text, jsonb, text, text, integer) to authenticated;
grant execute on function push_request_list() to authenticated;
grant execute on function push_my_requests() to authenticated;
grant execute on function push_request_send_back(uuid, text) to authenticated;
grant execute on function digest_waiting_count() to authenticated;
