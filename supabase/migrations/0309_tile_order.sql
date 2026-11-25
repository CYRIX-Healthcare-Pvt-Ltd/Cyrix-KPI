-- 0309: the portal tile order per person (the user, 25 Nov) — KPI first is fixed in the page; this keeps the rest.
alter table public.employees add column if not exists tile_order text[];

create or replace function public.set_tile_order(p_order text[])
returns void language sql security definer set search_path = public as $$
  update employees set tile_order = p_order[1:40] where auth_user_id = auth.uid();
$$;
revoke all on function public.set_tile_order(text[]) from public, anon;
grant execute on function public.set_tile_order(text[]) to authenticated;
