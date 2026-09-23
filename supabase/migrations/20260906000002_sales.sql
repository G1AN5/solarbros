-- ============================================================================
-- 0002 · SALES
-- ----------------------------------------------------------------------------
-- Packages, leads, appliance-level estimates, quotations with their bill of
-- materials, and signed contracts.
--
-- This file implements flow-diagram page L1-A, steps A3 through A34:
--
--   estimator / contact form
--        -> lead (scored, auto-assigned)
--        -> qualification
--        -> site survey
--        -> engineering design + BOM
--        -> quotation (discount approval if outside authority)
--        -> contract (e-signed by both sides)
--        -> down-payment invoice   [created in 0005_finance_people.sql]
-- ============================================================================


-- ============================================================================
-- PACKAGES
-- Pre-priced offers shown on the public /packages page and used as the starting
-- point for a quotation.
-- ============================================================================

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  system_type public.system_type not null,
  size_kw numeric(6, 2) not null check (size_kw > 0),
  price_from numeric(12, 2) not null check (price_from >= 0),
  segment public.segment not null default 'residential',
  featured boolean not null default false,
  ideal_for text,
  inclusions text[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger packages_touch
  before update on public.packages
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- LEADS
-- ----------------------------------------------------------------------------
-- Every prospect, from an anonymous estimator submission through to a signed
-- customer. Three entry points feed this one table and are distinguished by
-- `source`, which is what makes lead scoring meaningful:
--
--   /estimator        -> 'estimator'      anonymous, lower intent
--   /contact          -> 'quote_request'  asked for a person, higher intent
--   /portal/upgrade   -> 'referral'       existing customer, highest intent
-- ============================================================================

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  location text,
  address text,

  -- Sizing inputs captured at first contact.
  monthly_bill numeric(10, 2),
  estimated_kw numeric(6, 2),

  stage public.lead_stage not null default 'new',
  source public.lead_source not null default 'estimator',

  -- 0-100 heuristic. Recomputed by score_lead() in 0008_automation.sql so the
  -- weighting lives in one place and sales management can tune it without a
  -- code deploy.
  score integer not null default 0 check (score between 0 and 100),

  assigned_to uuid references public.profiles (id) on delete set null,

  -- Qualification answers, flow-diagram step A10.
  qualified boolean,
  in_service_area boolean,
  owns_property boolean,
  budget_range text,
  is_decision_maker boolean,
  timeline text,
  qualification_notes text,

  -- Populated once the opportunity closes, either way.
  converted_client_id uuid references public.profiles (id) on delete set null,
  lost_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A lead that is marked lost must say why. Sales reviews depend on it, and
  -- without the constraint the field is silently left empty every time.
  constraint leads_lost_needs_reason
    check (stage <> 'lost' or lost_reason is not null)
);

create index leads_stage_idx on public.leads (stage);
create index leads_assigned_idx on public.leads (assigned_to);
create index leads_score_idx on public.leads (score desc);
create index leads_created_idx on public.leads (created_at desc);

create trigger leads_touch
  before update on public.leads
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- ESTIMATES
-- ----------------------------------------------------------------------------
-- One row per run of the public appliance estimator. Stored in full rather than
-- summarised, because the appliance list is the single most valuable thing a
-- prospect ever gives us: it tells the engineer what the household actually
-- runs and when, which no monthly-bill figure can.
--
-- `appliances` is jsonb because its shape is owned by the estimator UI and will
-- change as the catalogue grows. Normalising it into rows would buy nothing —
-- nothing joins against an individual appliance line.
-- ============================================================================

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete cascade,

  -- Denormalised so an anonymous estimate can exist before a lead is created.
  contact_email text,

  -- [{ applianceId, quantity, hoursPerDay, isInverterType, custom }]
  appliances jsonb not null default '[]'::jsonb,
  usage_pattern text not null default 'balanced',
  region_id text not null default 'ncr',
  rate_per_kwh numeric(6, 2),
  roof_area_sqm numeric(8, 2),
  stated_monthly_bill numeric(10, 2),

  -- Computed outputs, snapshotted so a re-run with different constants does not
  -- silently rewrite what the customer was already shown.
  peak_load_w integer not null default 0,
  daily_wh integer not null default 0,
  monthly_kwh integer not null default 0,
  recommended_kw numeric(6, 2),
  system_type public.system_type,
  panel_count integer,
  inverter_kw numeric(6, 2),
  battery_count integer not null default 0,
  estimated_cost numeric(12, 2),
  monthly_savings numeric(10, 2),
  payback_years numeric(5, 1),

  pdf_path text,
  created_at timestamptz not null default now()
);

create index estimates_lead_idx on public.estimates (lead_id);
create index estimates_created_idx on public.estimates (created_at desc);


-- ============================================================================
-- QUOTATIONS
-- ----------------------------------------------------------------------------
-- Versioned. Revising a quotation creates a new version rather than editing the
-- old one, so "what exactly did we send them in August?" always has an answer.
--
-- DISCOUNT AUTHORITY (flow-diagram step A25): a discount beyond a sales rep's
-- authority moves the quotation to 'pending_approval' and it cannot be sent
-- until an administrator approves. Enforced by a trigger in 0008, not by the UI.
-- ============================================================================

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  lead_id uuid not null references public.leads (id) on delete cascade,
  package_id uuid references public.packages (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null,

  version integer not null default 1,
  system_kw numeric(6, 2) not null,
  system_type public.system_type not null,
  panel_count integer,
  battery_count integer not null default 0,

  material_cost numeric(12, 2) not null default 0,
  labour_cost numeric(12, 2) not null default 0,
  margin_pct numeric(5, 2) not null default 35,
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  total_price numeric(12, 2) not null default 0,

  status public.quotation_status not null default 'draft',
  prepared_by uuid references public.profiles (id) on delete set null,

  -- Populated only when the discount exceeded the rep's authority.
  discount_approved_by uuid references public.profiles (id) on delete set null,
  discount_approved_at timestamptz,

  valid_until date,
  sent_at timestamptz,
  responded_at timestamptz,
  rejection_reason text,
  pdf_path text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (lead_id, version)
);

create index quotations_lead_idx on public.quotations (lead_id);
create index quotations_status_idx on public.quotations (status);

create trigger quotations_touch
  before update on public.quotations
  for each row execute function public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- BILL OF MATERIALS
-- Generated from the chosen package, never typed by hand. That is the point:
-- a quotation and the materials it commits can never drift apart, and margin is
-- visible before the quote is sent rather than discovered afterwards.
-- The stock_item_id link is what lets 0004 reserve the right units on signing.
-- ----------------------------------------------------------------------------
create table public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  stock_item_id uuid,  -- FK added in 0004, after stock_items exists.
  description text not null,
  quantity numeric(10, 2) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_total numeric(12, 2) generated always as (quantity * unit_price) stored,
  sort_order integer not null default 0
);

create index quotation_lines_quotation_idx on public.quotation_lines (quotation_id);


-- ============================================================================
-- CONTRACTS
-- ----------------------------------------------------------------------------
-- Signed by the client in the portal, then counter-signed by an administrator
-- (flow-diagram steps A33-A34). Both signatures are recorded with a timestamp
-- and the IP they came from, because a contract nobody can prove was signed is
-- not worth having.
--
-- Executing a contract is what creates the project and reserves the stock. That
-- chain lives in 0008_automation.sql.
-- ============================================================================

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  quotation_id uuid not null references public.quotations (id) on delete restrict,
  lead_id uuid not null references public.leads (id) on delete restrict,
  client_id uuid references public.profiles (id) on delete set null,

  contract_value numeric(12, 2) not null check (contract_value > 0),

  -- Staged payment split, as percentages. Must total 100.
  down_payment_pct numeric(5, 2) not null default 50,
  delivery_pct numeric(5, 2) not null default 35,
  commissioning_pct numeric(5, 2) not null default 15,

  financing_required boolean not null default false,
  financing_approved boolean,
  financing_partner text,

  status public.contract_status not null default 'draft',

  client_signed_at timestamptz,
  client_signature_name text,
  client_signature_ip inet,
  company_signed_at timestamptz,
  company_signed_by uuid references public.profiles (id) on delete set null,

  pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A payment schedule that does not add up to the contract value would issue
  -- invoices that never fully bill the customer. Catch it at write time.
  constraint contracts_stages_total_100
    check (down_payment_pct + delivery_pct + commissioning_pct = 100),

  -- 'executed' is the state that triggers project creation and stock
  -- reservation, so it must never be reachable without both signatures.
  constraint contracts_executed_needs_both_signatures
    check (
      status <> 'executed'
      or (client_signed_at is not null and company_signed_at is not null)
    )
);

create index contracts_client_idx on public.contracts (client_id);
create index contracts_status_idx on public.contracts (status);

create trigger contracts_touch
  before update on public.contracts
  for each row execute function public.touch_updated_at();
