-- =====================================================================
-- Cyrix KPI  ·  0257  ·  A quiz question may carry 0 marks
--
-- The user, 5 Nov: "mark can be 0". And the forms posted before 0256 keep
-- being changeable, as they were when people were told about them.
-- =====================================================================
alter table digest_form_questions drop constraint if exists digest_form_questions_points_check;
alter table digest_form_questions add constraint digest_form_questions_points_check check (points between 0 and 100);

do $$
declare src text;
begin
  select replace(pg_get_functiondef('digest_set_quiz(uuid, jsonb, timestamptz)'::regprocedure), E'\r\n', E'\n') into src;
  if position('if pts < 1 or pts > 100 then raise exception ''Marks for question % go from 1 to 100'', n; end if;' in src) = 0 then
    raise exception 'digest_set_quiz has changed';
  end if;
  execute replace(replace(src,
    'if pts < 1 or pts > 100 then raise exception ''Marks for question % go from 1 to 100'', n; end if;',
    'if pts < 0 or pts > 100 then raise exception ''Marks for question % go from 0 to 100'', n; end if;'),
    'pts := coalesce(nullif(q->>''points'', '''')::int, 1);', 'pts := coalesce(nullif(q->>''points'', '''')::int, 1);');
end $$;

update digest_posts set allow_again = true
where kind = 'form' and not anonymous and created_at < '2026-11-05 12:00:00+00' and not allow_again;
