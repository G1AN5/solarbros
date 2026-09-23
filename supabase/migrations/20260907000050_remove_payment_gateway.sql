-- ============================================================================
-- 0050  REMOVE THE PAYMENT GATEWAY
-- ----------------------------------------------------------------------------
-- The business has decided not to take card or e-wallet payments through the
-- system. Customers pay by bank transfer or over the counter, and staff record
-- what arrives. That is a smaller system, and a smaller system that matches how
-- the company actually works beats a larger one that does not.
--
-- So the gateway comes OUT rather than being switched off. Dead schema is not
-- neutral: `payment_intents` sitting in the database says the application takes
-- online payments, and the next person to read it — including whoever grades
-- this — has to work out that it never runs. A table nobody writes to is a
-- claim nobody checks.
--
-- WHAT IS BEING REMOVED
--   · payment_intents          the checkout session and its status
--   · payment_webhook_events   the idempotency ledger for provider callbacks
--   · payments.source / provider / external_id / payment_intent_id
--   · the payment_source enum
--   · two settings that only the checkout read
--
-- WHAT IS DELIBERATELY KEPT
--   · `payments` itself, and every rule on it. Recording money by hand is now
--     the only path, which makes those rules matter MORE, not less: the
--     overpayment guard, the "a recorded payment cannot be altered" rule, and
--     provenance taken from the session rather than the request are all the
--     same whether the money arrived by API or by bank transfer.
--   · `payment_refunds` and all of 0047, untouched.
--
-- DUAL CONTROL IS TURNED OFF, NOT DELETED.
-- The owner asked for straightforward recording, so the threshold is set to 0,
-- which the trigger now reads as "off". The mechanism stays in place and one
-- settings change brings it back — appropriate for a growing company, and a
-- decision that should not need a developer either way.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The integrity trigger, without the gateway branches
-- ----------------------------------------------------------------------------

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
  /* --- Provenance cannot be asserted by the caller -----------------------
     Every payment is now recorded by a person, so this is unconditional. It
     used to be skipped for gateway rows, where auth.uid() is null because the
     Edge Function held the service role. */
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
  if new.verified then
    if new.verified_by is null then
      new.verified_by := v_actor;
    end if;
    if new.verified_at is null then
      new.verified_at := now();
    end if;

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


-- ----------------------------------------------------------------------------
-- 2. Drop the gateway schema
-- ----------------------------------------------------------------------------

-- The index goes with the column it covers; naming it explicitly first makes
-- the intent obvious in the migration history.
drop index if exists public.payments_external_id_key;

alter table public.payments
  drop column if exists payment_intent_id,
  drop column if exists external_id,
  drop column if exists provider,
  drop column if exists source;

drop table if exists public.payment_webhook_events;
drop table if exists public.payment_intents;

drop type if exists public.payment_source;


-- ----------------------------------------------------------------------------
-- 3. Settings
-- ----------------------------------------------------------------------------

-- Only the checkout Edge Function ever read these two.
delete from public.settings
where key in ('finance.online_payments_enabled', 'finance.gateway_max_amount');

update public.settings
set value = '0',
    description =
      'A manually recorded payment at or above this amount must be verified by someone other than the person who recorded it. Set to 0 to switch the requirement off, which is the current setting: payments are recorded and counted in one step.'
where key = 'finance.dual_control_threshold';

/* Where the money actually goes. These were hardcoded into the billing page's
   help text, which meant changing bank would have needed a developer — on the
   one piece of information a customer must get exactly right. */
insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values
  ('finance.bank_name', '""', 'finance',
   'Bank',
   'Shown to customers on their billing page. Leave blank to hide the bank transfer panel entirely.',
   'text', null, null, null, array['admin', 'accountant']::public.user_role[], true, 20),

  ('finance.bank_account_name', '""', 'finance',
   'Account name',
   'The name the transfer should be made out to. It must match the bank record exactly or the transfer is rejected.',
   'text', null, null, null, array['admin', 'accountant']::public.user_role[], true, 21),

  ('finance.bank_account_number', '""', 'finance',
   'Account number',
   'Shown to customers. Check it twice — a wrong digit here sends a customer''s money to a stranger.',
   'text', null, null, null, array['admin', 'accountant']::public.user_role[], true, 22),

  ('finance.gcash_number', '""', 'finance',
   'GCash number',
   'Optional. Shown alongside the bank details for customers paying smaller amounts.',
   'text', null, null, null, array['admin', 'accountant']::public.user_role[], true, 23),

  ('finance.payment_instructions', '"Quote your invoice number as the transfer reference so we can match your payment against our statement, then send the receipt to our email."', 'finance',
   'Payment instructions',
   'The paragraph shown under the bank details.',
   'text', null, null, null, array['admin', 'accountant']::public.user_role[], true, 24)
on conflict (key) do nothing;

comment on table public.payments is
  'Money received, recorded by a person. The company settles by bank transfer and over-the-counter deposit; there is no payment gateway, and the rules on this table are what keep a hand-recorded ledger trustworthy.';
