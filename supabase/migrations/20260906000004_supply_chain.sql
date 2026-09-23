-- ============================================================================
-- 0004 · SUPPLY CHAIN
-- ----------------------------------------------------------------------------
-- Suppliers, stock, the reservation model, stock movements, purchase orders and
-- the serialised asset registry.
--
-- Implements flow-diagram page S1 (inventory replenishment) and the procurement
-- track of page L1-B.
--
-- ============================================================================
-- THE THREE-NUMBER MODEL
-- ----------------------------------------------------------------------------
--     on_hand    physically in the warehouse
--     reserved   committed to signed contracts
--     available  = on_hand - reserved     <- the ONLY number sales may promise
--
-- Reserving on contract signature is what stops two sales reps promising the
-- same inverter to different customers in the same week.
--
-- CONCURRENCY: reserve_stock_for_project() below does the check and the write
-- inside one transaction with a row lock. Doing the check in JavaScript and
-- then writing lets two simultaneous contracts oversell the same unit, and that
-- failure only shows up as a crew arriving at a site with no inverter.
-- ============================================================================


-- ============================================================================
-- SUPPLIERS
-- ============================================================================

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  email text,
  phone text,
  address text,
  lead_time_days integer not null default 14 check (lead_time_days >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger suppliers_touch
  before update on public.suppliers
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- STOCK ITEMS
-- ============================================================================

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category public.stock_category not null,
  brand text,
  supplier_id uuid references public.suppliers (id) on delete set null,

  on_hand numeric(12, 2) not null default 0 check (on_hand >= 0),
  -- Maintained only by the reservation functions below. Never written directly.
  reserved numeric(12, 2) not null default 0 check (reserved >= 0),
  reorder_point numeric(12, 2) not null default 0 check (reorder_point >= 0),

  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  unit text not null default 'pc',

  -- Panels, inverters and batteries carry serial numbers; rails and connectors
  -- do not. Drives whether the field portal demands a scan.
  is_serialised boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.stock_items.reserved is
  'Committed to signed contracts. available = on_hand - reserved; only that figure may be sold.';

create index stock_items_category_idx on public.stock_items (category);
-- Partial index for the procurement alert, which is the most frequent query on
-- this table and only ever cares about items that have run low.
create index stock_items_low_idx on public.stock_items ((on_hand - reserved))
  where on_hand - reserved <= reorder_point;

create trigger stock_items_touch
  before update on public.stock_items
  for each row execute function public.touch_updated_at();

-- Deferred FK from 0002: a BOM line points at a real catalogue item.
alter table public.quotation_lines
  add constraint quotation_lines_stock_item_fk
  foreign key (stock_item_id) references public.stock_items (id) on delete set null;


-- ============================================================================
-- STOCK RESERVATIONS
-- ----------------------------------------------------------------------------
-- One row per (project, item) commitment. Kept separate from a simple counter
-- on stock_items so that a reservation can be traced back to the project that
-- caused it, released cleanly, and reported on when procurement asks "what is
-- this stock actually for?".
--
-- status 'short' is the procurement track's blocker: the synchronise gate at
-- the bottom of this file refuses dispatch while any line is short.
-- ============================================================================

create type public.reservation_status as enum ('reserved', 'short', 'issued', 'consumed', 'released');

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  stock_item_id uuid not null references public.stock_items (id) on delete restrict,
  quantity numeric(12, 2) not null check (quantity > 0),
  -- How much of `quantity` we actually managed to hold. Below quantity means a
  -- shortfall that procurement must close.
  quantity_held numeric(12, 2) not null default 0 check (quantity_held >= 0),
  status public.reservation_status not null default 'reserved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, stock_item_id)
);

create index stock_reservations_project_idx on public.stock_reservations (project_id);
create index stock_reservations_short_idx on public.stock_reservations (stock_item_id)
  where status = 'short';

create trigger stock_reservations_touch
  before update on public.stock_reservations
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- STOCK MOVEMENTS
-- ----------------------------------------------------------------------------
-- The ledger. Every change to on_hand is a row here, so the warehouse balance
-- is always explainable: you can point at the receipt, the consumption or the
-- adjustment that produced it. An inventory system without a movement log turns
-- every discrepancy into an argument.
-- ============================================================================

create type public.movement_type as enum (
  'receipt',      -- delivery from a supplier
  'issue',        -- picked and loaded for a crew
  'consumption',  -- logged as used on site by a technician
  'return',       -- came back unused
  'adjustment',   -- stock-take correction
  'write_off'     -- damaged or lost
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items (id) on delete restrict,
  movement_type public.movement_type not null,
  -- Signed: positive adds to on_hand, negative removes. The trigger in 0008
  -- applies it, so the ledger and the balance can never disagree.
  quantity numeric(12, 2) not null check (quantity <> 0),
  project_id uuid references public.projects (id) on delete set null,
  purchase_order_id uuid,  -- FK added below, after purchase_orders exists.
  reference text,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index stock_movements_item_idx on public.stock_movements (stock_item_id, created_at desc);
create index stock_movements_project_idx on public.stock_movements (project_id);


-- ============================================================================
-- PURCHASE ORDERS  ·  EXTERNAL PARTY
-- ----------------------------------------------------------------------------
-- Flow-diagram S1. The supplier is not a user of this system, so the inventory
-- manager records confirmation, shipment and delivery on their behalf using the
-- proxy fields described in 0003.
--
-- APPROVAL GATE: a requisition above the inventory manager's authority must be
-- approved by an administrator before the order can be issued. Enforced by a
-- constraint here and a trigger in 0008, not by hiding a button.
-- ============================================================================

create type public.po_status as enum (
  'draft',
  'pending_approval',
  'approved',
  'ordered',
  'partially_received',
  'received',
  'cancelled'
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,

  status public.po_status not null default 'draft',
  total_amount numeric(12, 2) not null default 0 check (total_amount >= 0),

  requested_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,

  -- --- External-party proxy fields -----------------------------------------
  supplier_confirmed_at timestamptz,
  supplier_reference text,
  expected_at date,
  received_at timestamptz,
  recorded_by uuid references public.profiles (id) on delete set null,

  -- Three-way match (PO / delivery receipt / supplier invoice), flow-diagram S1.
  supplier_invoice_ref text,
  matched_at timestamptz,
  matched_by uuid references public.profiles (id) on delete set null,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An order cannot leave the building without an approval on record.
  constraint po_ordered_needs_approval
    check (
      status not in ('ordered', 'partially_received', 'received')
      or (approved_by is not null and approved_at is not null)
    )
);

create index purchase_orders_status_idx on public.purchase_orders (status);
create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id);

create trigger purchase_orders_touch
  before update on public.purchase_orders
  for each row execute function public.touch_updated_at();

alter table public.stock_movements
  add constraint stock_movements_po_fk
  foreign key (purchase_order_id) references public.purchase_orders (id) on delete set null;


create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  stock_item_id uuid not null references public.stock_items (id) on delete restrict,
  quantity numeric(12, 2) not null check (quantity > 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  quantity_received numeric(12, 2) not null default 0 check (quantity_received >= 0),
  line_total numeric(12, 2) generated always as (quantity * unit_cost) stored
);

create index po_lines_po_idx on public.purchase_order_lines (purchase_order_id);


-- ============================================================================
-- SERIALISED ASSET REGISTRY
-- ----------------------------------------------------------------------------
-- Every serial-numbered unit ever installed, mapped to the client and project
-- it sits on. Rows are created from technician barcode scans in the field.
--
-- WHY IT EARNS ITS KEEP: a manufacturer will not honour an RMA without the
-- serial and the install date. A recall needs one query to find every affected
-- roof. A warranty transfer reassigns these exact rows. And the client's
-- /portal/warranty page is just a filtered view of this table.
--
-- If the field scan is skipped the registry has holes, and the claim fails
-- years later when it is far too late to fix — which is why serial capture is a
-- blocking item on the field checklist rather than an optional one.
-- ============================================================================

create type public.asset_status as enum ('installed', 'replaced', 'removed', 'faulty');

create table public.serialised_assets (
  id uuid primary key default gen_random_uuid(),
  serial_number text not null unique,
  stock_item_id uuid references public.stock_items (id) on delete set null,
  product_name text not null,

  project_id uuid references public.projects (id) on delete set null,
  -- Denormalised from the project so a warranty transfer can move ownership
  -- without rewriting project history.
  client_id uuid references public.profiles (id) on delete set null,

  installed_at date,
  warranty_years integer not null default 10 check (warranty_years > 0),
  warranty_expires_at date,
  status public.asset_status not null default 'installed',

  scanned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index serialised_assets_project_idx on public.serialised_assets (project_id);
create index serialised_assets_client_idx on public.serialised_assets (client_id);
create index serialised_assets_expiry_idx on public.serialised_assets (warranty_expires_at);

create trigger serialised_assets_touch
  before update on public.serialised_assets
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- RESERVATION LOGIC
-- ----------------------------------------------------------------------------
-- Runs inside one transaction, locking each stock row before checking it, so
-- two contracts signed at the same moment cannot both claim the last inverter.
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


-- ----------------------------------------------------------------------------
-- Consume reserved stock when a technician logs what was actually used on site.
-- Writes the ledger movement, which in turn adjusts on_hand via the trigger in
-- 0008, and releases the matching reservation.
-- ----------------------------------------------------------------------------
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


-- ============================================================================
-- THE SYNCHRONISE GATE
-- ----------------------------------------------------------------------------
-- Flow-diagram L1-B: permitting and procurement run in parallel and BOTH must
-- finish before the crew is dispatched. Dispatching early means a crew standing
-- on a roof they are not yet permitted to work on, or without the hardware.
--
-- Exposed as a function so the dispatch board, the API and any future
-- automation all ask the same question and get the same answer.
-- ============================================================================

create or replace function public.project_ready_for_dispatch(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- Permitting track: at least one permit exists and none is outstanding.
    -- A project with no permits has not started the track, which is not the
    -- same thing as having finished it.
    exists (select 1 from public.permits where project_id = p_project_id)
    and not exists (
      select 1 from public.permits
      where project_id = p_project_id and status <> 'approved'
    )
    -- Procurement track: nothing still short against the reservation.
    and not exists (
      select 1 from public.stock_reservations
      where project_id = p_project_id and status = 'short'
    );
$$;

comment on function public.project_ready_for_dispatch is
  'True when both the permitting and procurement tracks are complete (flow-diagram L1-B synchronise gate).';
