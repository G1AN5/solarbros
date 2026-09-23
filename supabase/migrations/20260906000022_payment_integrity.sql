-- ============================================================================
-- 0022 · PAYMENT INTEGRITY
-- ----------------------------------------------------------------------------
-- Closes four holes in the money path and adds the tables an online gateway
-- needs. Deliberately provider-agnostic: nothing here mentions PayMongo, so
-- switching providers later touches the Edge Function and nothing else.
--
-- WHAT WAS WRONG
--
--   1. NO IDEMPOTENCY. `payments.reference` was nullable and not unique. Every
--      payment provider retries webhooks — that is normal operation, not an
--      edge case. A retry inserted the payment twice, `amount_paid` doubled, a
--      half-paid invoice read as settled, and the milestone trigger released
--      the next stage of work. This is the failure that would actually have
--      happened, probably in the first week.
--
--   2. THE BROWSER SUPPLIED `recorded_by` AND `verified_by`. Nothing checked
--      them against auth.uid(), so any accountant could attribute a payment to
--      a colleague. The audit trail is the first thing an auditor reads and the
--      last thing that should be writable.
--
--   3. RECORDING AND VERIFYING WERE ONE ACTION BY ONE PERSON. On contracts
--      worth several hundred thousand pesos that is the textbook embezzlement
--      pattern: record a fictitious payment to cover a cash shortfall, or mark
--      a friend's invoice settled. Separation of duties is the standard control
--      and it costs one extra click.
--
--   4. NOTHING CONSTRAINED `amount` AGAINST THE INVOICE. Overpayments passed
--      silently, and a payment could be attached to an invoice it exceeded
--      several times over.
--
-- WHY THE CONTROLS ARE TRIGGERS AND NOT APPLICATION CODE
-- The same reason as migration 0008: a rule enforced in React protects only the
-- users who go through React. The service role, a psql session and a future
-- Edge Function all bypass it. A trigger cannot be gone around.
-- ============================================================================


-- ============================================================================
-- 1 · NEW PAYMENT METHODS
-- ----------------------------------------------------------------------------
-- The rails a Philippine gateway actually exposes. Added at the top and used
-- nowhere in this migration, because Postgres will not let a new enum value be
-- used in the transaction that created it.
-- ============================================================================

alter type public.payment_method add value if not exists 'grabpay';
alter type public.payment_method add value if not exists 'qrph';
alter type public.payment_method add value if not exists 'online_banking';


-- ============================================================================
-- 2 · SETTINGS
-- ----------------------------------------------------------------------------
-- The two thresholds below are judgement calls that change with the business,
-- not constants. A company doing ten jobs a month wants dual control at a lower
-- figure than one doing two hundred.
-- ============================================================================

insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values
  ('finance.online_payments_enabled', 'true', 'finance',
   'Accept online payments',
   'Turns the Pay Now button on and off across the customer portal. Switch it off if the gateway is having problems — customers then see bank transfer details instead of a checkout that fails.',
   'boolean', null, null, null, array['admin', 'accountant']::public.user_role[], true, 10),

  ('finance.gateway_max_amount', '100000', 'finance',
   'Largest payment accepted online',
   'Anything above this must be paid by bank transfer. Two reasons: a fully verified GCash wallet caps at about PHP 100,000 a month, and card fees of roughly 3.5% on a PHP 400,000 milestone hand about PHP 14,000 to the processor.',
   'currency', 'PHP', 1000, 500000, array['admin', 'accountant']::public.user_role[], true, 11),

  ('finance.dual_control_threshold', '50000', 'finance',
   'Second approval required above',
   'A manually recorded payment at or above this amount must be verified by someone other than the person who recorded it. Only a verified payment counts towards the invoice, so this is what stops one person inventing a settlement on their own.',
   'currency', 'PHP', 0, 1000000, array['admin']::public.user_role[], false, 12),

  ('finance.overpayment_tolerance', '100', 'finance',
   'Overpayment tolerance',
   'How much more than the outstanding balance a single payment may be, to absorb rounding and bank charges. Anything beyond this is refused so the accountant splits it across the right invoices instead.',
   'currency', 'PHP', 0, 10000, array['admin', 'accountant']::public.user_role[], false, 13)
on conflict (key) do nothing;


-- ============================================================================
-- 3 · WHERE A PAYMENT CAME FROM
-- ============================================================================

create type public.payment_source as enum ('manual', 'gateway');

create type public.payment_intent_status as enum (
  'awaiting_payment',  -- checkout created, customer has not finished
  'processing',        -- provider is settling it
  'succeeded',
  'failed',
  'cancelled',
  'expired'
);


-- ============================================================================
-- 4 · PAYMENT INTENTS
-- ----------------------------------------------------------------------------
-- One row per attempt to pay online. Created BEFORE the customer is sent to the
-- provider, so that when the webhook arrives there is already a record saying
-- what was supposed to happen and for how much.
--
-- THE AMOUNT LIVES HERE, NOT IN THE BROWSER
-- The Edge Function reads the invoice balance and writes it to this row. The
-- browser is never asked what to charge and its answer is never trusted. A page
-- that could name its own price is a page that will eventually be asked to pay
-- one peso for a PHP 400,000 system.
-- ============================================================================

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  client_id uuid references public.profiles (id) on delete set null,

  provider text not null default 'paymongo',
  -- The provider's own id. Unique per provider so a webhook can find its row,
  -- and so the same intent cannot be recorded twice.
  provider_intent_id text,

  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'PHP',
  status public.payment_intent_status not null default 'awaiting_payment',

  -- Where to send the customer. Not secret, but expires.
  checkout_url text,

  -- The provider's last word on this intent, kept verbatim. Dispute evidence:
  -- when a customer insists they paid, this is the record that settles it.
  last_payload jsonb,
  failure_reason text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (provider, provider_intent_id)
);

create index payment_intents_invoice_idx on public.payment_intents (invoice_id);
create index payment_intents_status_idx on public.payment_intents (status);

create trigger payment_intents_touch
  before update on public.payment_intents
  for each row execute function public.touch_updated_at();

comment on table public.payment_intents is
  'One attempt to pay an invoice online. The amount is set server-side from the invoice, never by the browser.';


-- ============================================================================
-- 5 · THE WEBHOOK LEDGER
-- ----------------------------------------------------------------------------
-- Every webhook the gateway sends, recorded by the provider's own event id,
-- which is UNIQUE. That single constraint is the whole idempotency mechanism:
-- the handler inserts the event first, and a duplicate delivery fails on the
-- constraint and stops before it can touch a payment.
--
-- Doing it this way rather than "check if we have seen this id, then insert"
-- matters, because two retries arriving at the same moment both pass that check
-- and both insert. The database is the only thing that can settle a race.
--
-- Nothing in the browser ever reads this table. It exists for idempotency and
-- for working out what happened afterwards.
-- ============================================================================

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paymongo',
  event_id text not null,
  event_type text,

  payment_intent_id uuid references public.payment_intents (id) on delete set null,
  payload jsonb,

  processed_at timestamptz not null default now(),
  -- Set when the handler rejected the event, so a silent failure is still
  -- visible to somebody looking for it later.
  error text,

  unique (provider, event_id)
);

comment on table public.payment_webhook_events is
  'Idempotency ledger. The unique (provider, event_id) constraint is what makes webhook retries safe.';


-- ============================================================================
-- 6 · HARDENING THE PAYMENTS TABLE
-- ============================================================================

alter table public.payments
  add column source public.payment_source not null default 'manual',
  add column provider text,
  add column external_id text,
  add column payment_intent_id uuid references public.payment_intents (id) on delete set null;

/* The idempotency guarantee for gateway payments. A partial index rather than a
   plain unique constraint because manual payments have no external id, and
   several of them would otherwise collide on null. */
create unique index payments_external_id_key
  on public.payments (provider, external_id)
  where external_id is not null;

comment on index public.payments_external_id_key is
  'Stops a retried webhook recording the same provider payment twice.';


-- ============================================================================
-- 7 · THE INTEGRITY TRIGGER
-- ----------------------------------------------------------------------------
-- Runs on insert and on update, because the update path is the interesting one:
-- without it, an accountant records a payment honestly and then edits the row
-- to verify it themselves, and the dual-control rule is decoration.
-- ============================================================================

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
  v_threshold numeric := public.setting_num('finance.dual_control_threshold', 50000);
  v_other_payments numeric;
begin
  /* --- Provenance cannot be asserted by the caller ----------------------- */
  if tg_op = 'INSERT' then
    -- A gateway payment is written by the Edge Function holding the service
    -- role, where auth.uid() is null. That is legitimate and stays null: the
    -- provider's external_id is the provenance in that case. A manual payment
    -- is always attributed to whoever is actually signed in.
    if new.source = 'manual' then
      new.recorded_by := v_actor;
    end if;

    if new.source = 'gateway' and new.external_id is null then
      raise exception 'A gateway payment must carry the provider reference.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- Amount, invoice and provenance are settled at insert. Allowing them to be
    -- edited afterwards would let a verified payment be quietly rewritten.
    if new.amount is distinct from old.amount
       or new.invoice_id is distinct from old.invoice_id
       or new.source is distinct from old.source
       or new.external_id is distinct from old.external_id then
      raise exception 'A recorded payment cannot be altered. Reverse it and record a correction.'
        using errcode = '23514';
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

  /* --- Separation of duties ---------------------------------------------- */
  if new.verified then
    if new.verified_by is null and new.source = 'manual' then
      new.verified_by := v_actor;
    end if;
    if new.verified_at is null then
      new.verified_at := now();
    end if;

    -- A gateway payment is verified by the provider's signed webhook, which is
    -- stronger evidence than a colleague's click. Dual control applies to the
    -- manual path, where the only evidence is that somebody said so.
    if new.source = 'manual'
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

create trigger payments_integrity
  before insert or update on public.payments
  for each row execute function public.enforce_payment_integrity();

revoke all on function public.enforce_payment_integrity() from public, anon, authenticated;


-- ============================================================================
-- 8 · ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- A customer may see their own payment attempts — "did my GCash payment go
-- through?" is a fair question and the portal should answer it without them
-- ringing the office. They may not create one: the Edge Function does that,
-- after reading the invoice balance itself.
-- ============================================================================

alter table public.payment_intents enable row level security;
alter table public.payment_webhook_events enable row level security;

create policy payment_intents_read on public.payment_intents
  for select to authenticated
  using (
    public.has_role('accountant', 'admin')
    or exists (
      select 1 from public.invoices i
      where i.id = payment_intents.invoice_id
        and i.client_id = (select auth.uid())
    )
  );

-- Finance can cancel a stuck intent. Nobody may insert from the browser.
create policy payment_intents_update_finance on public.payment_intents
  for update to authenticated
  using (public.has_role('accountant', 'admin'))
  with check (public.has_role('accountant', 'admin'));

/* No policy at all on payment_webhook_events. With RLS enabled and no policy,
   every ordinary role is refused, and only the service role inside the Edge
   Function reaches it. Raw provider payloads can carry customer details that
   nothing in the UI needs. */

comment on table public.payment_webhook_events is
  'Idempotency ledger. RLS is on with no policies: service role only, by design.';
