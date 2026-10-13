-- ============================================================================
-- 0072  THE STEPS BETWEEN ROLES THAT DID NOT CONNECT
-- ----------------------------------------------------------------------------
-- Found by walking a project through every role in turn rather than by reading
-- any one screen. Each of these looked complete from the side that wrote it:
--
--   1. A DELIVERY NEVER REACHED THE PROJECT THAT WAS WAITING FOR IT.
--      A contract signed while stock was low reserves what it can and marks
--      the rest 'short'. Receiving the purchase order raised `on_hand` and did
--      nothing else, so the reservation stayed short for ever, the materials
--      half of the synchronise gate never opened, and structural mounting
--      could only ever be started by an administrator override.
--
--   2. A TECHNICIAN SENT TO A JOB WAS NEVER ON ITS CREW.
--      Dispatch writes `appointment_assignees`; every project permission a
--      technician has — reading the project, moving its milestones, logging
--      stock against it — checks `project_crew`, which nothing wrote. On a
--      real project the field portal could do none of its job.
--
--   3. A DISCOUNT ABOVE AUTHORITY COULD NEVER BE APPROVED.
--      The trigger refused it outright and nothing anywhere set
--      `discount_approved_by`. It now waits as 'pending_approval' for an
--      administrator, and an administrator's own quotation is approved by the
--      act of saving it.
--
--   4. WHO DID IT WAS STILL TAKEN FROM THE BROWSER IN FIVE PLACES.
--      Milestone completion, payment verification, the purchase-order match,
--      permit decisions and warranty reviews. Each now takes the person from
--      the session, as payments (0022) and contracts (0023) already did.
--
-- Plus the smaller gaps listed at each section.
-- ============================================================================


-- ============================================================================
-- 1. NEW STOCK GOES TO THE PROJECTS WAITING FOR IT
-- ============================================================================
-- Oldest reservation first: the customer who signed first is the one whose
-- installation has waited longest. Completed and cancelled projects are not
-- waiting for anything.

create or replace function public.allocate_short_reservations(p_stock_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available numeric;
  v_add numeric;
  r record;
  v_ready record;
  v_projects uuid[] := '{}';
begin
  select si.on_hand - si.reserved into v_available
  from public.stock_items si
  where si.id = p_stock_item_id
  for update;

  if coalesce(v_available, 0) <= 0 then
    return;
  end if;

  for r in
    select sr.id, sr.project_id, sr.quantity, sr.quantity_held
    from public.stock_reservations sr
    join public.projects p on p.id = sr.project_id
    where sr.stock_item_id = p_stock_item_id
      and sr.status = 'short'
      and p.status not in ('cancelled', 'completed')
    order by sr.created_at, sr.id
    for update of sr
  loop
    exit when v_available <= 0;

    v_add := least(v_available, r.quantity - r.quantity_held);
    continue when v_add <= 0;

    update public.stock_reservations
    set quantity_held = quantity_held + v_add,
        status = case
          when quantity_held + v_add >= quantity then 'reserved'::public.reservation_status
          else 'short'::public.reservation_status
        end
    where id = r.id;

    update public.stock_items
    set reserved = reserved + v_add
    where id = p_stock_item_id;

    v_available := v_available - v_add;
    v_projects := array_append(v_projects, r.project_id);
  end loop;

  /* Tell the engineer the moment a project's materials are complete. "Why
     can't the crew start?" should be answered before anybody asks it. */
  for v_ready in
    select distinct p.id, p.reference, p.assigned_engineer
    from public.projects p
    where p.id = any (v_projects)
      and not exists (
        select 1 from public.stock_reservations sr
        where sr.project_id = p.id and sr.status = 'short'
      )
  loop
    insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
    select pr.id,
           'Materials ready for ' || v_ready.reference,
           'Every line on the bill of materials is now held in the warehouse. Once the permits are approved the crew can start structural mounting.',
           'in_app', 'operations', 'projects', v_ready.id::text
    from public.profiles pr
    where pr.is_active
      and (
        pr.id = v_ready.assigned_engineer
        or (v_ready.assigned_engineer is null and pr.role in ('project_engineer', 'admin'))
      );
  end loop;
end;
$$;

revoke all on function public.allocate_short_reservations(uuid) from public, anon, authenticated;


create or replace function public.stock_movement_tops_up()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quantity > 0 then
    perform public.allocate_short_reservations(new.stock_item_id);
  end if;
  return null;
end;
$$;

/* Named so it sorts after `stock_movement_applies_to_balance`: AFTER triggers
   on the same event fire in name order, and this one must see the raised
   balance. */
drop trigger if exists stock_movement_tops_up_reservations on public.stock_movements;
create trigger stock_movement_tops_up_reservations
  after insert on public.stock_movements
  for each row execute function public.stock_movement_tops_up();


-- Released stock (a cancelled project) is free for the next project too.
-- 0026's body, plus the allocation after each release.
create or replace function public.release_project_reservations(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if (select auth.uid()) is not null
     and not public.has_role('inventory_manager', 'project_engineer', 'admin') then
    raise exception 'Not authorised to release reserved stock' using errcode = '42501';
  end if;

  for r in
    select id, stock_item_id, quantity_held
    from public.stock_reservations
    where project_id = p_project_id and status in ('reserved', 'short')
    for update
  loop
    if coalesce(r.quantity_held, 0) > 0 then
      update public.stock_items
      set reserved = greatest(reserved - r.quantity_held, 0)
      where id = r.stock_item_id;
    end if;

    update public.stock_reservations
    set quantity_held = 0, status = 'released'
    where id = r.id;

    -- ADDED 0072
    perform public.allocate_short_reservations(r.stock_item_id);
  end loop;
end;
$$;


-- Whatever is already sitting short and could be covered now.
do $$
declare
  r record;
begin
  for r in
    select distinct stock_item_id
    from public.stock_reservations
    where status = 'short'
  loop
    perform public.allocate_short_reservations(r.stock_item_id);
  end loop;
end;
$$;


-- ============================================================================
-- 2. WHOEVER IS SENT TO A PROJECT IS ON ITS CREW
-- ============================================================================

create or replace function public.assignee_joins_crew()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_crew (project_id, user_id, crew_role)
  select a.project_id,
         new.user_id,
         case pr.role when 'project_engineer' then 'engineer' else 'technician' end
  from public.appointments a
  join public.profiles pr on pr.id = new.user_id
  where a.id = new.appointment_id
    and a.project_id is not null
  on conflict (project_id, user_id) do nothing;

  return null;
end;
$$;

drop trigger if exists appointment_assignee_joins_crew on public.appointment_assignees;
create trigger appointment_assignee_joins_crew
  after insert on public.appointment_assignees
  for each row execute function public.assignee_joins_crew();


-- A visit linked to its project after the crew was assigned.
create or replace function public.appointment_project_crew()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is not null and new.project_id is distinct from old.project_id then
    insert into public.project_crew (project_id, user_id, crew_role)
    select new.project_id,
           aa.user_id,
           case pr.role when 'project_engineer' then 'engineer' else 'technician' end
    from public.appointment_assignees aa
    join public.profiles pr on pr.id = aa.user_id
    where aa.appointment_id = new.id
    on conflict (project_id, user_id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists appointments_project_crew on public.appointments;
create trigger appointments_project_crew
  after update of project_id on public.appointments
  for each row execute function public.appointment_project_crew();


insert into public.project_crew (project_id, user_id, crew_role)
select distinct a.project_id,
       aa.user_id,
       case pr.role when 'project_engineer' then 'engineer' else 'technician' end
from public.appointment_assignees aa
join public.appointments a on a.id = aa.appointment_id
join public.profiles pr on pr.id = aa.user_id
where a.project_id is not null
on conflict (project_id, user_id) do nothing;


-- ============================================================================
-- 3. DISCOUNTS ABOVE AUTHORITY WAIT FOR AN ADMINISTRATOR
-- ============================================================================
-- What changed from 0032:
--   · Over authority, the quotation is SAVED as 'pending_approval' instead of
--     refused. Refusing left the rep no route to the approval the message
--     told them they needed.
--   · Only an administrator can approve, and the approval is attributed to
--     the session. Changing the discount afterwards withdraws it.
--   · 'pending_approval' cannot be sent or accepted.

create or replace function public.enforce_discount_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit numeric := public.setting_num('sales.discount_authority_pct', 10);
  v_enabled boolean := coalesce(
    (select value = 'true'::jsonb from public.settings where key = 'sales.discount_enabled'),
    true
  );
  v_actor uuid := (select auth.uid());
  v_is_admin boolean := public.is_admin();
begin
  if coalesce(new.discount_pct, 0) <= 0 then
    new.discount_approved_by := null;
    new.discount_approved_at := null;
    if new.status = 'pending_approval' then
      new.status := 'draft';
    end if;
    return new;
  end if;

  if not v_enabled then
    raise exception
      'Discounting is switched off. Quotations go out at list price — an administrator can change this in Settings.'
      using errcode = '42501';
  end if;

  if new.discount_pct <= v_limit then
    -- Within the rep's own authority: nothing to approve.
    new.discount_approved_by := null;
    new.discount_approved_at := null;
    if new.status = 'pending_approval' then
      new.status := 'draft';
    end if;
    return new;
  end if;

  /* --- Above authority ---------------------------------------------------- */

  -- An approval nobody but an administrator may give.
  if not v_is_admin
     and v_actor is not null
     and new.discount_approved_by is distinct from
         (case when tg_op = 'UPDATE' then old.discount_approved_by else null end) then
    raise exception using
      message = format('Only an administrator can approve a discount above %s%%.', v_limit),
      errcode = '42501';
  end if;

  -- A changed discount is a different request; the old approval does not cover it.
  if tg_op = 'UPDATE'
     and new.discount_pct is distinct from old.discount_pct
     and not (v_is_admin and new.discount_approved_by is not null) then
    new.discount_approved_by := null;
    new.discount_approved_at := null;
  end if;

  -- An administrator saving or approving it is the approval.
  if v_is_admin and v_actor is not null
     and (new.discount_approved_by is not null or tg_op = 'INSERT') then
    new.discount_approved_by := v_actor;
    new.discount_approved_at := coalesce(new.discount_approved_at, now());
  end if;

  if new.discount_approved_by is null then
    if new.status in ('sent', 'accepted') then
      raise exception using
        message = format(
          'A discount of %s%% is above the %s%% authority and needs administrator approval before this quotation can be sent.',
          new.discount_pct, v_limit
        ),
        errcode = '42501';
    end if;
    if new.status = 'draft' then
      new.status := 'pending_approval';
    end if;
  elsif new.status = 'pending_approval' then
    new.status := 'draft';
  end if;

  return new;
end;
$$;


-- ============================================================================
-- 4. TECHNICIANS CAN CLOSE THEIR OWN JOBS (see 0071 for the trigger body);
--    WHO DID IT COMES FROM THE SESSION
-- ============================================================================

-- 4a. Milestones. 0027's body; only the attribution line changes, from "if the
-- browser sent nobody, use the session" to "always the session when there is
-- one". The field portal sent `completed_by` itself.
create or replace function public.enforce_milestone_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocker record;
  v_gate jsonb;
  v_is_admin boolean := public.is_admin();
  v_forced boolean := false;
begin
  -- Only interested in moving forward. Anyone may reopen or block a stage.
  if new.status not in ('in_progress', 'done')
     or new.status = coalesce(old.status, 'pending') then
    return new;
  end if;

  -- 'done' needs a timestamp (there is a constraint) and, more usefully, needs
  -- to say who. Taken from the session rather than the request.
  if new.status = 'done' then
    if new.completed_at is null then
      new.completed_at := now();
    end if;
    -- CHANGED 0072: the session wins over whatever the request named.
    new.completed_by := coalesce((select auth.uid()), new.completed_by);
  end if;

  /* --- Rule 1: order ------------------------------------------------------ */
  select key, label, sequence, status into v_blocker
  from public.project_milestones
  where project_id = new.project_id
    and sequence < new.sequence
    and status <> 'done'
  order by sequence
  limit 1;

  if v_blocker.key is not null then
    if not v_is_admin then
      raise exception
        'Cannot start % — % is still %. Stages have to be completed in order.',
        new.label, v_blocker.label, replace(v_blocker.status::text, '_', ' ')
        using errcode = '42501';
    end if;
    v_forced := true;
  end if;

  /* --- Rule 2: the synchronise gate --------------------------------------- */
  if new.key = 'structural_mounting' then
    v_gate := public.project_gate_status(new.project_id);

    if not (v_gate ->> 'permits_ready')::boolean or not (v_gate ->> 'materials_ready')::boolean then
      if not v_is_admin then
        raise exception
          'Physical work cannot start yet. Permits approved: % of %. Materials on site: %. Both have to be clear before a crew is sent.',
          v_gate ->> 'permits_approved',
          v_gate ->> 'permits_total',
          case when (v_gate ->> 'materials_ready')::boolean then 'yes' else 'no' end
          using errcode = '42501';
      end if;
      v_forced := true;
    end if;
  end if;

  /* --- Rule 3: an override is allowed, and is recorded -------------------- */
  if v_forced then
    perform public.write_audit(
      'Milestone "' || new.label || '" forced past its preconditions',
      'project_milestones',
      new.id::text,
      'warning',
      jsonb_build_object(
        'project_id', new.project_id,
        'milestone', new.key,
        'new_status', new.status,
        'blocked_by', coalesce(v_blocker.key::text, 'synchronise gate'),
        'gate', v_gate,
        'override', true
      )
    );
  end if;

  return new;
end;
$$;


-- 4b. Payments. 0050's body, with verification attribution forced to the
-- session and the provenance columns frozen once written.
create or replace function public.enforce_payment_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_balance numeric;
  v_amount numeric;
  v_tolerance numeric := public.setting_num('finance.overpayment_tolerance', 100);
  v_threshold numeric := public.setting_num('finance.dual_control_threshold', 0);
  v_other_payments numeric;
begin
  /* --- Provenance cannot be asserted by the caller ----------------------- */
  if tg_op = 'INSERT' then
    new.recorded_by := v_actor;
  end if;

  if tg_op = 'UPDATE' then
    -- Amount and invoice are settled at insert. Allowing them to be edited
    -- afterwards would let a verified payment be quietly rewritten into a
    -- different one, which is the whole reason refunds are a separate table.
    if new.amount is distinct from old.amount
       or new.invoice_id is distinct from old.invoice_id then
      raise exception 'A recorded payment cannot be altered. Refund it and record a correction.'
        using errcode = '23514';
    end if;

    -- ADDED 0072: who recorded it, and who verified it, are written once.
    new.recorded_by := old.recorded_by;
    if old.verified then
      new.verified := true;
      new.verified_by := old.verified_by;
      new.verified_at := old.verified_at;
    end if;
  end if;

  /* --- Overpayment -------------------------------------------------------- */
  select i.amount into v_amount from public.invoices i where i.id = new.invoice_id;

  select coalesce(sum(p.amount), 0) into v_other_payments
  from public.payments p
  where p.invoice_id = new.invoice_id
    and p.verified
    and p.id <> new.id;

  v_balance := v_amount - v_other_payments;

  if new.amount > v_balance + v_tolerance then
    raise exception
      'That is more than the invoice has outstanding (balance %, tolerance %). Split the payment across the correct invoices.',
      to_char(v_balance, 'FM999,999,990.00'), to_char(v_tolerance, 'FM999,999,990.00')
      using errcode = '23514';
  end if;

  /* --- Separation of duties, when it is switched on ----------------------- */
  if new.verified and (tg_op = 'INSERT' or not old.verified) then
    -- CHANGED 0072: always the session, never a name the request supplied.
    new.verified_by := coalesce(v_actor, new.verified_by);
    new.verified_at := now();

    /* A threshold of 0 means OFF, not "every payment needs two people" — which
       is what `amount >= 0` would otherwise say, and it would lock the
       accountant out of recording anything at all. */
    if v_threshold > 0
       and new.amount >= v_threshold
       and new.verified_by is not distinct from new.recorded_by then
      raise exception
        'A payment of % or more must be verified by someone other than the person who recorded it.',
        to_char(v_threshold, 'FM999,999,990.00')
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;


-- 4c. The three-way match, permit decisions, warranty reviews and RMA
-- decisions: small stamps rather than rebuilt functions, because none of them
-- had a trigger doing this job before.

create or replace function public.stamp_purchase_order_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.matched_at is not null and old.matched_at is null then
    new.matched_by := coalesce((select auth.uid()), new.matched_by);
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_orders_stamp_match on public.purchase_orders;
create trigger purchase_orders_stamp_match
  before update on public.purchase_orders
  for each row execute function public.stamp_purchase_order_match();


create or replace function public.stamp_permit_recorder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('approved', 'rejected')
     and (new.status is distinct from old.status
          or new.recorded_by is distinct from old.recorded_by
          or new.external_reference is distinct from old.external_reference) then
    new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
    new.recorded_at := now();
    new.decided_at := coalesce(new.decided_at, now());
  end if;

  if new.status in ('submitted', 'under_review') and new.submitted_at is null then
    new.submitted_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists permits_stamp_recorder on public.permits;
create trigger permits_stamp_recorder
  before update on public.permits
  for each row execute function public.stamp_permit_recorder();


create or replace function public.stamp_warranty_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists warranty_requests_stamp_review on public.warranty_requests;
create trigger warranty_requests_stamp_review
  before update on public.warranty_requests
  for each row execute function public.stamp_warranty_review();


create or replace function public.stamp_rma_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'filed' then
      new.filed_at := coalesce(new.filed_at, now());
    end if;

    if new.status in ('approved', 'rejected', 'replacement_received', 'closed') then
      new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
      new.recorded_at := now();
      if new.status in ('approved', 'rejected') or new.decision_at is null then
        new.decision_at := coalesce(new.decision_at, now());
      end if;
    end if;
  end if;

  -- The unit that came back is no longer the one installed.
  if new.status = 'replacement_received' and old.status is distinct from 'replacement_received' then
    update public.serialised_assets
    set status = 'replaced'
    where id = new.serialised_asset_id;
  end if;

  return new;
end;
$$;

drop trigger if exists rma_claims_stamp_progress on public.rma_claims;
create trigger rma_claims_stamp_progress
  before update on public.rma_claims
  for each row execute function public.stamp_rma_progress();


-- 4d. The columns that name who created a row default to whoever is signed in,
-- so a screen that forgets to send it still records it.
alter table public.stock_movements alter column created_by set default auth.uid();
alter table public.documents alter column uploaded_by set default auth.uid();
alter table public.site_photos alter column uploaded_by set default auth.uid();
alter table public.serialised_assets alter column scanned_by set default auth.uid();
alter table public.purchase_orders alter column requested_by set default auth.uid();
alter table public.booking_blackouts alter column created_by set default auth.uid();


-- ============================================================================
-- 5. TIME LOGS ARE A RECORD, NOT A DRAFT
-- ============================================================================
-- `time_logs_own` was FOR ALL, so a technician could edit or delete their own
-- hours after the fact — and those hours feed the payroll register. They may
-- write and read their own; correcting one is the accountant's job.

drop policy if exists time_logs_own on public.time_logs;

create policy time_logs_insert_own on public.time_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy time_logs_read_own on public.time_logs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy time_logs_correct_finance on public.time_logs
  for update to authenticated
  using (public.has_role('accountant', 'admin'))
  with check (public.has_role('accountant', 'admin'));

create policy time_logs_delete_finance on public.time_logs
  for delete to authenticated
  using (public.has_role('accountant', 'admin'));


-- ============================================================================
-- 6. A TECHNICIAN SEES THE PEOPLE THEIR WORK INVOLVES, NOT EVERY CUSTOMER
-- ============================================================================
-- `profiles_read_all_internal` used `is_internal()`, which includes
-- technicians — so any technician could list every customer's email address,
-- mobile number and home address. They need colleagues (crew names, messaging)
-- and the customers on the visits they are assigned to (to ring from the gate).

drop policy if exists profiles_read_all_internal on public.profiles;

create policy profiles_read_all_staff on public.profiles
  for select to authenticated
  using (public.is_staff());

create policy profiles_read_for_technicians on public.profiles
  for select to authenticated
  using (
    public.current_user_role() = 'technician'
    and (
      profiles.role <> 'client'
      or exists (
        select 1
        from public.appointments a
        join public.appointment_assignees aa on aa.appointment_id = a.id
        where aa.user_id = (select auth.uid())
          and a.client_id = profiles.id
      )
    )
  );


-- ============================================================================
-- 7. WHO A CUSTOMER MAY MESSAGE
-- ============================================================================
-- 0062's list plus the two people a customer actually deals with day to day:
-- whoever owns their support ticket, and the crew sent to their visits.

create or replace function public.staff_for_client(p_client uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.assigned_engineer
  from public.projects p
  where p.client_id = p_client and p.assigned_engineer is not null

  union

  select pc.user_id
  from public.project_crew pc
  join public.projects p on p.id = pc.project_id
  where p.client_id = p_client

  union

  select l.assigned_to
  from public.leads l
  where l.converted_client_id = p_client and l.assigned_to is not null

  union

  select t.assigned_to
  from public.tickets t
  where t.client_id = p_client and t.assigned_to is not null

  union

  select aa.user_id
  from public.appointment_assignees aa
  join public.appointments a on a.id = aa.appointment_id
  where a.client_id = p_client

  union

  select pr.id
  from public.profiles pr
  where pr.role = 'admin' and pr.is_active;
$$;

revoke all on function public.staff_for_client(uuid) from public, anon, authenticated, service_role;


-- ============================================================================
-- 8. THE BOOKING CALENDAR CAN READ THE BUSINESS HOURS
-- ============================================================================
-- The public calendar greyed out only Sundays and past days, because the two
-- settings that decide which days and times are bookable were private. They
-- describe opening hours, which are published on the same page anyway.

update public.settings
set is_public = true
where key in ('operations.booking_slots', 'operations.booking_weekdays', 'operations.booking_lead_hours');


-- ============================================================================
-- 9. A CUSTOMER CAN SEND US THEIR PROOF OF PAYMENT
-- ============================================================================
-- Payment is by bank transfer, and the instruction on the billing page was to
-- email the receipt — outside the system, to an inbox nobody links to the
-- invoice. It is now uploaded against the project as kind 'receipt', and the
-- finance team is told it has arrived.
--
-- 0043's body plus 'receipt' in the allowed kinds and the notification.

create or replace function public.record_client_upload(
  p_project_id uuid,
  p_storage_path text,
  p_name text,
  p_kind text,
  p_mime_type text default null,
  p_size_kb integer default null,
  p_ticket_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_kind public.document_kind;
  v_id uuid;
  v_reference text;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;

  if not public.owns_project(p_project_id) then
    raise exception 'That is not your project.' using errcode = '42501';
  end if;

  if p_storage_path is null
     or p_storage_path not like p_project_id::text || '/uploads/%' then
    raise exception 'That file was not stored where it should be.' using errcode = '22023';
  end if;

  if p_kind not in ('proof_of_sale', 'receipt', 'other') then
    raise exception 'A customer cannot file a document as %.', p_kind using errcode = '22023';
  end if;
  v_kind := p_kind::public.document_kind;

  if p_ticket_id is not null then
    if not exists (
      select 1 from public.tickets t
      where t.id = p_ticket_id and t.client_id = v_uid
    ) then
      raise exception 'That is not your ticket.' using errcode = '42501';
    end if;
  end if;

  insert into public.documents (
    name, kind, project_id, client_id, ticket_id,
    storage_path, mime_type, size_kb, is_client_visible, uploaded_by
  )
  values (
    left(btrim(coalesce(p_name, 'Upload')), 200),
    v_kind,
    p_project_id,
    v_uid,
    p_ticket_id,
    p_storage_path,
    left(coalesce(p_mime_type, ''), 100),
    greatest(0, coalesce(p_size_kb, 0)),
    true,
    v_uid
  )
  returning id into v_id;

  -- ADDED 0072: money that might have arrived is the finance team's to check.
  if v_kind = 'receipt' then
    select reference into v_reference from public.projects where id = p_project_id;

    insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
    select pr.id,
           'Proof of payment received · ' || coalesce(v_reference, 'project'),
           'A customer uploaded "' || left(btrim(coalesce(p_name, 'a file')), 120) ||
             '". Match it against the bank statement and record the payment.',
           'in_app', 'billing', 'documents', v_id::text
    from public.profiles pr
    where pr.role in ('accountant', 'admin') and pr.is_active;
  end if;

  return v_id;
end;
$$;


-- ============================================================================
-- 10. A PURCHASE ORDER ABOVE THE LIMIT CAN BE SENT UP FOR APPROVAL
-- ============================================================================
-- The refusal message said "set it to pending approval and ask an
-- administrator", and nothing told the administrator. Moving an order to
-- 'pending_approval' now does.

create or replace function public.purchase_order_needs_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending_approval' and old.status is distinct from 'pending_approval' then
    insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
    select pr.id,
           'Purchase order awaiting your approval · ' || new.po_number,
           'Total ' || to_char(new.total_amount, 'FM999,999,990.00') ||
             ' is above the requisition limit. Review it under Purchasing.',
           'in_app', 'operations', 'purchase_orders', new.id::text
    from public.profiles pr
    where pr.role = 'admin' and pr.is_active;
  end if;
  return null;
end;
$$;

drop trigger if exists purchase_orders_need_admin on public.purchase_orders;
create trigger purchase_orders_need_admin
  after update of status on public.purchase_orders
  for each row execute function public.purchase_order_needs_admin();
