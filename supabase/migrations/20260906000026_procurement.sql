-- ============================================================================
-- 0026 · PROCUREMENT
-- ----------------------------------------------------------------------------
-- Makes the purchase-order half of the supply chain actually work. Four things,
-- three of which are gaps that would only have shown up in use:
--
--   1. `po_number` had no default, exactly as `reference` did on quotations and
--      contracts before 0024. Any purchase order raised from the UI would have
--      failed on a NOT NULL with no way for the browser to supply a safe value.
--
--   2. `inventory.requisition_approval_limit` was a setting nothing read. It has
--      sat in the settings table since 0018 with a description promising that
--      "a purchase order above this needs administrator approval", and no code
--      anywhere enforced it. A control that exists only in its own description
--      is worse than no control, because people plan around it.
--
--   3. RECEIVING A DELIVERY DID NOT ADD ANY STOCK. Marking a purchase order
--      received changed a status and nothing else: `on_hand` stayed where it
--      was, so the warehouse would show stock it had physically taken in as
--      still missing, and the reorder report would keep asking for more of it.
--      This is the one that would have caused real confusion in a real
--      warehouse.
--
--   4. Reservations had no release path. `consume_project_stock` correctly
--      decrements `reserved` when a technician uses materials, but a project
--      that is CANCELLED left its hold in place for ever — the warehouse would
--      slowly show less available than it physically had, with no way to find
--      out why.
-- ============================================================================


-- ============================================================================
-- 1 · PO NUMBERS
-- ============================================================================

alter table public.purchase_orders
  alter column po_number set default
    'PO-' || to_char(now(), 'YYYY') || '-' || nextval('public.po_ref_seq')::text;

comment on column public.purchase_orders.po_number is
  'PO-<year>-<sequence>. From a sequence, so two buyers raising one at once cannot collide.';


-- ============================================================================
-- 2 · THE REQUISITION APPROVAL LIMIT
-- ----------------------------------------------------------------------------
-- Above the configured amount, only an administrator may approve. The check is
-- on the APPROVAL, not on raising the order: an inventory manager should be
-- able to prepare a large order and send it up for sign-off. Blocking them from
-- drafting it would just move the work into email.
-- ============================================================================

create or replace function public.enforce_requisition_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit numeric := public.setting_num('inventory.requisition_approval_limit', 100000);
  v_actor uuid := (select auth.uid());
begin
  -- Only interested in the moment a PO becomes approved or is ordered.
  if new.status not in ('approved', 'ordered', 'partially_received', 'received') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('approved', 'ordered', 'partially_received', 'received') then
    return new;
  end if;

  -- The service role and trigger-internal calls have no session; they are the
  -- system, not a person trying to get round a limit.
  if v_actor is null then
    return new;
  end if;

  if new.total_amount > v_limit and not public.is_admin() then
    raise exception
      'A purchase order of % needs administrator approval (the limit is %). Set it to pending approval and ask an administrator.',
      to_char(new.total_amount, 'FM999,999,990.00'),
      to_char(v_limit, 'FM999,999,990.00')
      using errcode = '42501';
  end if;

  -- Approval is attributed to whoever is signed in, never to whoever the
  -- request said. Same reasoning as payments in 0022.
  new.approved_by := v_actor;
  if new.approved_at is null then
    new.approved_at := now();
  end if;

  return new;
end;
$$;

create trigger po_requisition_limit
  before insert or update on public.purchase_orders
  for each row execute function public.enforce_requisition_limit();

revoke all on function public.enforce_requisition_limit() from public, anon, authenticated;


-- ============================================================================
-- 3 · RECEIVING A DELIVERY PUTS THE STOCK AWAY
-- ----------------------------------------------------------------------------
-- Writes a `receipt` movement for every line, which the existing ledger trigger
-- from 0008 turns into an increase in `on_hand`. Going through the ledger rather
-- than updating the balance directly is the whole point of having one: the
-- warehouse balance stays exactly the sum of its movements, and a delivery is
-- auditable back to the purchase order that brought it in.
--
-- IDEMPOTENT, because "did that save?" leads to a second click. A line that has
-- already been fully received is skipped, so receiving twice does not double the
-- stock — the same failure the payment webhook guards against, arrived at from a
-- different direction.
-- ============================================================================

create or replace function public.on_purchase_order_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  line record;
  v_outstanding numeric;
begin
  if new.status <> 'received' or coalesce(old.status, 'draft') = 'received' then
    return new;
  end if;

  for line in
    select id, stock_item_id, quantity, quantity_received, unit_cost
    from public.purchase_order_lines
    where purchase_order_id = new.id
  loop
    v_outstanding := line.quantity - line.quantity_received;
    continue when v_outstanding <= 0;

    insert into public.stock_movements (
      stock_item_id, movement_type, quantity, purchase_order_id, created_by, note
    )
    values (
      line.stock_item_id,
      'receipt',
      v_outstanding,
      new.id,
      (select auth.uid()),
      'Received against ' || new.po_number
    );

    update public.purchase_order_lines
    set quantity_received = quantity
    where id = line.id;

    -- Keep the moving-average cost honest as prices change between orders.
    update public.stock_items
    set unit_cost = line.unit_cost
    where id = line.stock_item_id and line.unit_cost > 0;
  end loop;

  if new.received_at is null then
    new.received_at := now();
  end if;

  perform public.write_audit(
    'Delivery received against ' || new.po_number,
    'purchase_orders',
    new.id::text,
    'info',
    jsonb_build_object('supplier_reference', new.supplier_reference, 'total', new.total_amount)
  );

  return new;
end;
$$;

-- BEFORE, not AFTER, so `received_at` can be set on the row being written
-- rather than requiring a second UPDATE that would re-fire the trigger.
create trigger purchase_order_received
  before update on public.purchase_orders
  for each row execute function public.on_purchase_order_received();

revoke all on function public.on_purchase_order_received() from public, anon, authenticated;


-- ============================================================================
-- 4 · RELEASING A RESERVATION
-- ----------------------------------------------------------------------------
-- `stock_items.reserved` is a running counter rather than a derived total —
-- unlike `on_hand`, which is the sum of the movement ledger, and `amount_paid`,
-- which is the sum of verified payments. `consume_project_stock` decrements it
-- correctly when materials are actually used, but nothing released it when a
-- project was abandoned.
--
-- Deriving `reserved` from `stock_reservations` would be the better shape and is
-- a bigger change than it looks: the reservation rows carry status transitions
-- that the counter does not. This closes the leak without pretending to be that
-- rewrite.
-- ============================================================================

create or replace function public.release_project_reservations(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if (select auth.uid()) is not null
     and not public.has_role('inventory_manager', 'project_engineer', 'admin') then
    raise exception 'Not authorised to release reserved stock' using errcode = '42501';
  end if;

  for r in
    select id, stock_item_id, quantity_held
    from public.stock_reservations
    where project_id = p_project_id and status in ('reserved', 'short')
    for update
  loop
    continue when coalesce(r.quantity_held, 0) <= 0;

    update public.stock_items
    set reserved = greatest(reserved - r.quantity_held, 0)
    where id = r.stock_item_id;

    update public.stock_reservations
    set quantity_held = 0, status = 'released'
    where id = r.id;
  end loop;
end;
$$;

revoke all on function public.release_project_reservations(uuid) from public, anon, authenticated;
grant execute on function public.release_project_reservations(uuid) to authenticated;


/* Cancelling a project releases its hold automatically. Leaving it to whoever
   cancels means it is forgotten, and a forgotten hold is invisible: the stock
   is not missing and not available, and nothing on any screen explains why. */
create or replace function public.on_project_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and coalesce(old.status, 'planning') <> 'cancelled' then
    perform public.release_project_reservations(new.id);

    perform public.write_audit(
      'Project cancelled; reserved stock released',
      'projects',
      new.id::text,
      'warning',
      jsonb_build_object('reference', new.reference)
    );
  end if;
  return new;
end;
$$;

create trigger project_cancelled_releases_stock
  after update on public.projects
  for each row execute function public.on_project_cancelled();

revoke all on function public.on_project_cancelled() from public, anon, authenticated;

comment on function public.release_project_reservations(uuid) is
  'Returns held stock to available. Called on project cancellation and from the inventory screen.';
