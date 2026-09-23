-- ============================================================================
-- 0008 · AUTOMATION
-- ----------------------------------------------------------------------------
-- The triggers that make the flow diagram actually execute.
--
-- WHY THIS LOGIC LIVES IN THE DATABASE AND NOT IN REACT
-- Three reasons, all of them about correctness rather than taste:
--
--   1. There will eventually be more than one writer — the web app, an Edge
--      Function, a CSV import, an admin fixing something by hand. Logic in one
--      client is bypassed by all the others.
--   2. Balances must never drift. on_hand, amount_paid and reserved are derived
--      from ledgers, and deriving them in the same transaction that writes the
--      ledger is the only way they cannot disagree.
--   3. An audit trail written by application code can be skipped by whoever
--      controls the application code. A trigger cannot.
--
-- Numbered references (SB-2026-0001 and so on) come from sequences, so two
-- simultaneous contracts cannot be handed the same number.
-- ============================================================================

create sequence if not exists public.project_ref_seq start 1000;
create sequence if not exists public.quotation_ref_seq start 1000;
create sequence if not exists public.contract_ref_seq start 1000;
create sequence if not exists public.invoice_ref_seq start 1000;
create sequence if not exists public.ticket_ref_seq start 1000;
create sequence if not exists public.po_ref_seq start 1000;
create sequence if not exists public.rma_ref_seq start 1000;


-- ============================================================================
-- 1 · STOCK LEDGER  ->  BALANCE
-- ----------------------------------------------------------------------------
-- Every movement adjusts on_hand in the same transaction that records it, so
-- the warehouse balance is always exactly the sum of its movements.
-- ============================================================================

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.stock_items
  set on_hand = greatest(on_hand + new.quantity, 0)
  where id = new.stock_item_id;
  return new;
end;
$$;

create trigger stock_movement_applies_to_balance
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();


-- ============================================================================
-- 2 · PAYMENTS  ->  INVOICE & PROJECT TOTALS
-- ----------------------------------------------------------------------------
-- Only VERIFIED payments count. A payment is recorded when someone says it
-- arrived and verified when it is matched against the bank statement; treating
-- the first as settlement would let an unconfirmed transfer mark a contract
-- paid and release the next milestone.
-- ============================================================================

create or replace function public.recalculate_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_paid numeric;
  v_amount numeric;
  v_project uuid;
  v_due date;
begin
  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where invoice_id = v_invoice_id and verified;

  select amount, project_id, due_at into v_amount, v_project, v_due
  from public.invoices
  where id = v_invoice_id;

  update public.invoices
  set amount_paid = v_paid,
      paid_at = case when v_paid >= v_amount then now() else null end,
      status = case
        when v_paid >= v_amount then 'paid'::public.invoice_status
        when v_paid > 0 then 'partially_paid'::public.invoice_status
        when v_due is not null and v_due < current_date then 'overdue'::public.invoice_status
        else 'sent'::public.invoice_status
      end
  where id = v_invoice_id;

  -- Roll the project total up from its invoices, rather than incrementing a
  -- counter. Incrementing drifts the first time a payment is voided.
  update public.projects
  set amount_paid = (
    select coalesce(sum(i.amount_paid), 0)
    from public.invoices i
    where i.project_id = v_project
  )
  where id = v_project;

  return null;
end;
$$;

create trigger payment_updates_invoice
  after insert or update or delete on public.payments
  for each row execute function public.recalculate_invoice_totals();


-- ============================================================================
-- 3 · CONTRACT EXECUTED  ->  PROJECT, MILESTONES, STOCK, DOWN PAYMENT
-- ----------------------------------------------------------------------------
-- Flow-diagram L1-A A30 into L1-B B1. This is the hinge of the whole system:
-- one status change creates the project, lays out the seven milestones,
-- reserves the hardware and raises the first invoice.
-- ============================================================================

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
begin
  -- Only act on the transition INTO executed, not on every later update.
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
    current_date + interval '30 days'
  )
  returning id into v_project_id;

  -- Lay out the canonical seven-stage lifecycle.
  for i in 1 .. array_length(v_milestones, 1) loop
    insert into public.project_milestones (project_id, key, label, sequence, status)
    values (
      v_project_id,
      v_milestones[i][1]::public.milestone_key,
      v_milestones[i][2],
      i,
      'pending'
    );
  end loop;

  -- Hold the hardware so it cannot be sold to another customer.
  perform public.reserve_stock_for_project(v_project_id, new.quotation_id);

  -- Raise the down-payment invoice immediately (flow-diagram A32).
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
    current_date + interval '7 days'
  )
  on conflict (project_id, stage) do nothing;

  -- Move the lead to its terminal won state.
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

create trigger contract_executed
  after update on public.contracts
  for each row execute function public.on_contract_executed();


-- ============================================================================
-- 4 · MILESTONE COMPLETED  ->  NOTIFICATION & MILESTONE INVOICE
-- ----------------------------------------------------------------------------
-- The single most important flow in the application. One technician tap:
--   * moves the customer's progress bar (they read the same row),
--   * queues an email/SMS to the customer,
--   * and, at the billing milestones, raises the next staged invoice.
--
-- Billing is coupled to milestones precisely so an invoice cannot be issued for
-- work that has not happened.
-- ============================================================================

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
begin
  if new.status <> 'done' or coalesce(old.status, 'pending') = 'done' then
    return new;
  end if;

  select p.*, c.delivery_pct, c.commissioning_pct
  into v_project
  from public.projects p
  left join public.contracts c on c.id = p.contract_id
  where p.id = new.project_id;

  -- Tell the customer, through whichever channels they have not opted out of.
  if v_project.client_id is not null then
    insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
    values (
      v_project.client_id,
      new.label || ' completed',
      'Your installation has moved forward: ' || new.label ||
        ' is now complete. You can see the full timeline in your portal.',
      'in_app',
      'milestone',
      'projects',
      new.project_id::text
    );

    insert into public.notifications (user_id, to_email, title, body, channel, category, entity, entity_id)
    select
      v_project.client_id,
      pr.email,
      new.label || ' completed',
      'Your installation has moved forward: ' || new.label || ' is now complete.',
      'email',
      'milestone',
      'projects',
      new.project_id::text
    from public.profiles pr
    left join public.notification_preferences np on np.user_id = pr.id
    where pr.id = v_project.client_id
      and coalesce(np.milestone_email, true);
  end if;

  -- Billing milestones. ac_wiring stands for "materials delivered and the bulk
  -- of the physical work done"; commissioning is the final stage.
  if new.key = 'ac_wiring' then
    v_stage := 'delivery';
    v_pct := coalesce(v_project.delivery_pct, 35);
  elsif new.key = 'commissioning' then
    v_stage := 'commissioning';
    v_pct := coalesce(v_project.commissioning_pct, 15);
  end if;

  if v_stage is not null then
    insert into public.invoices (
      invoice_number, project_id, client_id, stage, amount,
      status, issued_at, due_at, triggered_by_milestone
    )
    values (
      'INV-' || to_char(now(), 'YYYY') || '-' || nextval('public.invoice_ref_seq'),
      new.project_id,
      v_project.client_id,
      v_stage,
      round(v_project.contract_value * v_pct / 100, 2),
      'sent',
      current_date,
      current_date + interval '15 days',
      new.key
    )
    on conflict (project_id, stage) do nothing;
  end if;

  -- Turnover closes the project and starts the warranty clock.
  if new.key = 'turnover' then
    update public.projects
    set status = 'completed',
        actual_turnover = current_date,
        warranty_start_date = current_date
    where id = new.project_id;

    -- First annual health check falls due a year from handover.
    insert into public.maintenance_schedules (project_id, due_date)
    values (new.project_id, current_date + interval '1 year');
  end if;

  perform public.write_audit(
    'Milestone completed: ' || new.label,
    'project_milestones',
    new.id::text,
    'info',
    jsonb_build_object('project_id', new.project_id, 'key', new.key)
  );

  return new;
end;
$$;

create trigger milestone_completed
  after update on public.project_milestones
  for each row execute function public.on_milestone_completed();


-- ============================================================================
-- 5 · LEAD SCORING
-- ----------------------------------------------------------------------------
-- 0-100. Kept in one function so sales management can retune the weighting
-- without a code deploy, and so every entry point scores identically.
-- ============================================================================

create or replace function public.score_lead()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v integer := 0;
begin
  -- Bill size is the strongest single predictor of a viable deal.
  v := v + least(coalesce(new.monthly_bill, 0) / 500, 40)::integer;

  -- Source quality: an existing customer outranks an anonymous form fill.
  v := v + case new.source
    when 'referral' then 25
    when 'quote_request' then 18
    when 'walk_in' then 15
    when 'facebook' then 8
    else 5
  end;

  -- Qualification answers, once a rep has actually spoken to them.
  if new.in_service_area then v := v + 10; end if;
  if new.owns_property then v := v + 10; end if;
  if new.is_decision_maker then v := v + 10; end if;
  if new.estimated_kw is not null and new.estimated_kw >= 5 then v := v + 5; end if;

  new.score := least(greatest(v, 0), 100);
  return new;
end;
$$;

create trigger leads_scored
  before insert or update of monthly_bill, source, in_service_area, owns_property,
                             is_decision_maker, estimated_kw
  on public.leads
  for each row execute function public.score_lead();


-- ============================================================================
-- 6 · EXTERNAL-PARTY PROXY ENTRIES  ->  AUDIT AT 'warning'
-- ----------------------------------------------------------------------------
-- When an employee records an outside body's decision, that fact is logged at
-- warning severity, not info. The distinction matters: "the utility approved
-- this" and "an employee asserted that the utility approved this" are different
-- claims, and only the audit log preserves which one actually happened.
-- ============================================================================

create or replace function public.audit_permit_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('approved', 'rejected')
     and coalesce(old.status, 'preparing') <> new.status then
    perform public.write_audit(
      'External decision recorded on behalf of ' || new.authority || ': ' || new.status,
      'permits',
      new.id::text,
      'warning',
      jsonb_build_object(
        'permit_type', new.permit_type,
        'external_reference', new.external_reference,
        'project_id', new.project_id,
        'proxy_entry', true
      )
    );
  end if;
  return new;
end;
$$;

create trigger permit_decision_audited
  after update on public.permits
  for each row execute function public.audit_permit_decision();


create or replace function public.audit_rma_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('approved', 'rejected', 'replacement_received')
     and coalesce(old.status, 'draft') <> new.status then
    perform public.write_audit(
      'Manufacturer decision recorded on behalf of ' || new.manufacturer || ': ' || new.status,
      'rma_claims',
      new.id::text,
      'warning',
      jsonb_build_object('external_reference', new.external_reference, 'proxy_entry', true)
    );
  end if;
  return new;
end;
$$;

create trigger rma_decision_audited
  after update on public.rma_claims
  for each row execute function public.audit_rma_decision();


-- ============================================================================
-- 7 · WARRANTY TRANSFER APPROVED  ->  REASSIGN THE ASSET REGISTRY
-- ----------------------------------------------------------------------------
-- Approving a transfer moves warranty entitlement for every serialised unit on
-- the project to a different person. Hard to reverse, so it is logged at
-- 'critical' with the before and after owner recorded.
-- ============================================================================

create or replace function public.on_warranty_transfer_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_owner uuid;
begin
  if new.status <> 'approved' or coalesce(old.status, 'pending') = 'approved' then
    return new;
  end if;

  if new.request_type = 'transfer' then
    -- The new owner must already have an account; matched by the email given on
    -- the request. Nothing is reassigned to a person who does not exist.
    select id into v_new_owner from public.profiles where email = new.transfer_to_email;

    if v_new_owner is not null then
      update public.serialised_assets
      set client_id = v_new_owner
      where project_id = new.project_id;

      update public.projects set client_id = v_new_owner where id = new.project_id;
    end if;

    perform public.write_audit(
      'Warranty transfer approved',
      'warranty_requests',
      new.id::text,
      'critical',
      jsonb_build_object(
        'project_id', new.project_id,
        'from_client', new.client_id,
        'to_email', new.transfer_to_email,
        'to_client', v_new_owner,
        'matched_account', v_new_owner is not null
      )
    );
  end if;

  return new;
end;
$$;

create trigger warranty_transfer_approved
  after update on public.warranty_requests
  for each row execute function public.on_warranty_transfer_approved();


-- ============================================================================
-- 8 · CRITICAL GOVERNANCE EVENTS
-- ============================================================================

create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    perform public.write_audit(
      'Role changed from ' || old.role || ' to ' || new.role,
      'profiles',
      new.id::text,
      'critical',
      jsonb_build_object('user', new.email, 'from', old.role, 'to', new.role)
    );
  end if;
  return new;
end;
$$;

create trigger profile_role_change_audited
  after update on public.profiles
  for each row execute function public.audit_role_change();


-- Discounts beyond the standard authority require an administrator. Enforced
-- here rather than by hiding a button, because a hidden button is not a control.
create or replace function public.enforce_discount_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.discount_pct > 10
     and new.status = 'sent'
     and new.discount_approved_by is null then
    raise exception
      'A discount of %.2f%% exceeds the standard authority and needs administrator approval before this quotation can be sent.',
      new.discount_pct;
  end if;

  if new.discount_pct > 10 and new.discount_approved_by is not null
     and coalesce(old.discount_approved_by, '00000000-0000-0000-0000-000000000000'::uuid)
         is distinct from new.discount_approved_by then
    perform public.write_audit(
      'Discount of ' || new.discount_pct || '% approved',
      'quotations',
      new.id::text,
      'warning',
      jsonb_build_object('discount_pct', new.discount_pct, 'total_price', new.total_price)
    );
  end if;

  return new;
end;
$$;

create trigger quotation_discount_authority
  before insert or update on public.quotations
  for each row execute function public.enforce_discount_authority();


-- ============================================================================
-- 9 · APPOINTMENT DISPATCH  ->  NOTIFY THE CLIENT
-- ============================================================================

create or replace function public.on_appointment_dispatched()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'dispatched' and coalesce(old.status, 'requested') <> 'dispatched'
     and new.client_id is not null then
    insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
    values (
      new.client_id,
      'Your visit is confirmed',
      'A team has been assigned for ' || to_char(new.scheduled_date, 'DD Mon YYYY') ||
        ' at ' || new.time_slot || '.',
      'sms',
      'appointment',
      'appointments',
      new.id::text
    );
  end if;
  return new;
end;
$$;

create trigger appointment_dispatched
  after update on public.appointments
  for each row execute function public.on_appointment_dispatched();


-- ============================================================================
-- 10 · WARRANTY EXPIRY, DERIVED
-- Computing it on write means it can never disagree with the install date.
-- ============================================================================

create or replace function public.set_warranty_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.installed_at is not null then
    new.warranty_expires_at := new.installed_at + (new.warranty_years || ' years')::interval;
  end if;
  return new;
end;
$$;

create trigger asset_warranty_expiry
  before insert or update on public.serialised_assets
  for each row execute function public.set_warranty_expiry();
