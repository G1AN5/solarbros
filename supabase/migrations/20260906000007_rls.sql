-- ============================================================================
-- 0007 · ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- THE ACTUAL SECURITY BOUNDARY OF THE APPLICATION.
--
-- Every role check in the React code decides what to RENDER. None of it decides
-- what a user is allowed to READ, because anyone can edit client-side
-- JavaScript or call the REST API directly with a valid token. This file is
-- what stops them, and it is enforced by Postgres on every single query.
--
-- The permission matrix rendered at /admin/governance is the specification;
-- this file is the implementation. If the two ever disagree, this file wins and
-- the matrix is wrong.
--
-- THE FOUR AUDIENCES
--   anon           the public website. Can read published marketing content and
--                  submit into the top of the sales funnel. Nothing else.
--   client         their own records only, never anyone else's.
--   technician     only the jobs they are assigned to.
--   staff          role-scoped by module; admin sees everything.
--
-- HOW TO TEST THIS PROPERLY: connect as each role and query directly. Passing
-- in the UI proves nothing, because the UI only ever asks for what it intends
-- to show.
-- ============================================================================


-- ============================================================================
-- OWNERSHIP HELPERS
-- security definer for the same reason as the role helpers in 0001: a policy
-- that queries the table it protects would recurse.
-- ============================================================================

-- Does the calling client own this project?
create or replace function public.owns_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects
    where id = p_project_id and client_id = (select auth.uid())
  );
$$;

-- Is the caller on the crew for this project?
create or replace function public.is_crew_on_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_crew
    where project_id = p_project_id and user_id = (select auth.uid())
  );
$$;

-- Is the caller assigned to this appointment?
create or replace function public.is_assigned_to_appointment(p_appointment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.appointment_assignees
    where appointment_id = p_appointment_id and user_id = (select auth.uid())
  );
$$;


-- ============================================================================
-- ENABLE RLS EVERYWHERE
-- ----------------------------------------------------------------------------
-- A table with RLS enabled and no policy denies everything, which is the safe
-- default. Forgetting to enable it on one table is the classic way a Supabase
-- project leaks its entire database, so this is done in one explicit block
-- rather than scattered through the file.
-- ============================================================================

alter table public.profiles                 enable row level security;
alter table public.audit_log                enable row level security;
alter table public.notifications            enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.packages                 enable row level security;
alter table public.leads                    enable row level security;
alter table public.estimates                enable row level security;
alter table public.quotations               enable row level security;
alter table public.quotation_lines          enable row level security;
alter table public.contracts                enable row level security;
alter table public.projects                 enable row level security;
alter table public.project_milestones       enable row level security;
alter table public.project_crew             enable row level security;
alter table public.permits                  enable row level security;
alter table public.appointments             enable row level security;
alter table public.appointment_assignees    enable row level security;
alter table public.maintenance_schedules    enable row level security;
alter table public.suppliers                enable row level security;
alter table public.stock_items              enable row level security;
alter table public.stock_reservations       enable row level security;
alter table public.stock_movements          enable row level security;
alter table public.purchase_orders          enable row level security;
alter table public.purchase_order_lines     enable row level security;
alter table public.serialised_assets        enable row level security;
alter table public.invoices                 enable row level security;
alter table public.payments                 enable row level security;
alter table public.commissions              enable row level security;
alter table public.time_logs                enable row level security;
alter table public.payroll_runs             enable row level security;
alter table public.payroll_lines            enable row level security;
alter table public.tickets                  enable row level security;
alter table public.ticket_messages          enable row level security;
alter table public.rma_claims               enable row level security;
alter table public.warranty_requests        enable row level security;
alter table public.documents                enable row level security;
alter table public.site_photos              enable row level security;
alter table public.reviews                  enable row level security;
alter table public.portfolio_items          enable row level security;
alter table public.blog_posts               enable row level security;


-- ============================================================================
-- PROFILES
-- ============================================================================

create policy profiles_read_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- Staff need to see colleagues to assign work, and clients to serve them.
create policy profiles_read_all_internal on public.profiles
  for select to authenticated
  using (public.is_internal());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  -- Without this, a client could PATCH their own row to role = 'admin' and
  -- promote themselves. The role column is administrator-only, full stop.
  with check (id = (select auth.uid()) and role = public.current_user_role());

create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ============================================================================
-- AUDIT LOG  ·  APPEND-ONLY
-- ----------------------------------------------------------------------------
-- SELECT for admins, INSERT by the trigger writer. There is deliberately NO
-- update or delete policy, so RLS denies both to everyone including admins.
-- The REVOKE below is a second, independent layer.
-- ============================================================================

create policy audit_read_admin on public.audit_log
  for select to authenticated
  using (public.is_admin());

create policy audit_insert_internal on public.audit_log
  for insert to authenticated
  with check (public.is_internal());

revoke update, delete on public.audit_log from authenticated, anon;


-- ============================================================================
-- NOTIFICATIONS
-- ============================================================================

create policy notifications_read_own on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Marking as read is the only field a recipient may change.
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notifications_insert_internal on public.notifications
  for insert to authenticated
  with check (public.is_internal());

create policy notification_prefs_own on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- ============================================================================
-- PUBLIC MARKETING CONTENT
-- Readable by anyone, including logged-out visitors. Written by staff only.
-- ============================================================================

create policy packages_read_public on public.packages
  for select to anon, authenticated
  using (is_active);

create policy packages_write_staff on public.packages
  for all to authenticated
  using (public.has_role('sales', 'admin'))
  with check (public.has_role('sales', 'admin'));

-- Only APPROVED and PUBLISHED reviews are visible publicly. The moderation gate
-- is meaningless if the unmoderated rows are readable anyway.
create policy reviews_read_published on public.reviews
  for select to anon, authenticated
  using (published and status = 'approved');

create policy reviews_read_own on public.reviews
  for select to authenticated
  using (client_id = (select auth.uid()));

create policy reviews_insert_client on public.reviews
  for insert to authenticated
  with check (client_id = (select auth.uid()));

create policy reviews_moderate_admin on public.reviews
  for all to authenticated
  using (public.has_role('sales', 'admin'))
  with check (public.has_role('sales', 'admin'));

create policy portfolio_read_published on public.portfolio_items
  for select to anon, authenticated
  using (published);

create policy portfolio_write_staff on public.portfolio_items
  for all to authenticated
  using (public.has_role('sales', 'admin'))
  with check (public.has_role('sales', 'admin'));

create policy blog_read_published on public.blog_posts
  for select to anon, authenticated
  using (published);

create policy blog_write_staff on public.blog_posts
  for all to authenticated
  using (public.has_role('sales', 'admin'))
  with check (public.has_role('sales', 'admin'));


-- ============================================================================
-- LEADS & ESTIMATES  ·  the top of the funnel
-- ----------------------------------------------------------------------------
-- anon may INSERT (that is the whole point of a public estimator and contact
-- form) but may never SELECT. A public site that lets anyone read the leads
-- table hands a competitor the entire prospect list.
--
-- SPAM: an open insert endpoint will be abused. Before launch, put a CAPTCHA in
-- front of these forms and rate-limit by IP at the edge. RLS controls who may
-- write; it cannot control how often.
-- ============================================================================

create policy leads_insert_public on public.leads
  for insert to anon, authenticated
  with check (true);

create policy leads_read_internal on public.leads
  for select to authenticated
  using (public.is_staff());

create policy leads_update_staff on public.leads
  for update to authenticated
  using (public.has_role('sales', 'project_engineer', 'admin'))
  with check (public.has_role('sales', 'project_engineer', 'admin'));

create policy leads_delete_admin on public.leads
  for delete to authenticated
  using (public.is_admin());

create policy estimates_insert_public on public.estimates
  for insert to anon, authenticated
  with check (true);

create policy estimates_read_staff on public.estimates
  for select to authenticated
  using (public.is_staff());


-- ============================================================================
-- QUOTATIONS & CONTRACTS
-- ============================================================================

create policy quotations_read_staff on public.quotations
  for select to authenticated
  using (public.is_staff());

-- The client sees the quotation once it has actually been sent to them, and
-- only their own. Draft pricing and internal margin stay internal.
create policy quotations_read_own on public.quotations
  for select to authenticated
  using (
    status in ('sent', 'accepted', 'rejected')
    and exists (
      select 1 from public.leads l
      where l.id = quotations.lead_id and l.converted_client_id = (select auth.uid())
    )
  );

create policy quotations_write_sales on public.quotations
  for all to authenticated
  using (public.has_role('sales', 'project_engineer', 'admin'))
  with check (public.has_role('sales', 'project_engineer', 'admin'));

create policy quotation_lines_read on public.quotation_lines
  for select to authenticated
  using (public.is_staff());

create policy quotation_lines_write on public.quotation_lines
  for all to authenticated
  using (public.has_role('sales', 'project_engineer', 'admin'))
  with check (public.has_role('sales', 'project_engineer', 'admin'));

create policy contracts_read_own on public.contracts
  for select to authenticated
  using (client_id = (select auth.uid()) or public.is_staff());

-- A client may sign their own contract, which is an UPDATE on their own row.
create policy contracts_sign_client on public.contracts
  for update to authenticated
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

create policy contracts_write_staff on public.contracts
  for all to authenticated
  using (public.has_role('sales', 'accountant', 'admin'))
  with check (public.has_role('sales', 'accountant', 'admin'));


-- ============================================================================
-- PROJECTS  ·  the shared spine
-- ----------------------------------------------------------------------------
-- Read by three audiences at once: the owning client, the assigned crew, and
-- staff. All three see the same rows, which is exactly why the customer's
-- progress bar cannot disagree with the technician's.
-- ============================================================================

create policy projects_read on public.projects
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or public.is_staff()
    or public.is_crew_on_project(id)
  );

create policy projects_write_staff on public.projects
  for all to authenticated
  using (public.has_role('project_engineer', 'sales', 'accountant', 'admin'))
  with check (public.has_role('project_engineer', 'sales', 'accountant', 'admin'));


create policy milestones_read on public.project_milestones
  for select to authenticated
  using (
    public.owns_project(project_id)
    or public.is_staff()
    or public.is_crew_on_project(project_id)
  );

-- THE MOST IMPORTANT WRITE POLICY IN THE SCHEMA.
--
-- Only the crew actually on the job, a project engineer, or an admin may move a
-- milestone. Progress is reported by the person who did the work, standing at
-- the site — not by an office keying in what they were told, and never by the
-- customer.
create policy milestones_update_crew on public.project_milestones
  for update to authenticated
  using (
    public.is_crew_on_project(project_id)
    or public.has_role('project_engineer', 'admin')
  )
  with check (
    public.is_crew_on_project(project_id)
    or public.has_role('project_engineer', 'admin')
  );

create policy milestones_insert_staff on public.project_milestones
  for insert to authenticated
  with check (public.has_role('project_engineer', 'admin'));

create policy crew_read on public.project_crew
  for select to authenticated
  using (public.is_internal() or public.owns_project(project_id));

create policy crew_write_staff on public.project_crew
  for all to authenticated
  using (public.has_role('project_engineer', 'admin'))
  with check (public.has_role('project_engineer', 'admin'));


-- ============================================================================
-- PERMITS
-- Internal only. A client sees permitting progress through the milestone, not
-- through the permit record itself, which carries fee amounts and findings.
-- ============================================================================

create policy permits_read_internal on public.permits
  for select to authenticated
  using (public.is_internal());

create policy permits_write_engineer on public.permits
  for all to authenticated
  using (public.has_role('project_engineer', 'admin'))
  with check (public.has_role('project_engineer', 'admin'));


-- ============================================================================
-- SCHEDULING
-- ----------------------------------------------------------------------------
-- anon may INSERT: that is the public /booking form. Reading is restricted, so
-- a stranger cannot enumerate every customer visit and address.
-- ============================================================================

create policy appointments_insert_public on public.appointments
  for insert to anon, authenticated
  with check (true);

create policy appointments_read on public.appointments
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or public.is_staff()
    or public.is_assigned_to_appointment(id)
  );

create policy appointments_update_client on public.appointments
  for update to authenticated
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

create policy appointments_update_assigned on public.appointments
  for update to authenticated
  using (public.is_assigned_to_appointment(id))
  with check (public.is_assigned_to_appointment(id));

create policy appointments_write_staff on public.appointments
  for all to authenticated
  using (public.has_role('project_engineer', 'sales', 'admin'))
  with check (public.has_role('project_engineer', 'sales', 'admin'));

create policy assignees_read on public.appointment_assignees
  for select to authenticated
  using (public.is_internal() or user_id = (select auth.uid()));

-- Dispatch is a coordinator function. A technician cannot self-assign, because
-- the coordinator is balancing the whole crew's load and travel route.
create policy assignees_write_dispatch on public.appointment_assignees
  for all to authenticated
  using (public.has_role('project_engineer', 'admin'))
  with check (public.has_role('project_engineer', 'admin'));

create policy maintenance_read on public.maintenance_schedules
  for select to authenticated
  using (public.owns_project(project_id) or public.is_internal());

create policy maintenance_write_staff on public.maintenance_schedules
  for all to authenticated
  using (public.has_role('project_engineer', 'admin'))
  with check (public.has_role('project_engineer', 'admin'));


-- ============================================================================
-- SUPPLY CHAIN
-- ----------------------------------------------------------------------------
-- Technicians can READ stock (they need to know what is on the van) and log
-- consumption through the consume_project_stock() function, which is SECURITY
-- DEFINER. They cannot edit stock levels directly, so a mis-tap cannot silently
-- rewrite the warehouse balance.
-- ============================================================================

create policy suppliers_read_internal on public.suppliers
  for select to authenticated
  using (public.is_internal());

create policy suppliers_write on public.suppliers
  for all to authenticated
  using (public.has_role('inventory_manager', 'admin'))
  with check (public.has_role('inventory_manager', 'admin'));

create policy stock_read_internal on public.stock_items
  for select to authenticated
  using (public.is_internal());

create policy stock_write_inventory on public.stock_items
  for all to authenticated
  using (public.has_role('inventory_manager', 'admin'))
  with check (public.has_role('inventory_manager', 'admin'));

create policy reservations_read_internal on public.stock_reservations
  for select to authenticated
  using (public.is_internal());

create policy reservations_write on public.stock_reservations
  for all to authenticated
  using (public.has_role('inventory_manager', 'project_engineer', 'admin'))
  with check (public.has_role('inventory_manager', 'project_engineer', 'admin'));

create policy movements_read_internal on public.stock_movements
  for select to authenticated
  using (public.is_internal());

create policy movements_insert_internal on public.stock_movements
  for insert to authenticated
  with check (public.is_internal());

-- The movement ledger is the explanation for every stock balance. Editing
-- history retrospectively would make it worthless, so corrections are made by
-- posting an offsetting 'adjustment' row instead.
revoke update, delete on public.stock_movements from authenticated, anon;

create policy po_read_internal on public.purchase_orders
  for select to authenticated
  using (public.is_staff());

create policy po_write_inventory on public.purchase_orders
  for all to authenticated
  using (public.has_role('inventory_manager', 'accountant', 'admin'))
  with check (public.has_role('inventory_manager', 'accountant', 'admin'));

create policy po_lines_read on public.purchase_order_lines
  for select to authenticated
  using (public.is_staff());

create policy po_lines_write on public.purchase_order_lines
  for all to authenticated
  using (public.has_role('inventory_manager', 'admin'))
  with check (public.has_role('inventory_manager', 'admin'));

-- A client sees the serial numbers installed on their own roof: that is the
-- /portal/warranty page.
create policy assets_read on public.serialised_assets
  for select to authenticated
  using (client_id = (select auth.uid()) or public.is_internal());

create policy assets_insert_field on public.serialised_assets
  for insert to authenticated
  with check (public.is_internal());

create policy assets_update_staff on public.serialised_assets
  for update to authenticated
  using (public.has_role('inventory_manager', 'project_engineer', 'admin'))
  with check (public.has_role('inventory_manager', 'project_engineer', 'admin'));


-- ============================================================================
-- FINANCE
-- ----------------------------------------------------------------------------
-- Clients see their own invoices and payments. Technicians and sales reps see
-- neither: nothing in their job requires the customer's payment history.
-- ============================================================================

create policy invoices_read on public.invoices
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or public.has_role('accountant', 'admin', 'sales', 'project_engineer')
  );

create policy invoices_write_finance on public.invoices
  for all to authenticated
  using (public.has_role('accountant', 'admin'))
  with check (public.has_role('accountant', 'admin'));

create policy payments_read on public.payments
  for select to authenticated
  using (
    public.has_role('accountant', 'admin')
    or exists (
      select 1 from public.invoices i
      where i.id = payments.invoice_id and i.client_id = (select auth.uid())
    )
  );

create policy payments_write_finance on public.payments
  for all to authenticated
  using (public.has_role('accountant', 'admin'))
  with check (public.has_role('accountant', 'admin'));

-- A rep sees their own commissions; only finance sees everyone's.
create policy commissions_read on public.commissions
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role('accountant', 'admin'));

create policy commissions_write on public.commissions
  for all to authenticated
  using (public.has_role('accountant', 'admin'))
  with check (public.has_role('accountant', 'admin'));

-- A technician logs and reads their own hours, and can check them before
-- payday rather than disputing them afterwards.
create policy time_logs_own on public.time_logs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy time_logs_read_finance on public.time_logs
  for select to authenticated
  using (public.has_role('accountant', 'project_engineer', 'admin'));

create policy payroll_runs_read on public.payroll_runs
  for select to authenticated
  using (public.has_role('accountant', 'admin'));

create policy payroll_runs_write on public.payroll_runs
  for all to authenticated
  using (public.has_role('accountant', 'admin'))
  with check (public.has_role('accountant', 'admin'));

-- An employee may see their own payslip line and nobody else's.
create policy payroll_lines_read on public.payroll_lines
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role('accountant', 'admin'));

create policy payroll_lines_write on public.payroll_lines
  for all to authenticated
  using (public.has_role('accountant', 'admin'))
  with check (public.has_role('accountant', 'admin'));


-- ============================================================================
-- SUPPORT & WARRANTY
-- ============================================================================

create policy tickets_read on public.tickets
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or public.is_staff()
    or assigned_to = (select auth.uid())
  );

-- A client may raise a ticket, but only as themselves.
create policy tickets_insert_client on public.tickets
  for insert to authenticated
  with check (client_id = (select auth.uid()) or public.is_internal());

create policy tickets_update_staff on public.tickets
  for update to authenticated
  using (public.is_staff() or assigned_to = (select auth.uid()))
  with check (public.is_staff() or assigned_to = (select auth.uid()));

-- Internal notes stay internal. This is the whole reason is_internal exists on
-- the messages table.
create policy ticket_messages_read on public.ticket_messages
  for select to authenticated
  using (
    public.is_internal()
    or (
      not is_internal
      and exists (
        select 1 from public.tickets t
        where t.id = ticket_messages.ticket_id and t.client_id = (select auth.uid())
      )
    )
  );

create policy ticket_messages_insert on public.ticket_messages
  for insert to authenticated
  with check (author_id = (select auth.uid()));

create policy rma_read_internal on public.rma_claims
  for select to authenticated
  using (public.is_internal());

create policy rma_write on public.rma_claims
  for all to authenticated
  using (public.has_role('inventory_manager', 'project_engineer', 'admin'))
  with check (public.has_role('inventory_manager', 'project_engineer', 'admin'));

create policy warranty_read on public.warranty_requests
  for select to authenticated
  using (client_id = (select auth.uid()) or public.is_staff());

create policy warranty_insert_client on public.warranty_requests
  for insert to authenticated
  with check (client_id = (select auth.uid()));

-- Approving a transfer moves warranty entitlement to a different person, so it
-- is restricted to the two roles accountable for the asset registry.
create policy warranty_review on public.warranty_requests
  for update to authenticated
  using (public.has_role('inventory_manager', 'admin'))
  with check (public.has_role('inventory_manager', 'admin'));


-- ============================================================================
-- DOCUMENTS & PHOTOS
-- ----------------------------------------------------------------------------
-- is_client_visible is what keeps internal inspection notes and supplier
-- invoices attached to a project without appearing in the customer's vault.
-- ============================================================================

create policy documents_read on public.documents
  for select to authenticated
  using (
    public.is_internal()
    or (is_client_visible and (client_id = (select auth.uid()) or public.owns_project(project_id)))
  );

create policy documents_write_internal on public.documents
  for all to authenticated
  using (public.is_internal())
  with check (public.is_internal());

create policy photos_read on public.site_photos
  for select to authenticated
  using (
    public.is_internal()
    or (is_client_visible and public.owns_project(project_id))
  );

create policy photos_write_internal on public.site_photos
  for all to authenticated
  using (public.is_internal())
  with check (public.is_internal());
