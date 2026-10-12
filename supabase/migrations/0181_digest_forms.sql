-- =====================================================================
-- Cyrix KPI  ·  0181  ·  Cyrix Digest forms
--
-- The user, 12 Oct: "can we add forms also?" — then "need ecode and name",
-- "reminder not needed", "to everyone". A Form post carries questions (short
-- text, long text, one choice, many choices, yes/no, number, date, rating
-- 1–5; any may be required) and closes on a date. Everybody can send it
-- once and change their answers until it closes; the desk that posted it
-- sees every answer by E-code and name (digest_post_people), and who has
-- not answered.
-- =====================================================================

alter table digest_posts drop constraint if exists digest_posts_kind_check;
alter table digest_posts add constraint digest_posts_kind_check
  check (kind in ('news', 'meeting', 'poll', 'announcement', 'alert', 'notice', 'vacancy', 'form'));

create table if not exists digest_form_questions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references digest_posts (id) on delete cascade,
  position int not null,
  label text not null check (length(btrim(label)) between 1 and 200),
  qtype text not null check (qtype in ('short', 'long', 'one', 'many', 'yesno', 'number', 'date', 'rating')),
  options text[] not null default '{}',
  required boolean not null default false
);
create index if not exists digest_form_questions_post on digest_form_questions (post_id, position);

-- One per person per form: their answers by question id, changeable until it closes.
create table if not exists digest_form_responses (
  post_id uuid not null references digest_posts (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, employee_id)
);
alter table digest_form_questions enable row level security;
alter table digest_form_responses enable row level security;
revoke all on digest_form_questions, digest_form_responses from anon, authenticated;

-- The posting desk sets the questions. Once anybody has answered, the questions
-- may be reworded and reordered, but none removed and no type changed.
create or replace function digest_set_form(p_id uuid, p_questions jsonb, p_closes_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  q jsonb; n int := 0; answered boolean; keep uuid[] := '{}'; qid uuid; opts text[];
begin
  if not exists (select 1 from digest_posts where id = p_id and kind = 'form' and deleted_at is null and posted_as = digest_can_post()) then
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
end $$;
revoke all on function digest_set_form(uuid, jsonb, timestamptz) from public, anon;
grant execute on function digest_set_form(uuid, jsonb, timestamptz) to authenticated;

-- The questions, the closing time, and this person's answers.
create or replace function digest_form(p_id uuid)
returns table (id uuid, label text, qtype text, options text[], required boolean, closes_at timestamptz, mine jsonb, sent_at timestamptz, answered int)
language sql stable security definer set search_path = public as $$
  select q.id, q.label, q.qtype, q.options, q.required, p.closes_at,
         (select r.answers from digest_form_responses r where r.post_id = p_id and r.employee_id = current_employee_id()),
         (select r.updated_at from digest_form_responses r where r.post_id = p_id and r.employee_id = current_employee_id()),
         (select count(*)::int from digest_form_responses r where r.post_id = p_id)
  from digest_form_questions q join digest_posts p on p.id = q.post_id
  where q.post_id = p_id and p.deleted_at is null and current_employee_id() is not null
  order by q.position
$$;
revoke all on function digest_form(uuid) from public, anon;
grant execute on function digest_form(uuid) to authenticated;

-- Send (or change) one's answers: every required question answered, before it closes.
create or replace function digest_form_submit(p_id uuid, p_answers jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); q record; v jsonb; clean jsonb := '{}'::jsonb;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from digest_posts where id = p_id and kind = 'form' and deleted_at is null) then
    raise exception 'That form is not there';
  end if;
  if (select closes_at from digest_posts where id = p_id) < now() then raise exception 'This form has closed'; end if;
  for q in select * from digest_form_questions where post_id = p_id order by position loop
    v := p_answers -> q.id::text;
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb then
      if q.required then raise exception 'Answer "%" first', q.label; end if;
      continue;
    end if;
    if q.qtype = 'many' then
      if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements_text(v) a where not (a = any (q.options))) then
        raise exception 'Choose from the choices for "%"', q.label;
      end if;
    elsif q.qtype in ('one') and not ((v #>> '{}') = any (q.options)) then
      raise exception 'Choose one of the choices for "%"', q.label;
    elsif q.qtype = 'yesno' and (v #>> '{}') not in ('Yes', 'No') then
      raise exception 'Answer Yes or No for "%"', q.label;
    elsif q.qtype = 'rating' and (v #>> '{}') not in ('1', '2', '3', '4', '5') then
      raise exception 'Rate "%" from 1 to 5', q.label;
    elsif q.qtype = 'number' and (v #>> '{}') !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'A number for "%"', q.label;
    elsif q.qtype = 'date' and (v #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'A date for "%"', q.label;
    elsif q.qtype in ('short', 'long') and length(v #>> '{}') > (case when q.qtype = 'short' then 300 else 3000 end) then
      raise exception 'The answer to "%" is too long', q.label;
    end if;
    clean := clean || jsonb_build_object(q.id::text, v);
  end loop;
  insert into digest_form_responses (post_id, employee_id, answers) values (p_id, me, clean)
  on conflict (post_id, employee_id) do update set answers = excluded.answers, updated_at = now();
end $$;
revoke all on function digest_form_submit(uuid, jsonb) from public, anon;
grant execute on function digest_form_submit(uuid, jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.digest_last_day(p_kind text, p_show_until date, p_apply_by date, p_closes_at timestamp with time zone)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_kind
           when 'vacancy' then p_apply_by
           when 'poll' then (p_closes_at at time zone 'Asia/Kolkata')::date
           when 'form' then (p_closes_at at time zone 'Asia/Kolkata')::date
           else p_show_until
         end
$function$;

drop function if exists digest_post_people(uuid);
CREATE FUNCTION public.digest_post_people(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, department text, function_name text, seen_at timestamp with time zone, opened_at timestamp with time zone, opens integer, liked_at timestamp with time zone, comments integer, joins integer, joined_at timestamp with time zone, voted text, answered_at timestamp with time zone, answers jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from digest_posts where id = p_id and posted_as = digest_can_post()) then
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
grant execute on function digest_post_people(uuid) to authenticated;
