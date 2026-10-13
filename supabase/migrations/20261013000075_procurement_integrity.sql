-- ============================================================================
-- 0075 · PROCUREMENT AND STOCK INTEGRITY
-- ----------------------------------------------------------------------------
-- Three holes found walking the purchasing and inventory screens role by role.
--
-- 1. A PURCHASE ORDER'S TOTAL WAS WHATEVER THE BROWSER SAID IT WAS.
--    `enforce_requisition_limit` (0026) compares `total_amount` with the
--    approval limit — and `total_amount` was sent by the page, beside lines
--    that were inserted separately and could be edited afterwards. An order
--    could be raised at ₱1 with ₱500,000 of lines, approved inside the limit,
--    and the lines changed again after approval. The total now comes from the
--    lines, always, and the lines are fixed once the order is approved.
--
-- 2. ANY SIGNED-IN EMPLOYEE COULD WRITE TO THE STOCK LEDGER DIRECTLY.
--    `movements_insert_internal` let a technician, a sales rep or the
--    accountant insert a 'receipt' or an 'adjustment' through the API and
--    raise a warehouse balance. The screens never offered it; the policy did.
--    Field consumption goes through `consume_project_stock` and deliveries
--    through the receiving trigger, both SECURITY DEFINER, so neither depends
--    on this policy.
--
-- 3. A CUSTOMER COULD FETCH A SITE PHOTO THE OFFICE HAD HIDDEN.
--    The photo ROW was hidden from them; the FILE was not — the storage policy
--    checked only that the folder was their project's.
-- ============================================================================


-- ============================================================================
-- 1. PURCHASE ORDER TOTALS COME FROM THEIR LINES
-- ============================================================================

create or replace function public.purchase_order_total(p_purchase_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.quantity * l.unit_cost), 0)
  from public.purchase_order_lines l
  where l.purchase_order_id = p_purchase_order_id;
$$;

revoke all on function public.purchase_order_total(uuid) from public, anon, authenticated;


/* On the order itself. Named to sort before `po_requisition_limit`, so the
   limit is checked against the derived figure rather than the submitted one
   (BEFORE triggers fire in name order). */
create or replace function public.purchase_order_derive_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.total_amount := public.purchase_order_total(new.id);
  return new;
end;
$$;

revoke all on function public.purchase_order_derive_total() from public, anon, authenticated;

drop trigger if exists po_derive_total on public.purchase_orders;
create trigger po_derive_total
  before insert or update on public.purchase_orders
  for each row execute function public.purchase_order_derive_total();


/* On the lines: fixed once the order is approved. Receiving still updates
   `quantity_received`, which is the only column allowed to move. */
create or replace function public.purchase_order_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
  v_status public.po_status;
  v_number text;
begin
  select po.status, po.po_number into v_status, v_number
  from public.purchase_orders po
  where po.id = v_po;

  -- No order (it is being deleted, and its lines with it) or still a draft.
  if v_status is null or v_status in ('draft', 'pending_approval') then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and new.purchase_order_id = old.purchase_order_id
     and new.stock_item_id = old.stock_item_id
     and new.quantity = old.quantity
     and new.unit_cost = old.unit_cost then
    return new;
  end if;

  raise exception using
    message = format(
      'The lines of %s are fixed now that it is approved. Cancel it and raise a new order instead.',
      v_number
    ),
    errcode = '42501';
end;
$$;

revoke all on function public.purchase_order_lines_guard() from public, anon, authenticated;

drop trigger if exists purchase_order_lines_guard on public.purchase_order_lines;
create trigger purchase_order_lines_guard
  before insert or update or delete on public.purchase_order_lines
  for each row execute function public.purchase_order_lines_guard();


/* And the order's total follows its lines. The update re-fires
   `po_derive_total`, which is what actually writes the figure. */
create or replace function public.purchase_order_lines_retotal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders po
  set total_amount = public.purchase_order_total(v_po)
  where po.id = v_po
    and po.total_amount is distinct from public.purchase_order_total(v_po);
  return null;
end;
$$;

revoke all on function public.purchase_order_lines_retotal() from public, anon, authenticated;

drop trigger if exists purchase_order_lines_retotal on public.purchase_order_lines;
create trigger purchase_order_lines_retotal
  after insert or delete or update of quantity, unit_cost, purchase_order_id
  on public.purchase_order_lines
  for each row execute function public.purchase_order_lines_retotal();


-- Existing orders: bring every stored total into line with its lines.
update public.purchase_orders po
set total_amount = public.purchase_order_total(po.id)
where po.total_amount is distinct from public.purchase_order_total(po.id);


-- ============================================================================
-- 2. THE STOCK LEDGER IS WRITTEN BY THE WAREHOUSE
-- ============================================================================

drop policy if exists movements_insert_internal on public.stock_movements;
drop policy if exists movements_insert_inventory on public.stock_movements;
create policy movements_insert_inventory on public.stock_movements
  for insert to authenticated
  with check (public.has_role('inventory_manager', 'project_engineer', 'admin'));


-- ============================================================================
-- 3. A HIDDEN PHOTO IS HIDDEN, FILE AND ALL
-- ============================================================================

drop policy if exists "clients read their own site photos" on storage.objects;
create policy "clients read their own site photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'site-photos'
    and public.owns_project(((storage.foldername(name))[1])::uuid)
    and exists (
      select 1
      from public.site_photos sp
      where sp.storage_path = objects.name
        and sp.is_client_visible
    )
  );


-- ============================================================================
-- 4. MONEY COLLECTED, BY THE MONTH IT ARRIVED
-- ============================================================================
-- The analytics chart bucketed what had been paid by the month the INVOICE
-- was issued — a down payment invoiced in September and paid in October
-- counted as September's money — and the sales team, who use the page, cannot
-- read individual payments at all. This returns totals only: verified payments
-- by the month they were received, less refunds by the month they went back.

create or replace function public.monthly_collections(p_months integer default 8)
returns table (month date, collected numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_role('admin', 'accountant', 'sales') then
    raise exception 'Only the office can read collection totals.' using errcode = '42501';
  end if;

  return query
  with months as (
    select (date_trunc('month', now() at time zone 'Asia/Manila')
            - make_interval(months => g))::date as month
    from generate_series(0, least(greatest(coalesce(p_months, 8), 1), 36) - 1) as g
  ),
  paid as (
    select date_trunc('month', p.paid_at at time zone 'Asia/Manila')::date as month,
           sum(p.amount) as amount
    from public.payments p
    where p.verified
    group by 1
  ),
  refunded as (
    select date_trunc('month', r.confirmed_at at time zone 'Asia/Manila')::date as month,
           sum(r.amount) as amount
    from public.payment_refunds r
    where r.status = 'confirmed' and r.confirmed_at is not null
    group by 1
  )
  select m.month, coalesce(pd.amount, 0) - coalesce(rf.amount, 0)
  from months m
  left join paid pd on pd.month = m.month
  left join refunded rf on rf.month = m.month
  order by m.month;
end;
$$;

revoke all on function public.monthly_collections(integer) from public, anon;
grant execute on function public.monthly_collections(integer) to authenticated;


-- ============================================================================
-- 5. A CUSTOMER SEES THE SAME PAYMENT SCHEDULE THE CONTRACT WILL CARRY
-- ============================================================================
-- The quotation a customer prints from their portal shows the stage split. It
-- was reading defaults, because these three rows were readable by staff only —
-- and the split is printed on every contract the customer signs anyway.

update public.settings
set is_public = true
where key in ('finance.down_payment_pct', 'finance.delivery_pct', 'finance.commissioning_pct');
