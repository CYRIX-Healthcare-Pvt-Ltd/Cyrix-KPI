-- =====================================================================
-- Cyrix KPI  ·  0183  ·  Edit access to a post, and its log
--
-- The user, 12 Oct: "IT admin posted 1, so IT admin should have an option to
-- grant edit access, he has option HR admin and MRK admin, he can tick any and
-- save, so need edit logs also, and delete option only for the owner".
--
-- editors: the other desks the posting desk lets edit it. They see it in their
-- own list, can change and publish it; deleting it stays the owner's. Every
-- change goes in digest_post_log — created, edited (with what), published,
-- back to draft, access — by whom and when; a run of saves by one person within
-- two minutes is one entry.
-- =====================================================================

alter table digest_posts add column if not exists editors text[] not null default '{}';
alter table digest_posts drop constraint if exists digest_posts_editors_check;
alter table digest_posts add constraint digest_posts_editors_check check (editors <@ array['hr', 'it', 'mkt']);

create or replace function digest_can_edit(p_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from digest_posts p
                 where p.id = p_id and p.deleted_at is null
                   and digest_can_post() is not null
                   and (p.posted_as = digest_can_post() or digest_can_post() = any (p.editors)))
$$;
revoke all on function digest_can_edit(uuid) from public, anon;
grant execute on function digest_can_edit(uuid) to authenticated;

create table if not exists digest_post_log (
  id bigserial primary key,
  post_id uuid not null references digest_posts (id) on delete cascade,
  at timestamptz not null default now(),
  employee_id uuid references employees (id) on delete set null,
  desk text,
  action text not null check (action in ('created', 'edited', 'published', 'drafted', 'access', 'deleted')),
  fields text[] not null default '{}'
);
create index if not exists digest_post_log_post on digest_post_log (post_id, at desc);
alter table digest_post_log enable row level security;
revoke all on digest_post_log from anon, authenticated;

-- One entry; an edit by the same person within two minutes of their last folds into it.
create or replace function digest_log(p_id uuid, p_action text, p_fields text[])
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); last digest_post_log;
begin
  select * into last from digest_post_log where post_id = p_id order by at desc, id desc limit 1;
  if p_action = 'edited' and last.id is not null and last.action in ('edited', 'created')
     and last.employee_id is not distinct from me and last.at > now() - interval '2 minutes' then
    update digest_post_log
    set fields = (select coalesce(array_agg(distinct f), '{}') from unnest(last.fields || p_fields) f), at = now()
    where id = last.id;
    return;
  end if;
  insert into digest_post_log (post_id, employee_id, desk, action, fields)
  values (p_id, me, digest_can_post(), p_action, coalesce(p_fields, '{}'));
end $$;
revoke all on function digest_log(uuid, text, text[]) from public, anon, authenticated;

-- What changed on the post itself, as its fields' names.
create or replace function digest_posts_log() returns trigger
language plpgsql security definer set search_path = public as $$
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
  select coalesce(array_agg(k order by k), '{}') into changed
  from jsonb_each(to_jsonb(new)) n(k, v)
  where k not in ('id', 'published_at', 'deleted_at', 'editors', 'created_at', 'updated_at', 'posted_by', 'posted_as')
    and (to_jsonb(old) -> k) is distinct from v;
  if cardinality(changed) > 0 then perform digest_log(new.id, 'edited', changed); end if;
  return new;
end $$;
drop trigger if exists digest_posts_log on digest_posts;
create trigger digest_posts_log after insert or update on digest_posts
  for each row execute function digest_posts_log();

-- The owner gives or takes edit access; their own desk is never in the list.
create or replace function digest_set_editors(p_id uuid, p_desks text[])
returns void
language plpgsql security definer set search_path = public as $$
declare desk text := digest_can_post();
begin
  update digest_posts
  set editors = (select coalesce(array_agg(distinct d order by d), '{}') from unnest(coalesce(p_desks, '{}')) d
                 where d in ('hr', 'it', 'mkt') and d <> desk)
  where id = p_id and deleted_at is null and posted_as = desk;
  if not found then raise exception 'Only the desk that posted it can share it'; end if;
end $$;
revoke all on function digest_set_editors(uuid, text[]) from public, anon;
grant execute on function digest_set_editors(uuid, text[]) to authenticated;

-- The post's history, for whoever may edit it.
create or replace function digest_edit_log(p_id uuid)
returns table (at timestamptz, ecode text, full_name text, desk text, action text, fields text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not digest_can_edit(p_id) then raise exception 'Only the desks that can edit it'; end if;
  return query
  select l.at, e.ecode, e.full_name, l.desk, l.action, l.fields
  from digest_post_log l left join employees e on e.id = l.employee_id
  where l.post_id = p_id order by l.at desc, l.id desc limit 200;
end $$;
revoke all on function digest_edit_log(uuid) from public, anon;
grant execute on function digest_edit_log(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.digest_set_form(p_id uuid, p_questions jsonb, p_closes_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q jsonb; n int := 0; answered boolean; keep uuid[] := '{}'; qid uuid; opts text[];
begin
  if not exists (select 1 from digest_posts where id = p_id and kind = 'form' and deleted_at is null and digest_can_edit(id)) then
    raise exception 'Only whoever posted the form can set its questions';
  end if;
  if p_closes_at is null then raise exception 'A form needs a closing date'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then raise exception 'A form needs at least one question'; end if;
  if jsonb_array_length(p_questions) > 30 then raise exception 'A form takes up to 30 questions'; end if;
  answered := exists (select 1 from digest_form_responses where post_id = p_id);
  update digest_posts set closes_at = p_closes_at where id = p_id;

  for q in select * from jsonb_array_elements(p_questions) loop
    n := n + 1;
    if btrim(coalesce(q->>'label', '')) = '' then raise exception 'Question % has no wording', n; end if;
    select coalesce(array_agg(btrim(o) order by i), '{}') into opts
    from jsonb_array_elements_text(coalesce(q->'options', '[]'::jsonb)) with ordinality as t(o, i) where btrim(o) <> '';
    if q->>'qtype' in ('one', 'many') and cardinality(opts) < 2 then raise exception 'Question % needs at least two choices', n; end if;
    qid := nullif(q->>'id', '')::uuid;
    if qid is not null and exists (select 1 from digest_form_questions where id = qid and post_id = p_id) then
      if answered and (select qtype from digest_form_questions where id = qid) <> q->>'qtype' then
        raise exception 'People have answered already, so question % cannot change its type', n;
      end if;
      update digest_form_questions set position = n, label = btrim(q->>'label'), qtype = q->>'qtype', options = opts,
             required = coalesce((q->>'required')::boolean, false)
      where id = qid;
    else
      insert into digest_form_questions (post_id, position, label, qtype, options, required)
      values (p_id, n, btrim(q->>'label'), q->>'qtype', opts, coalesce((q->>'required')::boolean, false))
      returning id into qid;
    end if;
    keep := keep || qid;
  end loop;

  if answered and exists (select 1 from digest_form_questions where post_id = p_id and not (id = any (keep))) then
    raise exception 'People have answered already, so no question can be removed';
  end if;
  delete from digest_form_questions where post_id = p_id and not (id = any (keep));
  perform digest_log(p_id, 'edited', array['questions']);
end $function$;

CREATE OR REPLACE FUNCTION public.digest_set_poll(p_id uuid, p_options text[], p_closes_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_multi boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare opts text[];
begin
  if not exists (select 1 from digest_posts where id = p_id and kind = 'poll' and deleted_at is null and digest_can_edit(id)) then
    raise exception 'Only whoever posted the poll can set its options';
  end if;
  select array_agg(btrim(o) order by n) into opts
  from unnest(p_options) with ordinality as t(o, n) where btrim(coalesce(o, '')) <> '';
  if coalesce(cardinality(opts), 0) < 2 or cardinality(opts) > 6 then
    raise exception 'A poll needs 2 to 6 options';
  end if;
  update digest_posts set closes_at = p_closes_at, multi = coalesce(p_multi, false) where id = p_id;
  if exists (select 1 from digest_votes where post_id = p_id) then
    if opts is distinct from (select array_agg(label order by position) from digest_poll_options where post_id = p_id) then
      raise exception 'People have voted already, so the options cannot change';
    end if;
    return;
  end if;
  perform digest_log(p_id, 'edited', array['options']);
  delete from digest_poll_options where post_id = p_id;
  insert into digest_poll_options (post_id, label, position)
  select p_id, o, n::int from unnest(opts) with ordinality as t(o, n);
end $function$;

CREATE OR REPLACE FUNCTION public.digest_set_until(p_id uuid, p_until date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update digest_posts set show_until = p_until
  where id = p_id and deleted_at is null and digest_can_edit(id);
  if not found then raise exception 'Only whoever posted it can change it'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.digest_set_vacancy(p_id uuid, p_location text, p_apply_by date, p_apply_link text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if nullif(btrim(coalesce(p_apply_link, '')), '') is not null
     and btrim(p_apply_link) !~* '^(https://|mailto:)?[^\s]+$' then
    raise exception 'How to apply: a link starting with https:// or an email address';
  end if;
  update digest_posts
  set vac_location = nullif(btrim(coalesce(p_location, '')), ''),
      apply_by = p_apply_by,
      apply_link = nullif(btrim(coalesce(p_apply_link, '')), '')
  where id = p_id and kind = 'vacancy' and deleted_at is null and digest_can_edit(id);
  if not found then raise exception 'Only whoever posted the vacancy can change it'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.digest_set_published(p_id uuid, p_published boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update digest_posts
  set published_at = case when p_published then coalesce(published_at, now()) end
  where id = p_id and deleted_at is null and digest_can_edit(id);
  if not found then raise exception 'Only whoever posted it can publish it'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.digest_join_report(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, department text, clicks integer, first_at timestamp with time zone, last_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from digest_posts where id = p_id and digest_can_edit(id)) then
    raise exception 'Only whoever posted it';
  end if;
  return query
  select e.ecode, e.full_name, e.department, count(*)::int, min(j.clicked_at), max(j.clicked_at)
  from digest_joins j join employees e on e.id = j.employee_id
  where j.post_id = p_id
  group by e.ecode, e.full_name, e.department
  order by min(j.clicked_at);
end $function$;

CREATE OR REPLACE FUNCTION public.digest_likers(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from digest_posts where id = p_id and digest_can_edit(id)) then
    raise exception 'Only whoever posted it';
  end if;
  return query
  select e.ecode, e.full_name, l.created_at from digest_likes l join employees e on e.id = l.employee_id
  where l.post_id = p_id order by l.created_at;
end $function$;

CREATE OR REPLACE FUNCTION public.digest_post_people(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, department text, function_name text, seen_at timestamp with time zone, opened_at timestamp with time zone, opens integer, liked_at timestamp with time zone, comments integer, joins integer, joined_at timestamp with time zone, voted text, answered_at timestamp with time zone, answers jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from digest_posts where id = p_id and digest_can_edit(id)) then
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
         fr.updated_at, fr.answers
  from employees e
  left join digest_views v on v.post_id = p_id and v.employee_id = e.id
  left join digest_likes l on l.post_id = p_id and l.employee_id = e.id
  left join digest_form_responses fr on fr.post_id = p_id and fr.employee_id = e.id
  where e.is_active and position('_' in e.ecode) = 0
  order by e.full_name;
end $function$;

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
  if p_kind = 'meeting' and p_meet_at is null then
    raise exception 'A meeting needs a date and time';
  end if;
  if p_kind = 'meeting' and nullif(btrim(coalesce(p_meet_link, '')), '') is not null and btrim(p_meet_link) !~ '^https://' then
    raise exception 'The meeting link starts with https://';
  end if;
  if p_id is null then
    insert into digest_posts (kind, title, body, image_url, color, meet_at, meet_minutes, meet_link, meet_place, posted_by, posted_as)
    values (p_kind, btrim(p_title), coalesce(p_body, ''), nullif(p_image_url, ''), coalesce(p_color, 'red'),
            case when p_kind = 'meeting' then p_meet_at end, case when p_kind = 'meeting' then p_meet_minutes end,
            case when p_kind = 'meeting' then nullif(btrim(p_meet_link), '') end, case when p_kind = 'meeting' then nullif(btrim(p_meet_place), '') end,
            current_employee_id(), desk)
    returning id into v;
  else
    update digest_posts set kind = p_kind, title = btrim(p_title), body = coalesce(p_body, ''),
      image_url = nullif(p_image_url, ''), color = coalesce(p_color, 'red'),
      meet_at = case when p_kind = 'meeting' then p_meet_at end,
      meet_minutes = case when p_kind = 'meeting' then p_meet_minutes end,
      meet_link = case when p_kind = 'meeting' then nullif(btrim(p_meet_link), '') end,
      meet_place = case when p_kind = 'meeting' then nullif(btrim(p_meet_place), '') end,
      updated_at = now()
    where id = p_id and deleted_at is null and digest_can_edit(id)
    returning id into v;
    if v is null then raise exception 'Only whoever posted it can change it'; end if;
  end if;
  return v;
end $function$;

drop function if exists digest_admin_list();
CREATE FUNCTION public.digest_admin_list()
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, comments integer, joined integer, clicks integer, mine boolean, vac_location text, apply_by date, apply_link text, show_until date, published_at timestamp with time zone, can_edit boolean, editors text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare desk text := digest_can_post();
begin
  if desk is null then raise exception 'Only HR, IT or Marketing'; end if;
  return query
  select p.id, p.kind, p.title, p.body, p.image_url, p.color, p.meet_at, p.meet_minutes, p.meet_link, p.meet_place,
         p.posted_as, e.full_name, p.created_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         (select count(distinct j.employee_id)::int from digest_joins j where j.post_id = p.id),
         (select count(*)::int from digest_joins j where j.post_id = p.id),
         p.posted_as = desk,
         p.vac_location, p.apply_by, p.apply_link, case when p.kind = 'meeting' then (p.meet_at at time zone 'Asia/Kolkata')::date
              else digest_last_day(p.kind, p.show_until, p.apply_by, p.closes_at) end,
         p.published_at,
         true, p.editors
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and (p.posted_as = desk or desk = any (p.editors))
  order by p.created_at desc
  limit 500;
end $function$;
grant execute on function digest_admin_list() to authenticated;
