-- ============================================================================
-- 0041  INVOICE NUMBER DEFAULT
-- ----------------------------------------------------------------------------
-- `invoices.invoice_number` is NOT NULL and UNIQUE with no default. Every
-- invoice so far has been raised by a milestone trigger, and each of those
-- builds the number itself with `nextval('invoice_ref_seq')` — so the gap only
-- appears the moment a human raises one, which "+ New invoice" now lets them do.
--
-- The alternative was to generate it in the browser, which is how the ticket
-- reference bug in 0034 happened: a client-side reference collides with the
-- sequence the triggers use, and the collision surfaces as a unique-violation
-- on somebody's screen. A column default uses the same sequence as the
-- triggers, so the two paths can never produce the same number.
--
-- Same shape as 0024 (quotations, contracts) and 0040 (RMA claims).
-- ============================================================================

alter table public.invoices
  alter column invoice_number set default
    'INV-' || to_char(now(), 'YYYY') || '-' || nextval('public.invoice_ref_seq')::text;

comment on column public.invoices.invoice_number is
  'INV-<year>-<sequence>. Shared with the milestone triggers, so a manually raised invoice cannot collide with an automatic one.';
