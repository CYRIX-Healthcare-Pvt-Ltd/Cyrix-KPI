-- =====================================================================
-- Cyrix KPI  ·  0292  ·  Quiz answers: a full stop or a stray mark never costs a mark
--
-- The user, 12 Nov (E545 Alok Kumar, "Speed of Response." and "AURUM – Refurbished
-- & Renewed Medical Equipment" marked wrong): "E545, both are correct", then for the
-- Quality Day Awareness Quiz 2026 "yes do group 1 and 2":
--   1. Typed answers are compared on letters and digits only (0286 ignored spaces and
--      capitals; now also . , * ` – & ( ) and the like). 5 people gain a mark.
--   2. The right answer written with a description ("Aurum (refurbished medical
--      equipment)", "Expert link team") goes into also_accept, as in 0287: counted,
--      never shown as the answer. 21 answers (E545's two were added earlier the same day).
--   Two answers given with one right ("Care and trust", "Ciyan and Aurum") stay wrong.
-- =====================================================================

-- Old marks, kept to add only the difference.
create temp table _old on commit drop as
select r.post_id, r.employee_id, q.id as qid, q.points,
       digest_quiz_same(r.answers ->> q.id::text, q.correct || q.also_accept) as was
from digest_form_responses r join digest_form_questions q on q.post_id = r.post_id and q.qtype = 'short'
join digest_posts p on p.id = r.post_id and p.kind = 'quiz';

create or replace function public.digest_quiz_same(p_answer text, p_correct text[])
returns boolean language sql immutable as $$
  select regexp_replace(lower(coalesce(p_answer, '')), '[^[:alnum:]]', '', 'g') <> ''
     and regexp_replace(lower(coalesce(p_answer, '')), '[^[:alnum:]]', '', 'g')
         = any (select regexp_replace(lower(x), '[^[:alnum:]]', '', 'g') from unnest(p_correct) x)
$$;

-- Group 1 also goes into also_accept word for word, so the page ticks it before Platform's matching is updated.
update digest_form_questions q
set also_accept = (select array_agg(distinct x order by x) from unnest(q.also_accept || n.answers) x)
from (
  -- One row a question (an update takes only one joined row per question).
  select q2.id, array_agg(distinct r.answers ->> q2.id::text) as answers
  from digest_form_questions q2
  join (values
    -- group 1
    ('E2288', 1), ('E725', 1), ('E2186', 3), ('E1757', 8), ('E1252', 10),
    -- group 2
    ('E1028', 1), ('E1224', 1), ('E1925', 1), ('E438', 1), ('E489', 1),
    ('E1282', 2), ('E1900', 2), ('E2292', 2),
    ('CT691', 3), ('E1150', 3), ('E1821', 3), ('E1891', 3), ('E2069', 3), ('E2317', 3), ('E387', 3),
    ('E1573', 7),
    ('E1023', 8), ('E1252', 8),
    ('E2069', 9),
    ('CT691', 10), ('E1107', 10), ('E1817', 10)
  ) v(ecode, pos) on q2.position = v.pos
  join employees e on e.ecode = v.ecode
  join digest_form_responses r on r.post_id = q2.post_id and r.employee_id = e.id
  where q2.post_id = (select id from digest_posts where title = 'Quality Day Awareness Quiz 2026' and kind = 'quiz' and deleted_at is null)
    and q2.qtype = 'short' and btrim(coalesce(r.answers ->> q2.id::text, '')) <> ''
  group by q2.id
) n
where q.id = n.id;

-- Add the marks now right that were wrong.
update digest_form_responses r set score = r.score + g.add
from (
  select o.post_id, o.employee_id, sum(o.points)::int as add
  from _old o join digest_form_responses r2 on r2.post_id = o.post_id and r2.employee_id = o.employee_id
  join digest_form_questions q on q.id = o.qid
  where not o.was and digest_quiz_same(r2.answers ->> q.id::text, q.correct || q.also_accept)
  group by o.post_id, o.employee_id
) g
where r.post_id = g.post_id and r.employee_id = g.employee_id;
