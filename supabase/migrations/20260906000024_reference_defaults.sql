-- ============================================================================
-- 0024 · REFERENCE NUMBERS AS COLUMN DEFAULTS
-- ----------------------------------------------------------------------------
-- 0023 generated `QTN-2026-1000` and `CON-2026-1000` from a BEFORE INSERT
-- trigger. That works, but it leaves `reference` as NOT NULL with no default,
-- which means `supabase gen types` marks it REQUIRED on insert — so every
-- caller has to pass a value the database is about to overwrite, and TypeScript
-- refuses the honest version of the code.
--
-- A column default expresses the same thing and tells the type generator the
-- truth. The triggers are dropped rather than left alongside: two mechanisms
-- for one value is how they end up disagreeing.
--
-- `nextval` in a default is exactly what `serial` compiles to, so this is the
-- ordinary way to do it rather than a trick.
-- ============================================================================

drop trigger if exists quotations_reference on public.quotations;
drop trigger if exists contracts_reference on public.contracts;
drop function if exists public.set_quotation_reference();
drop function if exists public.set_contract_reference();

alter table public.quotations
  alter column reference set default
    'QTN-' || to_char(now(), 'YYYY') || '-' || nextval('public.quotation_ref_seq')::text;

alter table public.contracts
  alter column reference set default
    'CON-' || to_char(now(), 'YYYY') || '-' || nextval('public.contract_ref_seq')::text;

comment on column public.quotations.reference is
  'QTN-<year>-<sequence>. From a sequence, so two reps saving at once cannot collide.';
comment on column public.contracts.reference is
  'CON-<year>-<sequence>. From a sequence, so two reps saving at once cannot collide.';
