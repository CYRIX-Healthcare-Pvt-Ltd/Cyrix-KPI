-- =====================================================================
-- Cyrix KPI  ·  0309  ·  Each person arranges their own portal tiles
--
-- 23 Nov 2026 (Adrian): "give the user the option to rearrange each card
-- as per their usage and quick access". Until now every tile on
-- app.cyrix.in came out in app_modules.sort_order, the same for everyone.
--
-- One row per person, holding the module codes in the order they chose.
-- It is a list of codes, not a position on each employee_modules row, for
-- two reasons:
--   * employee_modules is HR/SW Admin's table. Its write policy and its
--     triggers (the Ops grant guard, the "new module" push) are about
--     handing access out; a person tidying their home page should not go
--     anywhere near them.
--   * It cannot drift from what they are actually given. my_modules() still
--     starts from the grants: a code in the list that is no longer granted
--     simply matches nothing, and a module granted after the list was saved
--     has no place in it and goes to the end, in the company order.
--
-- No read or write policy at all: nobody touches the table directly. The
-- portal reads it only through my_modules() and writes it only through
-- set_my_tile_order(), both security definer and both keyed on
-- current_employee_id(), so a caller can only ever reach their own row.
--
-- Costs nothing on page load: the order arrives with the my_modules() call
-- the portal already makes. A write happens only when somebody presses Done.
-- =====================================================================

create table if not exists public.employee_tile_order (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  codes       text[] not null,
  updated_at  timestamptz not null default now()
);

alter table public.employee_tile_order enable row level security;
revoke all on public.employee_tile_order from anon, authenticated;

comment on table public.employee_tile_order is
  'The order a person put their portal tiles in (0309). Read via my_modules(), written via set_my_tile_order().';


-- Same shape and same rows as before; only the order changes. Somebody who
-- has never arranged anything has no row, so every array_position is null
-- and they see the company order exactly as before.
create or replace function public.my_modules()
returns setof public.app_modules
language sql stable security definer set search_path = public as $$
  select m.*
  from app_modules m
  join employee_modules em on em.module_code = m.code
  left join employee_tile_order o on o.employee_id = em.employee_id
  where m.is_active
    and em.employee_id = current_employee_id()
  order by array_position(o.codes, m.code) nulls last, m.sort_order, m.name
$$;

grant execute on function public.my_modules() to authenticated;


-- Save the caller's order. Null or an empty list clears it: back to the
-- company order (the portal's "Reset to default").
--
-- Codes are kept only if they name a real module, de-duplicated, first
-- occurrence wins, and capped at 50, so the row stays a short list whatever
-- the page sends. Codes they are not granted are allowed through on purpose:
-- my_modules() ignores them, and keeping them means a module taken away and
-- later given back returns to the place they had put it.
create or replace function public.set_my_tile_order(p_codes text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_employee_id();
  clean text[];
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select coalesce(array_agg(c order by first_at), '{}')
    into clean
  from (
    select c, min(ord) as first_at
    from unnest(coalesce(p_codes, '{}')) with ordinality as t(c, ord)
    where exists (select 1 from app_modules m where m.code = t.c)
    group by c
    order by min(ord)
    limit 50
  ) s;

  if cardinality(clean) = 0 then
    delete from employee_tile_order where employee_id = me;
  else
    insert into employee_tile_order (employee_id, codes, updated_at)
    values (me, clean, now())
    on conflict (employee_id) do update
      set codes = excluded.codes, updated_at = excluded.updated_at;
  end if;
end $$;

revoke all on function public.set_my_tile_order(text[]) from public, anon;
grant execute on function public.set_my_tile_order(text[]) to authenticated;

comment on function public.set_my_tile_order(text[]) is
  'Saves the signed-in person''s portal tile order (0309). Null or empty resets to the company order.';
