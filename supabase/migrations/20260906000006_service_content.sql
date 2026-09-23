-- ============================================================================
-- 0006 · SERVICE & CONTENT
-- ----------------------------------------------------------------------------
-- Support tickets, RMA claims, warranty requests, the document vault, customer
-- reviews and the public portfolio.
--
-- Implements flow-diagram page L1-D (after-sales, all three triggers) and the
-- documentation and review steps of page L1-C.
-- ============================================================================


-- ============================================================================
-- SUPPORT TICKETS
-- ----------------------------------------------------------------------------
-- One model serves both fault reports and maintenance requests. The
-- specification listed them separately, but both follow the identical
-- lifecycle: triage -> assign -> dispatch -> resolve. The `category` column is
-- the only thing that differs, and splitting them into two tables would have
-- meant maintaining two copies of that lifecycle.
--
-- warranty_covered is decided at triage (flow-diagram D3). If it is false the
-- client gets a billable service quotation and must approve it before anyone is
-- dispatched.
-- ============================================================================

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  subject text not null,
  description text,

  client_id uuid references public.profiles (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,

  priority public.ticket_priority not null default 'normal',
  status public.ticket_status not null default 'open',
  category public.ticket_category not null default 'other',

  -- Triage outcome.
  warranty_covered boolean,
  triaged_by uuid references public.profiles (id) on delete set null,
  triaged_at timestamptz,

  -- Billable path: the client must approve before a visit is scheduled.
  billable_quote_amount numeric(12, 2),
  billable_approved boolean,

  assigned_to uuid references public.profiles (id) on delete set null,
  resolution text,
  resolved_at timestamptz,
  satisfaction_rating integer check (satisfaction_rating between 1 and 5),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tickets_client_idx on public.tickets (client_id);
create index tickets_status_idx on public.tickets (status);
create index tickets_assigned_idx on public.tickets (assigned_to);
-- Partial index for the triage queue: urgent work that is still open.
create index tickets_urgent_open_idx on public.tickets (created_at)
  where priority = 'urgent' and status not in ('resolved', 'closed');

create trigger tickets_touch
  before update on public.tickets
  for each row execute function public.touch_updated_at();

-- Deferred FK from 0003: a repair visit raised from a ticket.
alter table public.appointments
  add constraint appointments_ticket_fk
  foreign key (ticket_id) references public.tickets (id) on delete set null;


-- ----------------------------------------------------------------------------
-- Conversation thread. `is_internal` keeps staff notes off the client's screen
-- while still attaching them to the ticket, so a handover between two staff
-- members does not have to happen in a side channel the record never sees.
-- ----------------------------------------------------------------------------
create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);


-- ============================================================================
-- RMA CLAIMS  ·  EXTERNAL PARTY
-- ----------------------------------------------------------------------------
-- Flow-diagram D6-D8. The manufacturer assesses the claim and ships a
-- replacement; they do not use this system, so the inventory manager records
-- each step on their behalf using the proxy fields described in 0003.
--
-- The claim is anchored to a serialised asset because that is what a
-- manufacturer requires: without the serial and the install date there is no
-- claim to make.
-- ============================================================================

create type public.rma_status as enum (
  'draft',
  'filed',
  'under_assessment',
  'approved',
  'rejected',
  'replacement_received',
  'closed'
);

create table public.rma_claims (
  id uuid primary key default gen_random_uuid(),
  claim_reference text not null unique,
  serialised_asset_id uuid not null references public.serialised_assets (id) on delete restrict,
  ticket_id uuid references public.tickets (id) on delete set null,

  manufacturer text not null,
  fault_description text not null,
  status public.rma_status not null default 'draft',

  -- --- External-party proxy fields -----------------------------------------
  external_reference text,
  filed_at timestamptz,
  decision_at timestamptz,
  decision_notes text,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz,

  -- The unit that came back, once it is scanned into the registry.
  replacement_asset_id uuid references public.serialised_assets (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint rma_decision_needs_recorder
    check (
      status not in ('approved', 'rejected', 'replacement_received')
      or (recorded_by is not null and decision_at is not null)
    )
);

create index rma_claims_asset_idx on public.rma_claims (serialised_asset_id);
create index rma_claims_status_idx on public.rma_claims (status);

create trigger rma_claims_touch
  before update on public.rma_claims
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- WARRANTY REQUESTS
-- ----------------------------------------------------------------------------
-- Two kinds arrive from /portal/warranty:
--
--   registration  the client confirms the installed hardware is theirs.
--                 Usually auto-approvable, since the serials already exist in
--                 the registry from the technician's field scan.
--
--   transfer      the property was sold. Needs a HUMAN check of the proof of
--                 sale, because approving it moves warranty entitlement to a
--                 different person. Approval rewrites serialised_assets.client_id
--                 and is written to the audit log at 'critical'.
-- ============================================================================

create table public.warranty_requests (
  id uuid primary key default gen_random_uuid(),
  request_type public.warranty_request_type not null,
  status public.approval_status not null default 'pending',

  client_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Populated only for transfers.
  transfer_to_name text,
  transfer_to_email text,
  transfer_to_phone text,
  expected_transfer_date date,
  proof_document_id uuid,

  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,

  submitted_at timestamptz not null default now(),

  -- A transfer with nobody to transfer to is a data-entry accident, not a
  -- request. Reject it at write time rather than at review.
  constraint warranty_transfer_needs_recipient
    check (
      request_type <> 'transfer'
      or (transfer_to_name is not null and transfer_to_email is not null)
    )
);

create index warranty_requests_status_idx on public.warranty_requests (status);
create index warranty_requests_client_idx on public.warranty_requests (client_id);


-- ============================================================================
-- DOCUMENT VAULT
-- ----------------------------------------------------------------------------
-- Metadata only. The file itself lives in Supabase Storage; storage_path points
-- at it. Keeping metadata in Postgres is what lets RLS decide who may see a
-- document, which a storage bucket alone cannot express.
--
-- is_client_visible is deliberate: internal inspection notes and supplier
-- invoices attach to a project without appearing in the customer's vault.
-- ============================================================================

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.document_kind not null,

  project_id uuid references public.projects (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete set null,
  lead_id uuid references public.leads (id) on delete cascade,
  ticket_id uuid references public.tickets (id) on delete cascade,

  storage_path text not null,
  mime_type text,
  size_kb integer,
  is_client_visible boolean not null default true,

  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index documents_project_idx on public.documents (project_id);
create index documents_client_idx on public.documents (client_id);
create index documents_kind_idx on public.documents (kind);

-- Deferred FKs from 0003 and above, now that documents exists.
alter table public.permits
  add constraint permits_document_fk
  foreign key (document_id) references public.documents (id) on delete set null;

alter table public.maintenance_schedules
  add constraint maintenance_report_document_fk
  foreign key (report_document_id) references public.documents (id) on delete set null;

alter table public.warranty_requests
  add constraint warranty_proof_document_fk
  foreign key (proof_document_id) references public.documents (id) on delete set null;


-- ============================================================================
-- SITE PHOTOS
-- ----------------------------------------------------------------------------
-- Geotagged and timestamped, captured by technicians during survey and
-- installation. The geotag is the point: it is what proves a photo was taken at
-- that site on that day, which is what settles a warranty dispute years later.
-- ============================================================================

create table public.site_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  storage_path text not null,
  caption text,
  photo_category text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  taken_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles (id) on delete set null,
  is_client_visible boolean not null default true
);

create index site_photos_project_idx on public.site_photos (project_id);


-- ============================================================================
-- REVIEWS & PORTFOLIO
-- ----------------------------------------------------------------------------
-- Flow-diagram C18-C20. A review is requested on project closure, submitted by
-- the client, MODERATED by an administrator, and only then published.
--
-- Moderation is not optional. These rows render on the public marketing site,
-- so an unmoderated pipeline would publish whatever anyone typed straight onto
-- the company's shop window.
--
-- Portfolio entries are kept SEPARATE from projects on purpose. A project row
-- carries the customer's home address and contract value; a portfolio entry is
-- curated marketing copy with consented photos. Publishing straight from
-- projects would leak customer data onto the public internet.
-- ============================================================================

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.profiles (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,

  rating integer not null check (rating between 1 and 5),
  quote text not null,
  -- Shown publicly instead of a name, e.g. "Homeowner", "Private school".
  display_name text not null default 'Homeowner',
  display_location text,
  system_summary text,

  status public.approval_status not null default 'pending',
  moderated_by uuid references public.profiles (id) on delete set null,
  moderated_at timestamptz,
  published boolean not null default false,

  referral_name text,
  referral_contact text,

  created_at timestamptz not null default now(),

  -- Nothing reaches the public site without an approval on record.
  constraint reviews_published_needs_approval
    check (not published or (status = 'approved' and moderated_by is not null))
);

create index reviews_published_idx on public.reviews (published, created_at desc);


create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  location text,
  system_size text,
  segment text,
  year integer,
  summary text,
  cover_storage_path text,
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index portfolio_published_idx on public.portfolio_items (published, sort_order);

create trigger portfolio_touch
  before update on public.portfolio_items
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- BLOG / RESOURCES
-- ============================================================================

create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  body text,
  category text,
  read_minutes integer,
  published boolean not null default false,
  published_at timestamptz,
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index blog_published_idx on public.blog_posts (published, published_at desc);

create trigger blog_touch
  before update on public.blog_posts
  for each row execute function public.touch_updated_at();
