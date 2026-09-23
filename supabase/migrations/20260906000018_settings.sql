-- ============================================================================
-- 0018 · CONFIGURABLE BUSINESS SETTINGS
-- ----------------------------------------------------------------------------
-- Moves business rules out of code and into the database, where the people who
-- own those decisions can change them.
--
-- THE PROBLEM THIS SOLVES
-- Every number below was previously a constant in a migration or a React file:
-- the discount a sales rep may approve, how many days an invoice is due in, how
-- a lead is scored, what a kilowatt costs to install. Changing any of them meant
-- a developer, a commit, a review and a deploy.
--
-- That is the wrong shape for a business. Panel prices move with the exchange
-- rate. A slow quarter is a reason to widen discount authority this month and
-- narrow it next. The reorder point that was right in summer is wrong before
-- the rainy season. None of those are engineering decisions, and a company that
-- has to file a ticket to change them will simply stop changing them — and the
-- system will drift out of step with how the business actually operates.
--
-- WHAT IS DELIBERATELY *NOT* CONFIGURABLE
-- Anything that would break correctness or the audit trail. The seven-stage
-- milestone sequence, the RLS policies, the requirement that a milestone marked
-- done carries a timestamp, the append-only audit log. Those are invariants, not
-- preferences, and exposing them as settings would let somebody switch off the
-- guarantees the rest of the system relies on.
--
-- HOW IT IS ENFORCED
-- Each row declares WHO may edit it (`editable_by`) and whether it is safe to
-- read publicly (`is_public`). The estimator constants are public because the
-- public estimator needs them; margins and discount authority are not, because
-- they would tell a competitor how the company prices.
--
-- Triggers read settings through `setting_num()`, which falls back to a hard
-- default when a row is missing. A deleted setting therefore degrades to the
-- old behaviour rather than breaking a contract signing at 5pm on a Friday.
-- ============================================================================

create type public.setting_type as enum ('number', 'percent', 'currency', 'text', 'boolean');

create table public.settings (
  key text primary key,
  value jsonb not null,

  category text not null,
  label text not null,
  description text,
  value_type public.setting_type not null default 'number',
  unit text,

  -- Guard rails. A discount authority of 900% or a negative due date is a typo,
  -- not a decision, and the UI should refuse it before the database has to.
  min_value numeric,
  max_value numeric,

  /* Which roles may change this. Most are admin-only; a few belong to the role
     that lives with the consequences — inventory thresholds to the inventory
     manager, payment terms to the accountant. */
  editable_by public.user_role[] not null default array['admin']::public.user_role[],

  -- Safe to expose to logged-out visitors? The public estimator needs the
  -- sizing constants; nothing else should leave the building.
  is_public boolean not null default false,

  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.settings is
  'Business rules the company can change without a developer. Read by triggers via setting_num().';

create index settings_category_idx on public.settings (category, sort_order);

create trigger settings_touch
  before update on public.settings
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- READ HELPERS
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so a trigger can read a setting regardless of who triggered
-- it. Each takes a fallback: a missing row degrades to previous behaviour
-- instead of raising inside somebody's contract signing.
-- ============================================================================

create or replace function public.setting_num(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = p_key), p_default);
$$;

create or replace function public.setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value #>> '{}' from public.settings where key = p_key), p_default);
$$;

revoke all on function public.setting_num(text, numeric) from public, anon, authenticated;
revoke all on function public.setting_text(text, text) from public, anon, authenticated;


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.settings enable row level security;

-- Public settings reach the marketing site and the estimator.
create policy settings_read_public on public.settings
  for select to anon, authenticated
  using (is_public);

create policy settings_read_internal on public.settings
  for select to authenticated
  using (public.is_internal());

-- A row can only be changed by a role it names. This is what lets the inventory
-- manager own stock thresholds without also owning discount authority.
create policy settings_update on public.settings
  for update to authenticated
  using (public.current_user_role() = any (editable_by))
  with check (public.current_user_role() = any (editable_by));

-- Creating and removing settings is a schema-shaped decision, not a business
-- one: the code that reads a key has to exist. Admins only.
create policy settings_admin_all on public.settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ============================================================================
-- THE SETTINGS THEMSELVES
-- ============================================================================

insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values

  /* --- Company profile ------------------------------------------------- */
  ('company.name', '"SolarBros"', 'company', 'Company name', null, 'text', null, null, null, array['admin']::public.user_role[], true, 1),
  ('company.email', '"hello@solarbros.ph"', 'company', 'Contact email', 'Shown on the website and on quotations.', 'text', null, null, null, array['admin']::public.user_role[], true, 2),
  ('company.phone', '"+63 917 555 0142"', 'company', 'Contact number', null, 'text', null, null, null, array['admin']::public.user_role[], true, 3),
  ('company.address', '"Warehouse Unit D ACSIE #12 Main Road, Km. 16 West Service Road, South Superhighway, Paranaque, Metro Manila 1700"', 'company', 'Office address', null, 'text', null, null, null, array['admin']::public.user_role[], true, 4),
  ('company.hours', '"Mon-Sat, 8:00 AM - 6:00 PM"', 'company', 'Business hours', null, 'text', null, null, null, array['admin']::public.user_role[], true, 5),
  ('company.install_days', '3', 'company', 'Typical installation time', 'Advertised on the website. Change it if the real figure moves.', 'number', 'days', 1, 60, array['admin', 'project_engineer']::public.user_role[], true, 6),

  /* --- Warranty terms --------------------------------------------------- */
  ('warranty.panel_years', '25', 'warranty', 'Panel warranty', null, 'number', 'years', 1, 40, array['admin']::public.user_role[], true, 1),
  ('warranty.inverter_years', '10', 'warranty', 'Inverter warranty', null, 'number', 'years', 1, 25, array['admin']::public.user_role[], true, 2),
  ('warranty.workmanship_years', '2', 'warranty', 'Workmanship warranty', 'Covers installation defects, mounting and wiring.', 'number', 'years', 1, 10, array['admin']::public.user_role[], true, 3),

  /* --- Estimator & pricing ---------------------------------------------
     The sizing constants are public because the public estimator computes with
     them in the browser. The COSTS are not: they would tell a competitor
     exactly how the company prices. The estimator shows a total, never a
     breakdown. */
  ('pricing.panel_watts', '620', 'pricing', 'Standard panel wattage', 'The panel currently installed as standard.', 'number', 'W', 100, 1000, array['admin', 'project_engineer']::public.user_role[], true, 1),
  ('pricing.battery_kwh', '5.12', 'pricing', 'Battery module capacity', null, 'number', 'kWh', 1, 50, array['admin', 'project_engineer']::public.user_role[], true, 2),
  ('pricing.performance_ratio', '0.8', 'pricing', 'System efficiency', 'Losses between the panel face and the wall socket: inverter, wiring, dust, heat.', 'number', null, 0.5, 1, array['admin', 'project_engineer']::public.user_role[], true, 3),
  ('pricing.inverter_headroom', '1.25', 'pricing', 'Inverter headroom', 'Safety margin above measured peak load, for motor start-up surges.', 'number', 'x', 1, 2, array['admin', 'project_engineer']::public.user_role[], true, 4),
  ('pricing.sqm_per_kw', '6.0', 'pricing', 'Roof area per kW', null, 'number', 'm2', 3, 15, array['admin', 'project_engineer']::public.user_role[], true, 5),
  ('pricing.system_lifetime_years', '25', 'pricing', 'System lifetime', 'Used for the lifetime-savings figure on the estimator.', 'number', 'years', 10, 40, array['admin']::public.user_role[], true, 6),

  ('pricing.cost_per_kw_on_grid', '55000', 'pricing', 'Installed cost per kW (on-grid)', 'Move these when panel or inverter prices change.', 'currency', 'PHP', 0, 500000, array['admin', 'accountant']::public.user_role[], false, 10),
  ('pricing.cost_per_kw_hybrid', '72000', 'pricing', 'Installed cost per kW (hybrid)', null, 'currency', 'PHP', 0, 500000, array['admin', 'accountant']::public.user_role[], false, 11),
  ('pricing.cost_per_kw_off_grid', '95000', 'pricing', 'Installed cost per kW (off-grid)', null, 'currency', 'PHP', 0, 500000, array['admin', 'accountant']::public.user_role[], false, 12),
  ('pricing.cost_per_battery', '95000', 'pricing', 'Cost per battery module', null, 'currency', 'PHP', 0, 500000, array['admin', 'accountant']::public.user_role[], false, 13),
  ('pricing.labour_overhead_pct', '18', 'pricing', 'Labour and overhead', 'Added to material cost when building a quotation.', 'percent', '%', 0, 100, array['admin', 'accountant']::public.user_role[], false, 14),
  ('pricing.default_margin_pct', '35', 'pricing', 'Default gross margin', 'The starting margin on a new quotation.', 'percent', '%', 0, 90, array['admin', 'accountant']::public.user_role[], false, 15),

  /* --- Sales ------------------------------------------------------------ */
  ('sales.discount_authority_pct', '10', 'sales', 'Discount without approval', 'A sales rep may discount up to this without an administrator. Enforced by the database, not just the screen.', 'percent', '%', 0, 100, array['admin']::public.user_role[], false, 1),
  ('sales.quotation_validity_days', '30', 'sales', 'Quotation validity', 'How long a quoted price is honoured.', 'number', 'days', 1, 365, array['admin', 'sales']::public.user_role[], false, 2),
  ('sales.commission_pct', '3', 'sales', 'Sales commission', 'Percentage of contract value, released on project closure.', 'percent', '%', 0, 30, array['admin']::public.user_role[], false, 3),

  /* --- Lead scoring ------------------------------------------------------
     The whole weighting, in one place. Sales management can retune what makes a
     good lead without anybody touching a trigger. */
  ('scoring.bill_divisor', '500', 'scoring', 'Pesos per scoring point', 'A PHP 8,000 bill scores 16 points at a divisor of 500.', 'number', 'PHP', 50, 5000, array['admin', 'sales']::public.user_role[], false, 1),
  ('scoring.bill_max_points', '40', 'scoring', 'Maximum points from bill size', null, 'number', 'pts', 0, 100, array['admin', 'sales']::public.user_role[], false, 2),
  ('scoring.source_referral', '25', 'scoring', 'Points: referral', 'An existing customer recommending you is the strongest signal there is.', 'number', 'pts', 0, 50, array['admin', 'sales']::public.user_role[], false, 3),
  ('scoring.source_quote_request', '18', 'scoring', 'Points: quote request', null, 'number', 'pts', 0, 50, array['admin', 'sales']::public.user_role[], false, 4),
  ('scoring.source_walk_in', '15', 'scoring', 'Points: walk-in', null, 'number', 'pts', 0, 50, array['admin', 'sales']::public.user_role[], false, 5),
  ('scoring.source_facebook', '8', 'scoring', 'Points: social media', null, 'number', 'pts', 0, 50, array['admin', 'sales']::public.user_role[], false, 6),
  ('scoring.source_estimator', '5', 'scoring', 'Points: estimator', 'Anonymous, so the lowest intent signal.', 'number', 'pts', 0, 50, array['admin', 'sales']::public.user_role[], false, 7),
  ('scoring.points_service_area', '10', 'scoring', 'Points: inside service area', null, 'number', 'pts', 0, 50, array['admin', 'sales']::public.user_role[], false, 8),
  ('scoring.points_owns_property', '10', 'scoring', 'Points: owns the property', null, 'number', 'pts', 0, 50, array['admin', 'sales']::public.user_role[], false, 9),
  ('scoring.points_decision_maker', '10', 'scoring', 'Points: is the decision maker', null, 'number', 'pts', 0, 50, array['admin', 'sales']::public.user_role[], false, 10),
  ('scoring.large_system_kw', '5', 'scoring', 'Large system threshold', null, 'number', 'kW', 1, 100, array['admin', 'sales']::public.user_role[], false, 11),
  ('scoring.points_large_system', '5', 'scoring', 'Points: large system', null, 'number', 'pts', 0, 50, array['admin', 'sales']::public.user_role[], false, 12),

  /* --- Finance ---------------------------------------------------------- */
  ('finance.down_payment_pct', '50', 'finance', 'Down payment', 'The three stages must total 100%.', 'percent', '%', 0, 100, array['admin', 'accountant']::public.user_role[], false, 1),
  ('finance.delivery_pct', '35', 'finance', 'On materials delivered', null, 'percent', '%', 0, 100, array['admin', 'accountant']::public.user_role[], false, 2),
  ('finance.commissioning_pct', '15', 'finance', 'On commissioning', null, 'percent', '%', 0, 100, array['admin', 'accountant']::public.user_role[], false, 3),
  ('finance.down_payment_due_days', '7', 'finance', 'Down payment due within', null, 'number', 'days', 0, 90, array['admin', 'accountant']::public.user_role[], false, 4),
  ('finance.milestone_due_days', '15', 'finance', 'Milestone invoice due within', null, 'number', 'days', 0, 90, array['admin', 'accountant']::public.user_role[], false, 5),
  ('finance.collections_escalation_days', '30', 'finance', 'Escalate overdue after', 'How long an unpaid invoice runs before it is escalated.', 'number', 'days', 1, 180, array['admin', 'accountant']::public.user_role[], false, 6),

  /* --- Inventory --------------------------------------------------------- */
  ('inventory.default_reorder_point', '20', 'inventory', 'Default reorder point', 'Applied to a new stock item. Each item can override it.', 'number', 'units', 0, 10000, array['admin', 'inventory_manager']::public.user_role[], false, 1),
  ('inventory.requisition_approval_limit', '100000', 'inventory', 'Requisition approval limit', 'A purchase order above this needs administrator approval.', 'currency', 'PHP', 0, 10000000, array['admin']::public.user_role[], false, 2),
  ('inventory.low_stock_warning_multiplier', '1.5', 'inventory', 'Early warning threshold', 'Warn at this multiple of the reorder point, before stock actually runs low.', 'number', 'x', 1, 5, array['admin', 'inventory_manager']::public.user_role[], false, 3),

  /* --- Operations -------------------------------------------------------- */
  ('operations.maintenance_interval_months', '12', 'operations', 'Preventive maintenance interval', 'How often a health check falls due after turnover.', 'number', 'months', 1, 60, array['admin', 'project_engineer']::public.user_role[], false, 1),
  ('operations.overtime_threshold_hours', '20', 'operations', 'Overtime warning threshold', 'Flag a technician above this many overtime hours in a period. Sustained overtime is a safety problem for crews working at height, not only a cost one.', 'number', 'hours', 0, 200, array['admin', 'project_engineer']::public.user_role[], false, 2),
  ('operations.max_jobs_per_crew_per_day', '3', 'operations', 'Maximum jobs per crew per day', 'The dispatch board warns above this.', 'number', 'jobs', 1, 10, array['admin', 'project_engineer']::public.user_role[], false, 3),

  /* --- Support SLAs ------------------------------------------------------ */
  ('support.sla_urgent_hours', '2', 'support', 'Urgent response target', 'System down or a safety risk.', 'number', 'hours', 1, 72, array['admin', 'sales']::public.user_role[], false, 1),
  ('support.sla_high_hours', '24', 'support', 'High priority response target', null, 'number', 'hours', 1, 168, array['admin', 'sales']::public.user_role[], false, 2),
  ('support.sla_normal_hours', '48', 'support', 'Normal response target', null, 'number', 'hours', 1, 336, array['admin', 'sales']::public.user_role[], false, 3),
  ('support.sla_low_hours', '120', 'support', 'Low priority response target', null, 'number', 'hours', 1, 720, array['admin', 'sales']::public.user_role[], false, 4),
  ('support.warranty_review_days', '5', 'support', 'Warranty request review target', null, 'number', 'days', 1, 60, array['admin', 'inventory_manager']::public.user_role[], false, 5)

on conflict (key) do nothing;


-- ============================================================================
-- REWIRE THE TRIGGERS TO READ SETTINGS
-- ----------------------------------------------------------------------------
-- Each keeps its original number as the fallback, so behaviour is unchanged
-- until somebody deliberately changes a setting.
-- ============================================================================

-- --- Lead scoring -----------------------------------------------------------
create or replace function public.score_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer := 0;
begin
  -- Bill size, capped. Both the divisor and the cap are configurable, so sales
  -- management can retune what "a good lead" means without a deploy.
  v := v + least(
    coalesce(new.monthly_bill, 0) / public.setting_num('scoring.bill_divisor', 500),
    public.setting_num('scoring.bill_max_points', 40)
  )::integer;

  -- Source quality.
  v := v + case new.source
    when 'referral'      then public.setting_num('scoring.source_referral', 25)
    when 'quote_request' then public.setting_num('scoring.source_quote_request', 18)
    when 'walk_in'       then public.setting_num('scoring.source_walk_in', 15)
    when 'facebook'      then public.setting_num('scoring.source_facebook', 8)
    else                      public.setting_num('scoring.source_estimator', 5)
  end;

  -- Qualification answers, once a rep has actually spoken to them.
  if new.in_service_area then
    v := v + public.setting_num('scoring.points_service_area', 10);
  end if;
  if new.owns_property then
    v := v + public.setting_num('scoring.points_owns_property', 10);
  end if;
  if new.is_decision_maker then
    v := v + public.setting_num('scoring.points_decision_maker', 10);
  end if;
  if new.estimated_kw is not null
     and new.estimated_kw >= public.setting_num('scoring.large_system_kw', 5) then
    v := v + public.setting_num('scoring.points_large_system', 5);
  end if;

  new.score := least(greatest(v, 0), 100);
  return new;
end;
$$;

revoke all on function public.score_lead() from public, anon, authenticated;


-- --- Discount authority -----------------------------------------------------
create or replace function public.enforce_discount_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit numeric := public.setting_num('sales.discount_authority_pct', 10);
begin
  if new.discount_pct > v_limit
     and new.status = 'sent'
     and new.discount_approved_by is null then
    raise exception
      'A discount of %.2f%% exceeds the % %% approval limit and needs administrator sign-off before this quotation can be sent.',
      new.discount_pct, v_limit;
  end if;

  if new.discount_pct > v_limit and new.discount_approved_by is not null
     and coalesce(old.discount_approved_by, '00000000-0000-0000-0000-000000000000'::uuid)
         is distinct from new.discount_approved_by then
    perform public.write_audit(
      'Discount of ' || new.discount_pct || '% approved (limit ' || v_limit || '%)',
      'quotations',
      new.id::text,
      'warning',
      jsonb_build_object('discount_pct', new.discount_pct, 'limit', v_limit, 'total_price', new.total_price)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_discount_authority() from public, anon, authenticated;


-- --- Invoice due dates and payment split ------------------------------------
create or replace function public.on_contract_executed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_reference text;
  v_quotation record;
  v_lead record;
  v_milestones text[][] := array[
    ['engineering_survey',   'Engineering Survey'],
    ['permitting',           'Permitting & Approvals'],
    ['structural_mounting',  'Structural Mounting'],
    ['dc_wiring',            'DC Wiring'],
    ['ac_wiring',            'AC Wiring & Tie-in'],
    ['commissioning',        'Commissioning & Testing'],
    ['turnover',             'Turnover & Handover']
  ];
  i integer;
  v_due_days integer := public.setting_num('finance.down_payment_due_days', 7)::integer;
  v_install_days integer := public.setting_num('company.install_days', 3)::integer;
begin
  if new.status <> 'executed' or coalesce(old.status, 'draft') = 'executed' then
    return new;
  end if;

  select * into v_quotation from public.quotations where id = new.quotation_id;
  select * into v_lead from public.leads where id = new.lead_id;

  v_reference := 'SB-' || to_char(now(), 'YYYY') || '-' || nextval('public.project_ref_seq');

  insert into public.projects (
    reference, client_id, lead_id, contract_id, address,
    system_kw, system_type, contract_value, status, start_date, target_turnover
  )
  values (
    v_reference,
    new.client_id,
    new.lead_id,
    new.id,
    coalesce(v_lead.address, v_lead.location, 'Address to be confirmed'),
    coalesce(v_quotation.system_kw, 0),
    coalesce(v_quotation.system_type, 'on_grid'),
    new.contract_value,
    'planning',
    current_date,
    -- Permitting and procurement dominate the calendar, so the target allows
    -- roughly a month around the advertised installation window.
    current_date + ((v_install_days + 27) || ' days')::interval
  )
  returning id into v_project_id;

  for i in 1 .. array_length(v_milestones, 1) loop
    insert into public.project_milestones (project_id, key, label, sequence, status)
    values (v_project_id, v_milestones[i][1]::public.milestone_key, v_milestones[i][2], i, 'pending');
  end loop;

  perform public.reserve_stock_for_project(v_project_id, new.quotation_id);

  insert into public.invoices (
    invoice_number, project_id, client_id, stage, amount, status, issued_at, due_at
  )
  values (
    'INV-' || to_char(now(), 'YYYY') || '-' || nextval('public.invoice_ref_seq'),
    v_project_id,
    new.client_id,
    'down_payment',
    round(new.contract_value * new.down_payment_pct / 100, 2),
    'sent',
    current_date,
    current_date + (v_due_days || ' days')::interval
  )
  on conflict (project_id, stage) do nothing;

  update public.leads set stage = 'contract' where id = new.lead_id;

  perform public.write_audit(
    'Contract executed; project created',
    'contracts',
    new.id::text,
    'critical',
    jsonb_build_object('project_id', v_project_id, 'value', new.contract_value)
  );

  return new;
end;
$$;

revoke all on function public.on_contract_executed() from public, anon, authenticated;


-- --- Milestone invoices and maintenance interval ----------------------------
create or replace function public.on_milestone_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project record;
  v_pct numeric;
  v_stage public.payment_stage;
  v_due_days integer := public.setting_num('finance.milestone_due_days', 15)::integer;
  v_maint_months integer := public.setting_num('operations.maintenance_interval_months', 12)::integer;
begin
  if new.status <> 'done' or coalesce(old.status, 'pending') = 'done' then
    return new;
  end if;

  select p.*, c.delivery_pct, c.commissioning_pct
  into v_project
  from public.projects p
  left join public.contracts c on c.id = p.contract_id
  where p.id = new.project_id;

  if v_project.client_id is not null then
    insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
    values (
      v_project.client_id,
      new.label || ' completed',
      'Your installation has moved forward: ' || new.label ||
        ' is now complete. You can see the full timeline in your portal.',
      'in_app', 'milestone', 'projects', new.project_id::text
    );

    insert into public.notifications (user_id, to_email, title, body, channel, category, entity, entity_id)
    select
      v_project.client_id, pr.email,
      new.label || ' completed',
      'Your installation has moved forward: ' || new.label || ' is now complete.',
      'email', 'milestone', 'projects', new.project_id::text
    from public.profiles pr
    left join public.notification_preferences np on np.user_id = pr.id
    where pr.id = v_project.client_id and coalesce(np.milestone_email, true);
  end if;

  -- The percentage comes from the CONTRACT, not from settings: changing the
  -- company default must never rewrite what an existing customer already signed.
  if new.key = 'ac_wiring' then
    v_stage := 'delivery';
    v_pct := coalesce(v_project.delivery_pct, public.setting_num('finance.delivery_pct', 35));
  elsif new.key = 'commissioning' then
    v_stage := 'commissioning';
    v_pct := coalesce(v_project.commissioning_pct, public.setting_num('finance.commissioning_pct', 15));
  end if;

  if v_stage is not null then
    insert into public.invoices (
      invoice_number, project_id, client_id, stage, amount,
      status, issued_at, due_at, triggered_by_milestone
    )
    values (
      'INV-' || to_char(now(), 'YYYY') || '-' || nextval('public.invoice_ref_seq'),
      new.project_id, v_project.client_id, v_stage,
      round(v_project.contract_value * v_pct / 100, 2),
      'sent', current_date, current_date + (v_due_days || ' days')::interval, new.key
    )
    on conflict (project_id, stage) do nothing;
  end if;

  if new.key = 'turnover' then
    update public.projects
    set status = 'completed', actual_turnover = current_date, warranty_start_date = current_date
    where id = new.project_id;

    insert into public.maintenance_schedules (project_id, due_date)
    values (new.project_id, current_date + (v_maint_months || ' months')::interval);
  end if;

  perform public.write_audit(
    'Milestone completed: ' || new.label,
    'project_milestones', new.id::text, 'info',
    jsonb_build_object('project_id', new.project_id, 'key', new.key)
  );

  return new;
end;
$$;

revoke all on function public.on_milestone_completed() from public, anon, authenticated;


-- --- New contracts default to the configured payment split ------------------
alter table public.contracts
  alter column down_payment_pct set default 50,
  alter column delivery_pct set default 35,
  alter column commissioning_pct set default 15;

create or replace function public.apply_contract_payment_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_down numeric := public.setting_num('finance.down_payment_pct', 50);
  v_del  numeric := public.setting_num('finance.delivery_pct', 35);
  v_com  numeric := public.setting_num('finance.commissioning_pct', 15);
begin
  -- Only fill in a contract that has not set its own split, and only when the
  -- configured stages actually total 100 — otherwise leave the column defaults,
  -- which are known to be valid. A misconfigured setting must not make it
  -- impossible to create a contract.
  if new.down_payment_pct = 50 and new.delivery_pct = 35 and new.commissioning_pct = 15
     and v_down + v_del + v_com = 100 then
    new.down_payment_pct := v_down;
    new.delivery_pct := v_del;
    new.commissioning_pct := v_com;
  end if;
  return new;
end;
$$;

create trigger contract_payment_defaults
  before insert on public.contracts
  for each row execute function public.apply_contract_payment_defaults();

revoke all on function public.apply_contract_payment_defaults() from public, anon, authenticated;


-- --- New stock items default to the configured reorder point ----------------
create or replace function public.apply_stock_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reorder_point = 0 then
    new.reorder_point := public.setting_num('inventory.default_reorder_point', 20);
  end if;
  return new;
end;
$$;

create trigger stock_item_defaults
  before insert on public.stock_items
  for each row execute function public.apply_stock_defaults();

revoke all on function public.apply_stock_defaults() from public, anon, authenticated;
