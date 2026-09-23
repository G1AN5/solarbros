-- ============================================================================
-- 0005 · FINANCE & PEOPLE
-- ----------------------------------------------------------------------------
-- Staged invoices, payments, sales commissions, technician time logs and
-- payroll.
--
-- Implements the money spine of flow-diagram pages L1-A (down payment),
-- L1-B (installation milestone invoice) and L1-C (final billing, collections,
-- commission release and payroll).
--
-- THE CENTRAL RULE: invoices are not typed by hand, they are TRIGGERED BY
-- MILESTONES.
--
--     contract executed        -> down-payment invoice
--     materials delivered      -> delivery invoice
--     commissioning complete   -> final invoice
--
-- That coupling is what keeps billing honest: an invoice cannot be raised for
-- work that has not happened, because the milestone is what raises it. The
-- triggers live in 0008_automation.sql.
-- ============================================================================


-- ============================================================================
-- INVOICES
-- ============================================================================

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  project_id uuid not null references public.projects (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete set null,

  stage public.payment_stage not null,
  amount numeric(12, 2) not null check (amount > 0),
  -- Maintained by the payment trigger in 0008. Never written by the UI, so the
  -- paid total can never disagree with the payments that produced it.
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  balance numeric(12, 2) generated always as (amount - amount_paid) stored,

  status public.invoice_status not null default 'draft',
  issued_at date,
  due_at date,
  paid_at timestamptz,

  -- Which milestone raised it, so an auditor can trace the charge back to the
  -- work that justified it.
  triggered_by_milestone public.milestone_key,

  notes text,
  pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One invoice per stage per project. Without this, a retried trigger or a
  -- double-click bills the customer twice for the same milestone.
  unique (project_id, stage)
);

create index invoices_project_idx on public.invoices (project_id);
create index invoices_client_idx on public.invoices (client_id);
create index invoices_status_idx on public.invoices (status);
-- Partial index for the collections view, which only ever looks at what is owed.
create index invoices_outstanding_idx on public.invoices (due_at)
  where status in ('sent', 'partially_paid', 'overdue');

create trigger invoices_touch
  before update on public.invoices
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- PAYMENTS
-- ----------------------------------------------------------------------------
-- Recorded and reconciled in-app rather than captured through a live gateway.
--
-- WHY: taking card details directly puts the whole application into PCI-DSS
-- scope, which is a compliance project in its own right. Recording a payment
-- that arrived by bank transfer, GCash or cheque is how most Philippine solar
-- contracts are actually settled anyway, and it keeps the ledger complete and
-- fully demonstrable. A gateway can be added later as one more payment_method
-- without changing anything else in this schema.
-- ============================================================================

create type public.payment_method as enum (
  'bank_transfer',
  'cash',
  'cheque',
  'gcash',
  'maya',
  'credit_card',
  'financing'
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  payment_method public.payment_method not null default 'bank_transfer',

  -- Deposit slip number, GCash reference, cheque number.
  reference text,
  paid_at timestamptz not null default now(),

  -- Reconciliation: recorded first, then verified against the bank statement.
  -- Only a verified payment counts towards amount_paid (enforced in 0008).
  verified boolean not null default false,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,

  recorded_by uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index payments_invoice_idx on public.payments (invoice_id);
create index payments_unverified_idx on public.payments (created_at) where not verified;


-- ============================================================================
-- COMMISSIONS
-- Released on project closure, flow-diagram step C10.
-- ============================================================================

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  rate_pct numeric(5, 2),
  status public.approval_status not null default 'pending',
  released_at timestamptz,
  released_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, project_id)
);

create index commissions_user_idx on public.commissions (user_id, status);


-- ============================================================================
-- TIME LOGS
-- ----------------------------------------------------------------------------
-- Technician clock-in and clock-out per job, captured in the field portal.
-- These rows are the raw material of payroll, which is why the geotag is kept:
-- it is what distinguishes "was on site" from "said they were on site".
-- ============================================================================

create table public.time_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,

  clock_in timestamptz not null,
  clock_out timestamptz,
  -- Generated, so the hours can never be edited to disagree with the timestamps.
  hours numeric(6, 2) generated always as (
    case
      when clock_out is null then 0
      else round(extract(epoch from (clock_out - clock_in)) / 3600.0, 2)
    end
  ) stored,

  -- Geotag of the check-in, confirming site attendance.
  latitude numeric(10, 7),
  longitude numeric(10, 7),

  note text,
  created_at timestamptz not null default now(),

  constraint time_logs_out_after_in check (clock_out is null or clock_out > clock_in)
);

create index time_logs_user_idx on public.time_logs (user_id, clock_in desc);
create index time_logs_project_idx on public.time_logs (project_id);


-- ============================================================================
-- PAYROLL
-- ----------------------------------------------------------------------------
-- WARNING · DELIBERATELY INCOMPLETE, as the specification scoped it.
--
-- The tables below record hours, overtime and commissions, and produce a gross
-- figure. They do NOT compute statutory deductions: SSS, PhilHealth, Pag-IBIG,
-- BIR withholding tax, 13th-month pay or DOLE overtime premiums.
--
-- Those rules change, carry legal consequences when wrong, and deserve to be
-- scoped separately or handed to dedicated payroll software that this schema
-- exports to. Treat `gross_pay` as an input to that system, not as a payslip.
-- ============================================================================

create type public.payroll_status as enum ('draft', 'pending_approval', 'approved', 'paid');

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status public.payroll_status not null default 'draft',
  total_gross numeric(14, 2) not null default 0,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (period_start, period_end),
  constraint payroll_period_ordered check (period_end >= period_start)
);

create trigger payroll_runs_touch
  before update on public.payroll_runs
  for each row execute function public.touch_updated_at();


create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,

  regular_hours numeric(8, 2) not null default 0,
  overtime_hours numeric(8, 2) not null default 0,
  base_pay numeric(12, 2) not null default 0,
  overtime_pay numeric(12, 2) not null default 0,
  commission_pay numeric(12, 2) not null default 0,
  gross_pay numeric(12, 2) generated always as (base_pay + overtime_pay + commission_pay) stored,

  created_at timestamptz not null default now(),
  unique (payroll_run_id, user_id)
);

create index payroll_lines_run_idx on public.payroll_lines (payroll_run_id);
create index payroll_lines_user_idx on public.payroll_lines (user_id);
