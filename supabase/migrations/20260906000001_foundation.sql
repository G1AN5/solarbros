-- ============================================================================
-- 0001 · FOUNDATION
-- ----------------------------------------------------------------------------
-- Enums, RLS helper functions, user profiles, the audit trail and the
-- notification outbox. Everything else in the schema depends on this file.
--
-- CONVENTIONS USED THROUGHOUT THE WHOLE SCHEMA
--   * Primary keys are uuid, defaulted with gen_random_uuid().
--   * Every table carries created_at, and mutable tables carry updated_at
--     maintained by the touch_updated_at() trigger.
--   * Enumerated values are real Postgres enum types, so they map 1:1 onto the
--     string-union types in src/types/domain.ts and the database rejects a
--     typo instead of silently storing it.
--   * RLS is enabled on EVERY table in this schema. Policies live in
--     0007_rls.sql so the access model can be read in one sitting.
-- ============================================================================

-- gen_random_uuid() is core Postgres from v13 onwards, so nothing is needed for
-- it here. pgcrypto is still required for password hashing in the seed, and on
-- Supabase it is pre-installed in the `extensions` schema rather than `public` —
-- which means calls to crypt() and gen_salt() must be schema-qualified.
create extension if not exists pgcrypto with schema extensions;


-- ============================================================================
-- ENUM TYPES
-- ============================================================================

-- The seven roles from the RBAC section of the specification.
create type public.user_role as enum (
  'client',
  'sales',
  'project_engineer',
  'inventory_manager',
  'accountant',
  'technician',
  'admin'
);

-- Sales pipeline. Order here is the Kanban column order in /admin/crm.
create type public.lead_stage as enum (
  'new',
  'quoted',
  'site_visit',
  'contract',
  'installed',
  'lost'
);

create type public.lead_source as enum (
  'estimator',
  'quote_request',
  'referral',
  'walk_in',
  'facebook'
);

create type public.system_type as enum ('on_grid', 'hybrid', 'off_grid');

create type public.segment as enum ('residential', 'commercial');

-- The canonical installation lifecycle. The client tracker, the admin project
-- board and the technician updater all render this same list.
create type public.milestone_key as enum (
  'engineering_survey',
  'permitting',
  'structural_mounting',
  'dc_wiring',
  'ac_wiring',
  'commissioning',
  'turnover'
);

create type public.milestone_status as enum ('pending', 'in_progress', 'done', 'blocked');

create type public.project_status as enum ('planning', 'in_progress', 'on_hold', 'completed', 'cancelled');

create type public.quotation_status as enum (
  'draft',
  'pending_approval',
  'sent',
  'accepted',
  'rejected',
  'expired'
);

create type public.contract_status as enum (
  'draft',
  'awaiting_client',
  'awaiting_company',
  'executed',
  'cancelled'
);

create type public.appointment_type as enum (
  'virtual_consultation',
  'site_survey',
  'installation',
  'maintenance',
  'repair'
);

create type public.appointment_status as enum (
  'requested',
  'confirmed',
  'dispatched',
  'in_progress',
  'completed',
  'cancelled'
);

create type public.stock_category as enum (
  'panel',
  'inverter',
  'battery',
  'racking',
  'charge_controller',
  'accessory'
);

create type public.invoice_status as enum ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void');

-- Staged payments: down payment, on delivery, on commissioning, retention.
create type public.payment_stage as enum ('down_payment', 'delivery', 'commissioning', 'retention');

create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');

create type public.ticket_status as enum (
  'open',
  'in_progress',
  'awaiting_client',
  'resolved',
  'closed'
);

create type public.ticket_category as enum (
  'hardware_fault',
  'performance',
  'billing',
  'maintenance',
  'upgrade',
  'other'
);

create type public.warranty_request_type as enum ('registration', 'transfer');

create type public.approval_status as enum ('pending', 'approved', 'rejected');

create type public.document_kind as enum (
  'quotation',
  'contract',
  'invoice',
  'receipt',
  'warranty_certificate',
  'turnover_certificate',
  'inspection_report',
  'permit',
  'survey_report',
  'as_built',
  'proof_of_sale',
  'other'
);

create type public.audit_severity as enum ('info', 'warning', 'critical');

create type public.notification_channel as enum ('in_app', 'email', 'sms');

-- Notifications are queued first and dispatched by a background worker, so the
-- outbox can be inspected and demonstrated without live email/SMS credentials.
create type public.delivery_status as enum ('queued', 'sent', 'failed', 'skipped');


-- ============================================================================
-- SHARED TRIGGER FUNCTIONS
-- ============================================================================

-- Keeps updated_at honest without the application having to remember.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================================
-- PROFILES
-- ----------------------------------------------------------------------------
-- One row per authenticated user, carrying the role. auth.users is managed by
-- Supabase and cannot hold application columns, so the role lives here.
--
-- WHY THE ROLE IS NOT READ FROM THE CLIENT: the browser can claim any role it
-- likes. Every policy in 0007_rls.sql resolves the role through
-- current_user_role() below, which reads this table server-side.
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role public.user_role not null default 'client',
  phone text,
  address text,
  avatar_initials text generated always as (
    upper(left(split_part(full_name, ' ', 1), 1) || left(split_part(full_name, ' ', 2), 1))
  ) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile for each auth user. The role column drives every RLS policy.';

create index profiles_role_idx on public.profiles (role);

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- Automatically create a profile when someone signs up.
--
-- Without this, a new auth user has no role and every policy denies them. The
-- role defaults to 'client'; staff are promoted by an administrator, never by
-- self-service, so a stranger cannot sign up as an accountant.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- RLS HELPER FUNCTIONS
-- ----------------------------------------------------------------------------
-- These are the backbone of the whole access model.
--
-- WHY THEY ARE security definer: a policy on public.profiles that itself reads
-- public.profiles would recurse infinitely. A SECURITY DEFINER function runs as
-- its owner and bypasses RLS on the tables it touches, breaking the cycle.
--
-- WHY search_path IS PINNED TO EMPTY: a SECURITY DEFINER function with a
-- mutable search_path can be hijacked by a caller who creates a same-named
-- table in a schema earlier on the path. Pinning it and fully qualifying every
-- reference closes that hole.
-- ============================================================================

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

comment on function public.current_user_role is
  'Role of the calling user, resolved server-side. Never trust a role sent by the browser.';

-- True for any internal staff member (everyone who may open /admin).
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_user_role() in (
      'sales', 'project_engineer', 'inventory_manager', 'accountant', 'admin'
    ),
    false
  );
$$;

-- True for staff OR technicians: anyone employed by the company.
create or replace function public.is_internal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() <> 'client', false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

-- Membership test used by the more specific policies, e.g. has_role('accountant','admin').
create or replace function public.has_role(variadic roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = any (roles), false);
$$;


-- ============================================================================
-- AUDIT LOG
-- ----------------------------------------------------------------------------
-- Append-only record of privileged actions, required by the governance section
-- of the specification.
--
-- HOW IT IS MADE GENUINELY IMMUTABLE
--   1. No UPDATE or DELETE policy exists (see 0007_rls.sql), so RLS denies both.
--   2. UPDATE and DELETE are revoked at the grant level as a second layer.
--   3. Rows are written by database triggers (0008_automation.sql), not by
--      application code, because application code can be bypassed.
-- An audit log an administrator can quietly edit is not an audit log.
-- ============================================================================

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  actor_role public.user_role,
  action text not null,
  entity text not null,
  entity_id text,
  severity public.audit_severity not null default 'info',
  metadata jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only. Written by triggers. No UPDATE or DELETE is permitted to anyone, including admins.';

create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_severity_idx on public.audit_log (severity) where severity <> 'info';


-- ----------------------------------------------------------------------------
-- Convenience writer used by the automation triggers in 0008.
-- ----------------------------------------------------------------------------
create or replace function public.write_audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_severity public.audit_severity default 'info',
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_role public.user_role;
begin
  select full_name, role into v_name, v_role
  from public.profiles
  where id = (select auth.uid());

  insert into public.audit_log (actor_id, actor_name, actor_role, action, entity, entity_id, severity, metadata)
  values ((select auth.uid()), coalesce(v_name, 'system'), v_role, p_action, p_entity, p_entity_id, p_severity, p_metadata);
end;
$$;


-- ============================================================================
-- NOTIFICATIONS (outbox)
-- ----------------------------------------------------------------------------
-- One table feeds all three delivery channels. Rows are inserted by triggers
-- and application code, then picked up by an Edge Function that actually sends
-- the email or SMS and stamps delivery_status.
--
-- Keeping the queue in the database rather than firing a request inline means
-- the outbox is inspectable: you can prove a milestone notification was
-- generated even when no email provider is configured, which is exactly what a
-- demonstration needs.
-- ============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  -- Kept for prospects who have no account yet (estimator and booking flows).
  to_email text,
  to_phone text,
  title text not null,
  body text not null,
  channel public.notification_channel not null default 'in_app',
  category text not null default 'general',
  entity text,
  entity_id text,
  read boolean not null default false,
  delivery_status public.delivery_status not null default 'queued',
  delivery_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, read, created_at desc);
create index notifications_outbox_idx on public.notifications (delivery_status, created_at)
  where delivery_status = 'queued';


-- ----------------------------------------------------------------------------
-- Per-user channel preferences, so someone can opt out of SMS without losing
-- milestone emails. Safety-critical notices ignore these.
-- ----------------------------------------------------------------------------
create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  milestone_email boolean not null default true,
  milestone_sms boolean not null default false,
  appointment_email boolean not null default true,
  appointment_sms boolean not null default true,
  billing_email boolean not null default true,
  billing_sms boolean not null default false,
  marketing_email boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();
