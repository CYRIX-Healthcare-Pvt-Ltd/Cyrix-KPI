-- Deleting a tagged spare left it counted.
--
-- 0064 made deletion soft: the equipment row stays, with deleted_at set,
-- because equipment_history and edit_requests both cascade from it and
-- removing the row would take the record of what happened to a physical
-- asset with it. Every list learned to filter on deleted_at being null.
--
-- These three did not. They were written before soft delete existed and
-- were never revisited, so a spare deleted from the tagged list went on
-- counting towards its client item: the item master kept reading
-- "Tagged 1 · Completed" and naming a Cyrix item, for a spare that was
-- no longer anywhere to be seen. Nothing was wrong with the deletion --
-- the count was answering a different question from the one it was
-- labelled with.
--
-- Not fixed here, and deliberately:
--
--   bluestar_item_for_tag(p_equipment_id) resolves one named spare's
--   catalogue item rather than counting anything. Which item a code
--   points at is true whether or not the spare is retired.
--
--   apply_cyrix_mapping and set_tag_cyrix_mapping act on one spare by
--   id. resolve_edit_request already refuses a deleted one; the direct
--   path does not check, but no screen offers a deleted spare to change.

-- How many live units carry this client item.
create or replace function public.bluestar_tag_counts(item_ids uuid[])
returns table(bluestar_item_id uuid, tagged_count bigint)
language sql
security definer
set search_path to 'public'
as $function$
  select e.bluestar_item_id, count(*)::bigint
  from equipment e
  where auth.uid() is not null
    and e.bluestar_item_id = any(item_ids)
    and e.deleted_at is null
  group by e.bluestar_item_id
$function$;

-- Which Cyrix items this client item's live units point at.
create or replace function public.bluestar_mapping_summary(item_ids uuid[])
returns table(bluestar_item_id uuid, cyrix_item_code text, cyrix_item_name text, tag_count bigint)
language sql
security definer
set search_path to 'public'
as $function$
  select e.bluestar_item_id, e.cyrix_item_code, max(e.cyrix_item_name), count(*)::bigint
  from equipment e
  where auth.uid() is not null
    and e.bluestar_item_id = any(item_ids)
    and e.cyrix_item_code is not null
    and e.deleted_at is null
  group by e.bluestar_item_id, e.cyrix_item_code
  order by count(*) desc
$function$;

-- What a spare of this name has been mapped to before. It is offered to
-- an engineer as evidence -- "four units of this were called that" -- so
-- a retired unit padding the number is the count arguing for something
-- it cannot support.
create or replace function public.cyrix_mappings_for_name(p_name_normalized text)
returns table(cyrix_item_code text, cyrix_item_name text, tag_count bigint, last_mapped_by uuid, last_mapped_at timestamp with time zone)
language sql
security definer
set search_path to 'public'
as $function$
  select e.cyrix_item_code,
         max(e.cyrix_item_name) as cyrix_item_name,
         count(*)::bigint as tag_count,
         (array_agg(h.performed_by order by h.performed_at desc nulls last))[1] as last_mapped_by,
         max(h.performed_at) as last_mapped_at
  from equipment e
  join bluestar_item_master b on b.id = e.bluestar_item_id
  left join bluestar_item_mapping_history h
    on h.equipment_id = e.id and h.to_cyrix_item_code = e.cyrix_item_code
  where auth.uid() is not null
    and b.name_normalized = p_name_normalized
    and e.cyrix_item_code is not null
    and e.deleted_at is null
  group by e.cyrix_item_code
  order by count(*) desc
$function$;

notify pgrst, 'reload schema';
