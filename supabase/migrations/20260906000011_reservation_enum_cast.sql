-- ============================================================================
-- 0011 · FIX: explicit enum cast in reserve_stock_for_project()
-- ----------------------------------------------------------------------------
-- THE BUG
-- Executing a contract failed with:
--
--     column "status" is of type public.reservation_status
--     but expression is of type text
--
-- WHY IT HAPPENED
-- The insert used a CASE expression to decide the reservation status:
--
--     case when v_hold >= line.qty then 'reserved' else 'short' end
--
-- Inside plpgsql, bare string literals in a CASE resolve to `text`, and
-- PostgreSQL will not implicitly cast text to a user-defined enum on insert.
-- The literals had to be cast explicitly.
--
-- WHY IT WAS NOT CAUGHT EARLIER
-- The function body is only type-checked when it actually runs, and nothing ran
-- it until the demonstration seed executed its first contract. This is the
-- standard trap with plpgsql: unlike a `language sql` function, the body is not
-- validated at creation time, so a type error can sit in a deployed function
-- indefinitely until the exact code path is exercised.
--
-- It also explains why the seed is worth having as a migration: it drives every
-- trigger in 0008 end to end, so a fault like this surfaces at deploy time
-- rather than in front of an audience.
--
-- Everything else in this function is unchanged from 0009, including the
-- authorisation guard and the FOR UPDATE row lock.
-- ============================================================================

create or replace function public.reserve_stock_for_project(
  p_project_id uuid,
  p_quotation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line record;
  v_available numeric;
  v_hold numeric;
begin
  -- auth.uid() is null when this runs from the contract trigger inside a
  -- system-initiated transaction, so an unauthenticated context is legitimate.
  -- A signed-in caller, however, must be authorised.
  if (select auth.uid()) is not null
     and not public.has_role('sales', 'inventory_manager', 'project_engineer', 'admin') then
    raise exception 'Not authorised to reserve stock';
  end if;

  for line in
    select stock_item_id, sum(quantity) as qty
    from public.quotation_lines
    where quotation_id = p_quotation_id and stock_item_id is not null
    group by stock_item_id
  loop
    -- FOR UPDATE serialises concurrent reservations of the same item, so two
    -- contracts signed in the same moment cannot both claim the last inverter.
    select on_hand - reserved into v_available
    from public.stock_items
    where id = line.stock_item_id
    for update;

    -- Hold what we can. A shortfall is recorded rather than rejected: the sale
    -- is already signed, so the correct response is to flag procurement, not to
    -- fail the contract.
    v_hold := least(greatest(coalesce(v_available, 0), 0), line.qty);

    update public.stock_items
    set reserved = reserved + v_hold
    where id = line.stock_item_id;

    insert into public.stock_reservations (project_id, stock_item_id, quantity, quantity_held, status)
    values (
      p_project_id,
      line.stock_item_id,
      line.qty,
      v_hold,
      -- THE FIX: cast the literals to the enum explicitly.
      (case when v_hold >= line.qty then 'reserved' else 'short' end)::public.reservation_status
    )
    on conflict (project_id, stock_item_id) do update
      set quantity = excluded.quantity,
          quantity_held = excluded.quantity_held,
          status = excluded.status;
  end loop;

  perform public.write_audit(
    'Stock reserved against signed contract',
    'projects',
    p_project_id::text,
    'info',
    jsonb_build_object('quotation_id', p_quotation_id)
  );
end;
$$;

-- Re-apply the grant policy from 0009: this function is reachable only from
-- trigger context and is deliberately granted to nobody.
revoke all on function public.reserve_stock_for_project(uuid, uuid)
  from public, anon, authenticated;
