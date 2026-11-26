-- =====================================================================
-- Cyrix KPI  ·  0287  ·  Spellings we accepted are counted, never shown as the answer
--
-- The user, 12 Nov (Mary Dayana's "Aurom" showed the right answer as "ARUM"):
-- "in correct answers it should show what tincy added as answer, our spelling
-- correction shouldnt show as correct word there". The extra spellings given
-- the marks today (0286 day: group A, "TRC Revival Lab", "Aurom") move out of
-- correct into also_accept: scored the same, but the page and the poster's
-- editor show only the poster's own answers, the main one first.
-- =====================================================================

alter table digest_form_questions add column if not exists also_accept text[] not null default '{}';

-- The Quality Day Awareness Quiz 2026: the poster's answers back in correct (main one first), ours in also_accept.
update digest_form_questions q
set also_accept = (select coalesce(array_agg(x order by x), '{}') from unnest(q.correct) x where x = any (v.extra)),
    correct = array[v.main] || (select coalesce(array_agg(x order by x), '{}') from unnest(q.correct) x where not (x = any (v.extra)) and x <> v.main)
from (values
  (1,  'Care 360',              array['Cyrix Care 360', 'Cyrixcare 360', 'Cyrix Care360', 'Care 360°']),
  (2,  'Revive Lab',            array['Revibe Lab', 'Review lab', 'Rivain leb', 'Revair lab', 'Cyric ReviveLab', 'TRC Revival Lab']),
  (3,  'Aurum',                 array['Auram', 'Cyrix Auram', 'ARUM', 'Autum', 'Cyriz aurum', 'cyrix aurum vertical', 'Aurom']),
  (7,  'Building relationship', array['Bulding relationship', 'Buliding relationship', 'Bilding relationship', 'Buidling relationship', 'Budling relationship', 'Build relationship']),
  (8,  'Speed of response',     array['Speed of responce']),
  (9,  'Caring',                array['Carring']),
  (10, 'Expert Link',           array['Expart link', 'Experlink', 'Expectlink'])
) v(pos, main, extra)
where q.post_id = (select id from digest_posts where title = 'Quality Day Awareness Quiz 2026' and kind = 'quiz' and deleted_at is null)
  and q.position = v.pos and q.qtype = 'short' and v.main = any (q.correct);

-- The quiz for the page: also returns the other spellings, so a sent quiz ticks them right.
drop function if exists public.digest_quiz(uuid);
create function public.digest_quiz(p_id uuid)
returns table (id uuid, label text, qtype text, options text[], points int, correct text[], closes_at timestamptz,
               mine jsonb, sent_at timestamptz, score int, max_score int, also text[])
language sql stable security definer set search_path = public as $$
  with r as (select * from digest_form_responses r where r.post_id = p_id and r.employee_id = current_employee_id())
  select q.id, q.label, q.qtype, q.options, q.points,
         case when exists (select 1 from r) or digest_can_edit(p_id) then q.correct end,
         p.closes_at, (select r.answers from r), (select r.created_at from r), (select r.score from r), (select r.max_score from r),
         case when exists (select 1 from r) or digest_can_edit(p_id) then q.also_accept end
  from digest_form_questions q join digest_posts p on p.id = q.post_id
  where q.post_id = p_id and p.kind = 'quiz' and p.deleted_at is null and current_employee_id() is not null
  order by q.position
$$;
revoke all on function public.digest_quiz(uuid) from public, anon;
grant execute on function public.digest_quiz(uuid) to authenticated;

-- Sending: the other spellings score as before.
create or replace function digest_quiz_submit(p_id uuid, p_answers jsonb)
returns table (score int, max_score int)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_employee_id(); p record; s digest_quiz_starts; timed boolean; ans jsonb := coalesce(p_answers, '{}'::jsonb);
  q record; v jsonb; picked text[]; clean jsonb := '{}'::jsonb; got int := 0; total int := 0;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into p from digest_posts where id = p_id and kind = 'quiz' and deleted_at is null;
  if not found then raise exception 'That quiz is not there'; end if;
  timed := p.time_limit_seconds is not null;
  if not p.allow_again and exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then
    raise exception 'You have sent this quiz already';
  end if;
  if timed then
    s := digest_quiz_open_row(p_id, me);
    if s.post_id is null then raise exception 'Press Start first'; end if;
    if digest_quiz_used(s) > p.time_limit_seconds + 30 then ans := coalesce(s.draft, '{}'::jsonb); end if;
  elsif p.closes_at < now() then
    raise exception 'This quiz has closed';
  end if;

  for q in select * from digest_form_questions where post_id = p_id order by position loop
    total := total + q.points;
    v := ans -> q.id::text;
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb
       or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if timed then continue; end if;
      raise exception 'Answer "%" first', q.label;
    end if;
    if q.qtype = 'many' then
      if jsonb_typeof(v) <> 'array' then raise exception 'Choose from the choices for "%"', q.label; end if;
      select coalesce(array_agg(distinct x), '{}') into picked from jsonb_array_elements_text(v) x;
      if exists (select 1 from unnest(picked) x where not (x = any (q.options))) then raise exception 'Choose from the choices for "%"', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, to_jsonb(picked));
      if picked <@ q.correct and q.correct <@ picked then got := got + q.points; end if;
    elsif q.qtype = 'short' then
      if jsonb_typeof(v) <> 'string' then raise exception 'Answer "%" in words', q.label; end if;
      if length(v #>> '{}') > 300 then raise exception 'The answer to "%" is too long', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, btrim(v #>> '{}'));
      if digest_quiz_same(v #>> '{}', q.correct || q.also_accept) then
        got := got + q.points;
      end if;
    else
      if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (q.options)) then raise exception 'Choose one of the choices for "%"', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, v);
      if (v #>> '{}') = any (q.correct) then got := got + q.points; end if;
    end if;
  end loop;
  -- The clock stops at sending; time taken is what it ran.
  if timed then
    update digest_quiz_starts set used_seconds = least(p.time_limit_seconds, digest_quiz_used(s)), running_since = null
    where post_id = p_id and employee_id = me;
  end if;
  insert into digest_form_responses (post_id, employee_id, answers, score, max_score) values (p_id, me, clean, got, total)
  on conflict (post_id, employee_id) do update set answers = excluded.answers, score = excluded.score, max_score = excluded.max_score, updated_at = now();
  return query select got, total;
end $$;
revoke all on function digest_quiz_submit(uuid, jsonb) from public, anon;
grant execute on function digest_quiz_submit(uuid, jsonb) to authenticated;
