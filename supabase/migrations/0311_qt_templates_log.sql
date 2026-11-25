-- 0311: SW Admin → BEMMP → Templates (the user, 25 Nov): each quotation template, who uploaded it, and whether
-- Gemini read it (the model) or why not — kept by BEMMP in doc.layout.yellow.ai. SW Admin only.
create or replace function public.qt_templates_log()
returns table (id uuid, name text, kind text, by_name text, by_ecode text, created_at timestamptz, updated_at timestamptz, ai text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'SW Admin only'; end if;
  return query
    select t.id, t.name, t.kind, e.full_name, e.ecode, t.created_at, t.updated_at, t.doc->'layout'->'yellow'->>'ai'
    from qt_templates t left join employees e on e.id = t.made_by
    order by t.updated_at desc;
end $$;
revoke all on function public.qt_templates_log() from public, anon;
grant execute on function public.qt_templates_log() to authenticated;
