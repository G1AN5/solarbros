-- ============================================================================
-- 0047  REFUNDS
-- ----------------------------------------------------------------------------
-- Listed as a known limitation for several sessions: `payments.amount` carries
-- `check (amount > 0)`, so a refund cannot be a negative payment, and there was
-- no other way to reverse money. In practice that meant a cancelled contract or
-- an overpayment was settled outside the system and the ledger stopped being
-- the record — which is the failure this whole application exists to prevent.
--
-- WHY NOT JUST DROP THE CONSTRAINT
-- Because it is doing real work. A negative row in `payments` would be summed
-- by `recalculate_invoice_totals` and would silently reduce a balance with no
-- reason attached, no second person, and nothing to distinguish it from a
-- typo. A refund is a different EVENT from a payment: it points at the payment
-- being reversed, it has to say why, and it must never quietly exceed what was
-- taken. That is a table, not a sign change.
--
-- THE RULES, ALL ENFORCED IN THE DATABASE
--   1. A refund points at ONE payment, and the total refunded against that
--      payment can never exceed it.
--   2. Only a VERIFIED payment can be refunded. Reversing money that was never
--      confirmed as received is how a ledger acquires phantom cash.
--   3. Only a CONFIRMED refund reduces the invoice — mirroring the rule for
--      payments in 0022, so recorded and recognised stay different things.
--   4. Dual control: whoever recorded a refund cannot confirm it. This is money
--      leaving the company, so it is the one place dual control matters most.
--   5. Every refund is audited at warning severity, because a reader scanning
--      the log should not have to work out which entries moved money out.
-- ============================================================================


create type public.refund_status as enum ('recorded', 'confirmed', 'cancelled');


create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,

  amount numeric(12, 2) not null check (amount > 0),

  -- Not optional, and not one word. "Refund" tells a later reader nothing, and
  -- this is the field an auditor reads first.
  reason text not null check (length(btrim(reason)) >= 10),

  status public.refund_status not null default 'recorded',

  -- The provider's own refund id, or the bank transfer reference. This is what
  -- the entry is matched against on a statement.
  external_reference text,

  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint refund_confirmed_needs_confirmer
    check (status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null))
);

create index payment_refunds_payment_idx on public.payment_refunds (payment_id);
create index payment_refunds_open_idx on public.payment_refunds (created_at)
  where status = 'recorded';

alter table public.payment_refunds enable row level security;


-- ----------------------------------------------------------------------------
-- Provenance and limits
-- ----------------------------------------------------------------------------

create or replace function public.enforce_refund_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_already numeric;
begin
  select p.amount, p.verified into v_payment
  from public.payments p
  where p.id = new.payment_id;

  if not found then
    raise exception 'That payment does not exist.' using errcode = 'P0002';
  end if;

  if tg_op = 'INSERT' then
    /* Provenance, exactly as for payments in 0022: taken from the session, not
       from the request. A refund that can name its own author can name
       somebody else. */
    new.recorded_by := (select auth.uid());
    new.recorded_at := now();
    new.status := 'recorded';
    new.confirmed_by := null;
    new.confirmed_at := null;

    if not v_payment.verified then
      raise exception
        'That payment has not been verified yet. Cancel it rather than refunding money we have not confirmed receiving.'
        using errcode = '22023';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- The money and the payment it reverses are settled at insert.
    new.payment_id := old.payment_id;
    new.amount := old.amount;
    new.recorded_by := old.recorded_by;
    new.recorded_at := old.recorded_at;

    if old.status = 'confirmed' and new.status <> 'confirmed' then
      raise exception 'A confirmed refund cannot be reopened. Record a fresh payment instead.'
        using errcode = '22023';
    end if;

    if new.status = 'confirmed' and old.status <> 'confirmed' then
      /* DUAL CONTROL. Money leaving the company is the one place this matters
         most, and it is the same rule 0022 applies to large payments. */
      if old.recorded_by = (select auth.uid()) then
        raise exception
          'A refund must be confirmed by somebody other than the person who recorded it.'
          using errcode = '42501';
      end if;

      new.confirmed_by := (select auth.uid());
      new.confirmed_at := now();
    end if;
  end if;

  /* Never give back more than was taken. Counted across every refund against
     this payment that has not been cancelled, so two half-refunds recorded
     separately cannot add up to more than the whole. */
  select coalesce(sum(r.amount), 0) into v_already
  from public.payment_refunds r
  where r.payment_id = new.payment_id
    and r.status <> 'cancelled'
    and r.id <> new.id;

  if v_already + new.amount > v_payment.amount then
    raise exception
      'That would refund % against a payment of %. Only % is left to refund.',
      v_already + new.amount, v_payment.amount, v_payment.amount - v_already
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger enforce_refund_rules
  before insert or update on public.payment_refunds
  for each row execute function public.enforce_refund_rules();

revoke all on function public.enforce_refund_rules() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- Audit
-- ----------------------------------------------------------------------------

create or replace function public.audit_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit(
      'refund_recorded', 'payment_refunds', new.id::text, 'warning',
      jsonb_build_object('payment_id', new.payment_id, 'amount', new.amount, 'reason', new.reason)
    );
  elsif new.status = 'confirmed' and old.status <> 'confirmed' then
    perform public.write_audit(
      'refund_confirmed', 'payment_refunds', new.id::text, 'warning',
      jsonb_build_object('payment_id', new.payment_id, 'amount', new.amount)
    );
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform public.write_audit(
      'refund_cancelled', 'payment_refunds', new.id::text, 'info',
      jsonb_build_object('payment_id', new.payment_id, 'amount', new.amount)
    );
  end if;

  return null;
end;
$$;

create trigger audit_refund
  after insert or update on public.payment_refunds
  for each row execute function public.audit_refund();

revoke all on function public.audit_refund() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- The invoice total now nets off confirmed refunds
-- ----------------------------------------------------------------------------

create or replace function public.recalculate_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_paid numeric;
  v_refunded numeric;
  v_amount numeric;
  v_project uuid;
  v_due date;
begin
  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where invoice_id = v_invoice_id and verified;

  /* Only CONFIRMED refunds come off, mirroring `verified` on the payment side.
     A refund somebody has recorded but nobody has checked is money we intend
     to return, not money that has gone. */
  select coalesce(sum(r.amount), 0) into v_refunded
  from public.payment_refunds r
  join public.payments p on p.id = r.payment_id
  where p.invoice_id = v_invoice_id
    and p.verified
    and r.status = 'confirmed';

  v_paid := greatest(0, v_paid - v_refunded);

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

  -- Rolled up from the invoices rather than incremented; incrementing drifts
  -- the first time anything is reversed, which is exactly what refunds do.
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


/* A refund row has no invoice_id of its own, so it cannot reuse the payment
   trigger directly. This resolves the invoice through the payment and then
   defers to the same function, so there is one definition of the arithmetic. */
create or replace function public.refund_updates_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice_id uuid;
  v_paid numeric;
  v_refunded numeric;
  v_amount numeric;
  v_project uuid;
  v_due date;
begin
  select p.invoice_id into v_invoice_id
  from public.payments p
  where p.id = coalesce(new.payment_id, old.payment_id);

  if v_invoice_id is null then
    return null;
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where invoice_id = v_invoice_id and verified;

  select coalesce(sum(r.amount), 0) into v_refunded
  from public.payment_refunds r
  join public.payments p on p.id = r.payment_id
  where p.invoice_id = v_invoice_id
    and p.verified
    and r.status = 'confirmed';

  v_paid := greatest(0, v_paid - v_refunded);

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

create trigger refund_updates_invoice
  after insert or update or delete on public.payment_refunds
  for each row execute function public.refund_updates_invoice();

revoke all on function public.refund_updates_invoice() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- Who may see and do what
-- ----------------------------------------------------------------------------

/* The customer sees refunds against their own invoices. Money going back to
   them is the last thing that should be invisible to them — and the first
   thing they will ring about if the balance moves and nothing explains it. */
create policy refunds_read on public.payment_refunds
  for select to authenticated
  using (
    public.has_role('accountant', 'admin')
    or exists (
      select 1
      from public.payments p
      join public.invoices i on i.id = p.invoice_id
      where p.id = payment_refunds.payment_id
        and i.client_id = (select auth.uid())
    )
  );

create policy refunds_write_finance on public.payment_refunds
  for insert to authenticated
  with check (public.has_role('accountant', 'admin'));

create policy refunds_update_finance on public.payment_refunds
  for update to authenticated
  using (public.has_role('accountant', 'admin'))
  with check (public.has_role('accountant', 'admin'));

-- No DELETE policy, deliberately. A refund is an accounting event; cancelling
-- one is a status change that stays on the record, not an erasure.

comment on table public.payment_refunds is
  'Money returned to a customer. A separate event from a payment because it must name the payment it reverses, say why, be capped at what was taken, and be confirmed by a second person.';
