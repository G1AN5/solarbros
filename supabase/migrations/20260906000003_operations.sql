-- ============================================================================
-- 0003 · OPERATIONS
-- ----------------------------------------------------------------------------
-- Projects, installation milestones, crew assignment, permits, scheduling and
-- preventive maintenance.
--
-- Implements flow-diagram page L1-B (permitting, dispatch, installation,
-- commissioning) and the scheduling spine shared by all four portals.
--
-- ============================================================================
-- THE EXTERNAL-PARTY PATTERN
-- ----------------------------------------------------------------------------
-- Several steps in the process are performed by organisations that will never
-- log into this system: the local government unit, the distribution utility,
-- equipment suppliers, financing partners and manufacturers.
--
-- The flow still has to move. So every external step is recorded by the
-- responsible INTERNAL role on the external party's behalf, and the record
-- always captures three things:
--
--     recorded_by          which employee entered it
--     recorded_at          when they entered it
--     external_reference   the permit number, tracking number or claim number
--                          that makes the entry verifiable later
--
-- This matters. Without it the database cannot distinguish "the utility
-- approved this" from "an employee asserted that the utility approved this" —
-- and only one of those is evidence. Every proxy entry is written to the audit
-- log at 'warning' severity by the triggers in 0008.
-- ============================================================================


-- ============================================================================
-- PROJECTS
-- Created automatically when a contract reaches 'executed'.
-- ============================================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,

  client_id uuid references public.profiles (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  contract_id uuid references public.contracts (id) on delete set null,

  address text not null,
  system_kw numeric(6, 2) not null,
  system_type public.system_type not null,

  contract_value numeric(12, 2) not null check (contract_value >= 0),
  -- Maintained by the payment trigger in 0008, never written by the UI, so the
  -- collected total can never disagree with the payments that produced it.
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),

  status public.project_status not null default 'planning',
  assigned_engineer uuid references public.profiles (id) on delete set null,

  start_date date,
  target_turnover date,
  actual_turnover date,

  -- Set on turnover. Warranty periods are measured from this date, so it is
  -- deliberately separate from actual_turnover, which can be back-dated.
  warranty_start_date date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_client_idx on public.projects (client_id);
create index projects_status_idx on public.projects (status);
create index projects_engineer_idx on public.projects (assigned_engineer);

create trigger projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- PROJECT MILESTONES
-- ----------------------------------------------------------------------------
-- THE MOST IMPORTANT TABLE IN THE SCHEMA.
--
-- These rows are rendered by three different screens: the customer's project
-- tracker, the admin project view and the technician's field updater. Because
-- all three read the same rows, the customer's progress bar can never disagree
-- with what the technician actually ticked off on the roof.
--
-- Completing 'commissioning' triggers the installation-milestone invoice, and
-- every completion queues a notification. Both live in 0008.
-- ============================================================================

create table public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  key public.milestone_key not null,
  label text not null,
  sequence integer not null,
  status public.milestone_status not null default 'pending',
  note text,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A project has each milestone exactly once.
  unique (project_id, key),

  -- 'done' without a timestamp makes the tracker unreadable and breaks the
  -- invoice trigger, which keys off completed_at.
  constraint milestones_done_needs_timestamp
    check (status <> 'done' or completed_at is not null)
);

create index project_milestones_project_idx on public.project_milestones (project_id, sequence);

create trigger project_milestones_touch
  before update on public.project_milestones
  for each row execute function public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- Crew assigned to a project (engineers and technicians).
-- ----------------------------------------------------------------------------
create table public.project_crew (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  crew_role text not null default 'technician',
  assigned_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_crew_user_idx on public.project_crew (user_id);


-- ============================================================================
-- PERMITS  ·  EXTERNAL PARTY
-- ----------------------------------------------------------------------------
-- Flow-diagram L1-B, permitting track. The LGU and the distribution utility
-- review the application; neither uses this system. The project engineer
-- records their decision here.
--
-- Permitting runs in PARALLEL with procurement, and the crew cannot be
-- dispatched until both tracks finish — see project_ready_for_dispatch() below.
-- ============================================================================

create type public.permit_type as enum (
  'lgu_building',
  'electrical',
  'utility_interconnection',
  'net_metering',
  'permission_to_operate'
);

create type public.permit_status as enum (
  'preparing',
  'submitted',
  'under_review',
  'approved',
  'rejected'
);

create table public.permits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  permit_type public.permit_type not null,

  -- Which outside body is deciding, e.g. "Paranaque City Hall", "Meralco".
  authority text not null,

  status public.permit_status not null default 'preparing',
  submitted_at timestamptz,
  decided_at timestamptz,

  -- --- External-party proxy fields (see the header of this file) ------------
  external_reference text,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz,

  fee_amount numeric(10, 2),
  findings text,
  document_id uuid,  -- FK added in 0006, once documents exists.

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A decision must say who recorded it and when. Otherwise nobody can tell
  -- an approval apart from an unexplained status change months later.
  constraint permits_decision_needs_recorder
    check (
      status not in ('approved', 'rejected')
      or (recorded_by is not null and decided_at is not null)
    )
);

create index permits_project_idx on public.permits (project_id);
create index permits_status_idx on public.permits (status);

create trigger permits_touch
  before update on public.permits
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- APPOINTMENTS
-- ----------------------------------------------------------------------------
-- ONE table serving four different screens. The specification listed a
-- "calendar scheduling system" separately under all four portals; they are the
-- same records seen by different audiences:
--
--   public /booking             creates one with status 'requested'
--   /admin/dispatch             assigns crew, moves it to 'dispatched'
--   /field                      the technician works it and completes it
--   /portal/appointments        the client sees the confirmation
--
-- Separate systems would need constant reconciliation. One table cannot
-- disagree with itself.
-- ============================================================================

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  appointment_type public.appointment_type not null,
  status public.appointment_status not null default 'requested',

  scheduled_date date not null,
  time_slot text not null,

  -- A booking can come from a prospect (lead) or an existing customer
  -- (client_id), so both are nullable and at least one must be present.
  lead_id uuid references public.leads (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  ticket_id uuid,  -- FK added in 0006; repair visits raised from a ticket.

  contact_name text not null,
  contact_phone text,
  address text,
  notes text,

  created_by uuid references public.profiles (id) on delete set null,
  cancelled_reason text,
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint appointments_needs_a_subject
    check (lead_id is not null or client_id is not null or project_id is not null)
);

create index appointments_date_idx on public.appointments (scheduled_date, status);
create index appointments_client_idx on public.appointments (client_id);
create index appointments_project_idx on public.appointments (project_id);
-- Partial index: the dispatch board's default view is "what still needs a crew".
create index appointments_unassigned_idx on public.appointments (scheduled_date)
  where status = 'requested';

create trigger appointments_touch
  before update on public.appointments
  for each row execute function public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- Who is going. An appointment can have several technicians, and a technician's
-- /field Today list is a query against this table.
-- ----------------------------------------------------------------------------
create table public.appointment_assignees (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles (id) on delete set null,
  primary key (appointment_id, user_id)
);

create index appointment_assignees_user_idx on public.appointment_assignees (user_id);


-- ============================================================================
-- PREVENTIVE MAINTENANCE
-- ----------------------------------------------------------------------------
-- Flow-diagram L1-D trigger 2. Created automatically when a project closes, then
-- due annually. The scheduler notifies the client and opens booking slots.
-- ============================================================================

create table public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  due_date date not null,
  status public.approval_status not null default 'pending',
  appointment_id uuid references public.appointments (id) on delete set null,
  completed_at timestamptz,
  report_document_id uuid,  -- FK added in 0006.
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index maintenance_due_idx on public.maintenance_schedules (due_date, status);
create index maintenance_project_idx on public.maintenance_schedules (project_id);

create trigger maintenance_touch
  before update on public.maintenance_schedules
  for each row execute function public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- NOTE: the "synchronise gate" function project_ready_for_dispatch() lives at
-- the end of 0004_supply_chain.sql, because it queries stock_reservations and
-- Postgres validates a `language sql` function body at creation time.
-- ----------------------------------------------------------------------------
