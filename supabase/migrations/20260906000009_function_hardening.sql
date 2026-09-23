-- ============================================================================
-- 0009 · FUNCTION HARDENING
-- ----------------------------------------------------------------------------
-- Closes a real hole that the Supabase security advisor flagged after 0008.
--
-- THE PROBLEM
-- PostgREST exposes every function in the `public` schema as an RPC endpoint at
-- /rest/v1/rpc/<name>. Because Postgres grants EXECUTE to PUBLIC on new
-- functions by default, all 23 of our SECURITY DEFINER functions were callable
-- by anyone holding the anon key — which is printed in the browser bundle.
--
-- Concretely, before this migration a stranger could:
--
--   POST /rest/v1/rpc/write_audit               -> forge audit-log entries,
--                                                  destroying the credibility of
--                                                  the entire governance module
--   POST /rest/v1/rpc/consume_project_stock     -> silently drain the warehouse
--   POST /rest/v1/rpc/reserve_stock_for_project -> lock up stock against any
--                                                  project they could name
--
-- SECURITY DEFINER means these run as the function OWNER, so RLS does not stop
-- them. That is exactly why they need it to do their job, and exactly why they
-- must not be reachable from the internet.
--
-- THE FIX, IN THREE PARTS
--   1. Revoke EXECUTE from public/anon/authenticated on everything.
--   2. Grant it back to `authenticated` ONLY for the handful the application
--      genuinely calls, and never to `anon`.
--   3. Add an authorisation check INSIDE the two functions that mutate stock,
--      so that even a legitimately signed-in client cannot call them.
--
-- Trigger functions need no grant at all: a trigger executes as part of the
-- statement, not as the calling role, so revoking EXECUTE does not disable it.
--
-- WHY THE POLICY HELPERS KEEP THEIR GRANT
-- current_user_role(), is_staff() and friends appear inside RLS policy
-- expressions, which are evaluated as the querying role. Revoking EXECUTE from
-- `authenticated` would make every policy that uses them fail with "permission
-- denied for function", locking every signed-in user out of the whole database.
-- They stay granted to `authenticated`, and are safe there because each one
-- only ever reports on the caller's own identity. `anon` loses them, because no
-- anon-facing policy uses one.
-- ============================================================================


-- ============================================================================
-- 1 · REVOKE EVERYTHING
-- ----------------------------------------------------------------------------
-- Deny by default, then grant back deliberately. Listing the functions
-- explicitly rather than looping means a future function is denied until
-- somebody consciously adds it here.
-- ============================================================================

revoke all on function public.write_audit(text, text, text, public.audit_severity, jsonb)
  from public, anon, authenticated;
revoke all on function public.reserve_stock_for_project(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.consume_project_stock(uuid, uuid, numeric)
  from public, anon, authenticated;
revoke all on function public.project_ready_for_dispatch(uuid)
  from public, anon, authenticated;

-- Role and ownership helpers: strip anon, keep authenticated (see header).
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_internal() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.has_role(public.user_role[]) from public, anon;
revoke all on function public.owns_project(uuid) from public, anon;
revoke all on function public.is_crew_on_project(uuid) from public, anon;
revoke all on function public.is_assigned_to_appointment(uuid) from public, anon;

-- Trigger functions. Called by the trigger machinery, never by a client, so
-- they need no grant to anyone.
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.apply_stock_movement() from public, anon, authenticated;
revoke all on function public.recalculate_invoice_totals() from public, anon, authenticated;
revoke all on function public.on_contract_executed() from public, anon, authenticated;
revoke all on function public.on_milestone_completed() from public, anon, authenticated;
revoke all on function public.score_lead() from public, anon, authenticated;
revoke all on function public.audit_permit_decision() from public, anon, authenticated;
revoke all on function public.audit_rma_decision() from public, anon, authenticated;
revoke all on function public.on_warranty_transfer_approved() from public, anon, authenticated;
revoke all on function public.audit_role_change() from public, anon, authenticated;
revoke all on function public.enforce_discount_authority() from public, anon, authenticated;
revoke all on function public.on_appointment_dispatched() from public, anon, authenticated;
revoke all on function public.set_warranty_expiry() from public, anon, authenticated;


-- ============================================================================
-- 2 · ADD AUTHORISATION INSIDE THE STOCK FUNCTIONS
-- ----------------------------------------------------------------------------
-- The field portal needs technicians to be able to log consumed materials, so
-- consume_project_stock() has to stay reachable by signed-in users. Defence in
-- depth: it now checks the caller itself rather than trusting that only the
-- right screen will ever call it.
-- ============================================================================

create or replace function public.consume_project_stock(
  p_project_id uuid,
  p_stock_item_id uuid,
  p_quantity numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_held numeric;
  v_release numeric;
begin
  -- SECURITY DEFINER bypasses RLS, so the check that RLS would normally make
  -- has to be made here explicitly.
  if not public.is_internal() then
    raise exception 'Only staff and technicians may log stock consumption';
  end if;

  -- A technician may only consume against a job they are actually on. This is
  -- what stops a signed-in technician adjusting stock on somebody else's site.
  if not (public.is_crew_on_project(p_project_id)
          or public.has_role('inventory_manager', 'project_engineer', 'admin')) then
    raise exception 'You are not assigned to this project';
  end if;

  if p_quantity <= 0 then
    raise exception 'Consumed quantity must be positive';
  end if;

  select quantity_held into v_held
  from public.stock_reservations
  where project_id = p_project_id and stock_item_id = p_stock_item_id
  for update;

  -- Never release more than was actually held, or `reserved` drifts negative.
  v_release := least(coalesce(v_held, 0), p_quantity);

  insert into public.stock_movements (stock_item_id, movement_type, quantity, project_id, created_by, note)
  values (p_stock_item_id, 'consumption', -p_quantity, p_project_id, (select auth.uid()), 'Logged from the field portal');

  update public.stock_items
  set reserved = greatest(reserved - v_release, 0)
  where id = p_stock_item_id;

  update public.stock_reservations
  set quantity_held = greatest(quantity_held - v_release, 0),
      status = 'consumed'
  where project_id = p_project_id and stock_item_id = p_stock_item_id;
end;
$$;


-- Reservation is only ever driven by the contract-executed trigger, but it is
-- guarded anyway in case it is later wired to a "re-reserve" admin action.
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
  -- auth.uid() is null when the function runs from a trigger inside a
  -- transaction started by the system, so an unauthenticated context is
  -- legitimate here. A signed-in caller, however, must be authorised.
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
    -- FOR UPDATE serialises concurrent reservations of the same item.
    select on_hand - reserved into v_available
    from public.stock_items
    where id = line.stock_item_id
    for update;

    -- Hold what we can. A shortfall is recorded rather than rejected: the sale
    -- is already signed, so the correct response is to flag procurement, not to
    -- fail the contract.
    v_hold := least(greatest(v_available, 0), line.qty);

    update public.stock_items
    set reserved = reserved + v_hold
    where id = line.stock_item_id;

    insert into public.stock_reservations (project_id, stock_item_id, quantity, quantity_held, status)
    values (
      p_project_id,
      line.stock_item_id,
      line.qty,
      v_hold,
      case when v_hold >= line.qty then 'reserved' else 'short' end
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


-- ============================================================================
-- 3 · GRANT BACK, NARROWLY
-- ============================================================================

-- Policy helpers. Signed-in users only; every RLS policy that mentions one of
-- these needs the caller to hold EXECUTE.
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_internal() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_role(public.user_role[]) to authenticated;
grant execute on function public.owns_project(uuid) to authenticated;
grant execute on function public.is_crew_on_project(uuid) to authenticated;
grant execute on function public.is_assigned_to_appointment(uuid) to authenticated;

-- The field portal calls this to log materials used on site. Guarded internally
-- by the checks added above.
grant execute on function public.consume_project_stock(uuid, uuid, numeric) to authenticated;

-- The dispatch board asks this before allowing a crew to be sent.
grant execute on function public.project_ready_for_dispatch(uuid) to authenticated;

-- write_audit and reserve_stock_for_project are deliberately granted to NOBODY.
-- They are reachable only from trigger context, which is the only place they
-- should ever run. An audit log that an API caller can write to is not an audit
-- log, and stock that an API caller can reserve is not inventory control.


-- ============================================================================
-- 4 · SCHEMA-LEVEL DEFAULT
-- ----------------------------------------------------------------------------
-- Stops the same hole reappearing. Without this, the next `create function` in
-- the public schema is once again granted to PUBLIC and silently published as
-- an RPC endpoint. From here on a new function is denied until it is granted
-- deliberately.
-- ============================================================================

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
