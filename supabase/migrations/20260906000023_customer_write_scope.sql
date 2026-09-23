-- ============================================================================
-- 0023 · WHAT A CUSTOMER MAY ACTUALLY CHANGE
-- ----------------------------------------------------------------------------
-- Closes a severe hole in contract signing, and the same mistake in two milder
-- places. Also adds the reference generation the quotation builder needs.
--
-- THE HOLE
-- `contracts_sign_client` was written to let a customer sign their own contract:
--
--     for update to authenticated
--     using (client_id = auth.uid())
--     with check (client_id = auth.uid())
--
-- That reads like "a customer may sign their own contract". It actually says "a
-- customer may rewrite every column of their own contract". RLS grants access to
-- ROWS, not to columns, and the check only re-states which row — so it permits
-- any change at all so long as the row stays theirs.
--
-- Verified against the live database before writing this. Signed in as the demo
-- customer, all three of these succeeded:
--
--     update contracts set contract_value = 1            -- PHP 680,000 -> PHP 1
--     update contracts set company_signed_at = now()     -- forged our signature
--     update contracts set down_payment_pct = 1          -- rewrote the schedule
--
-- And it gets worse when combined with the constraint that was supposed to be
-- the safety net:
--
--     constraint contracts_executed_needs_both_signatures
--       check (status <> 'executed' or (client_signed_at is not null
--                                       and company_signed_at is not null))
--
-- That only requires both timestamps to be NOT NULL — and the customer can set
-- both. So a customer could execute their own contract at any value they liked,
-- which fires `on_contract_executed`: a project is created, warehouse stock is
-- reserved against it, and a down-payment invoice is issued for half of one
-- peso. Every downstream record would look perfectly ordinary.
--
-- THE FIX, AND WHY IT IS A TRIGGER
-- Postgres has no column-level RLS. `GRANT UPDATE (col)` exists, but it applies
-- to a database role rather than to a condition, and every signed-in user shares
-- the `authenticated` role — so it cannot express "staff may change the value,
-- the customer may only sign".
--
-- A BEFORE UPDATE trigger can. It compares the new row with the old one and
-- rejects any change outside the allow-list when the person making it is not
-- staff. Same reasoning as 0022: the rule lives where it cannot be gone around.
-- ============================================================================


-- ============================================================================
-- 1 · CONTRACTS — a customer may sign, and nothing else
-- ============================================================================

create or replace function public.enforce_contract_client_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  -- Staff changes are governed by contracts_write_staff and are none of this
  -- function's business. The service role (auth.uid() is null) is the Edge
  -- Function layer, which does its own authorisation.
  if v_actor is null or public.is_staff() then
    return new;
  end if;

  -- Anyone else reaching this point is the customer named on the contract,
  -- because contracts_sign_client is the only other policy that permits it.

  if new.contract_value is distinct from old.contract_value
     or new.down_payment_pct is distinct from old.down_payment_pct
     or new.delivery_pct is distinct from old.delivery_pct
     or new.commissioning_pct is distinct from old.commissioning_pct
     or new.quotation_id is distinct from old.quotation_id
     or new.lead_id is distinct from old.lead_id
     or new.client_id is distinct from old.client_id
     or new.financing_approved is distinct from old.financing_approved
     or new.reference is distinct from old.reference then
    raise exception 'The terms of a contract cannot be changed from the customer portal.'
      using errcode = '42501';
  end if;

  -- The counter-signature is ours to give.
  if new.company_signed_at is distinct from old.company_signed_at
     or new.company_signed_by is distinct from old.company_signed_by then
    raise exception 'Only SolarBros can add the company signature.'
      using errcode = '42501';
  end if;

  -- Signing is a one-way door. Without this a customer could clear their own
  -- signature after work had started and dispute that they ever agreed.
  if old.client_signed_at is not null
     and new.client_signed_at is distinct from old.client_signed_at then
    raise exception 'This contract has already been signed.'
      using errcode = '42501';
  end if;

  -- The only status move a customer may make: accepting a contract that is
  -- waiting for them, which hands it back to us for counter-signature. In
  -- particular they cannot reach 'executed', which is what creates the project
  -- and reserves stock.
  if new.status is distinct from old.status then
    if not (old.status = 'awaiting_client' and new.status = 'awaiting_company') then
      raise exception 'A contract cannot be moved to that state from the customer portal.'
        using errcode = '42501';
    end if;
  end if;

  -- Record where the signature came from rather than trusting the browser to
  -- report it. A signature with no provenance is hard to stand behind if it is
  -- ever disputed.
  if new.client_signed_at is not null and old.client_signed_at is null then
    new.client_signed_at := now();
    if new.client_signature_name is null or length(trim(new.client_signature_name)) < 2 then
      raise exception 'Please type your full name to sign.' using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

create trigger contracts_client_scope
  before update on public.contracts
  for each row execute function public.enforce_contract_client_scope();

revoke all on function public.enforce_contract_client_scope() from public, anon, authenticated;


-- ============================================================================
-- 2 · APPOINTMENTS — the same shape, smaller stakes
-- ----------------------------------------------------------------------------
-- `appointments_update_client` has the identical problem. A customer could mark
-- their own visit 'completed', which fabricates a service record, or set it to
-- 'dispatched', which fires the "a team has been assigned" SMS to themselves
-- when no team has been assigned to anything.
--
-- Rescheduling and adding notes are genuinely theirs to do. Deciding that work
-- happened is not.
-- ============================================================================

create or replace function public.enforce_appointment_client_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or public.is_staff() then
    return new;
  end if;

  if new.project_id is distinct from old.project_id
     or new.client_id is distinct from old.client_id
     or new.lead_id is distinct from old.lead_id
     or new.completed_at is distinct from old.completed_at then
    raise exception 'That cannot be changed from the customer portal.'
      using errcode = '42501';
  end if;

  -- A customer may cancel, and may not declare work done or crews assigned.
  if new.status is distinct from old.status and new.status <> 'cancelled' then
    raise exception 'Only SolarBros can change the status of a visit.'
      using errcode = '42501';
  end if;

  -- Rescheduling a visit that has already happened is not rescheduling.
  if old.status in ('completed', 'in_progress')
     and new.scheduled_date is distinct from old.scheduled_date then
    raise exception 'This visit has already taken place. Please book a new one.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger appointments_client_scope
  before update on public.appointments
  for each row execute function public.enforce_appointment_client_scope();

revoke all on function public.enforce_appointment_client_scope() from public, anon, authenticated;


-- ============================================================================
-- 3 · NOTIFICATIONS — make the comment true
-- ----------------------------------------------------------------------------
-- The policy in 0007 carries the comment "Marking as read is the only field a
-- recipient may change", and then does not enforce it. The impact is small —
-- you can only rewrite your own notifications — but a comment that describes a
-- guarantee the code does not provide is worse than no comment, because the
-- next person reads it and believes it.
-- ============================================================================

create or replace function public.enforce_notification_read_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.is_admin() then
    return new;
  end if;

  if new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.user_id is distinct from old.user_id
     or new.category is distinct from old.category
     or new.entity is distinct from old.entity
     or new.entity_id is distinct from old.entity_id
     or new.delivery_status is distinct from old.delivery_status then
    raise exception 'A notification can only be marked as read.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger notifications_read_only
  before update on public.notifications
  for each row execute function public.enforce_notification_read_only();

revoke all on function public.enforce_notification_read_only() from public, anon, authenticated;


-- ============================================================================
-- 4 · REFERENCE NUMBERS
-- ----------------------------------------------------------------------------
-- The sequences were created in 0008 and used by the automation, but quotations
-- and contracts created from the UI had no way to get one — `reference` is NOT
-- NULL with no default, so the builder would have had to invent numbers in the
-- browser. Two reps clicking Save at the same moment would then be handed the
-- same one, and the unique constraint would reject the second with an error
-- about nothing they did.
--
-- A sequence cannot produce a duplicate, which is the entire point of using one.
-- ============================================================================

create or replace function public.set_quotation_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reference is null or new.reference = '' then
    new.reference := 'QTN-' || to_char(now(), 'YYYY') || '-' ||
                     nextval('public.quotation_ref_seq')::text;
  end if;
  return new;
end;
$$;

create trigger quotations_reference
  before insert on public.quotations
  for each row execute function public.set_quotation_reference();

create or replace function public.set_contract_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reference is null or new.reference = '' then
    new.reference := 'CON-' || to_char(now(), 'YYYY') || '-' ||
                     nextval('public.contract_ref_seq')::text;
  end if;
  return new;
end;
$$;

create trigger contracts_reference
  before insert on public.contracts
  for each row execute function public.set_contract_reference();

revoke all on function public.set_quotation_reference() from public, anon, authenticated;
revoke all on function public.set_contract_reference() from public, anon, authenticated;

comment on function public.enforce_contract_client_scope() is
  'RLS grants row access, not column access. This is what limits a customer to signing.';
