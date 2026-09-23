-- ============================================================================
-- 0040  RMA CLAIM REFERENCE
-- ----------------------------------------------------------------------------
-- `rma_claims.claim_reference` is NOT NULL and UNIQUE with no default, and
-- nothing has ever inserted a row, so the omission never showed. The moment
-- "File RMA" became a real button it would have failed on the first claim.
--
-- `rma_ref_seq` has existed since 0008 and 0025 already resynchronises it after
-- a restore; it was only ever missing the default that uses it. Same shape as
-- the quotation and contract references in 0024, for the same reason: two
-- people filing claims in the same minute must not collide, and a generated
-- reference in application code is a race waiting to be lost.
-- ============================================================================

alter table public.rma_claims
  alter column claim_reference set default
    'RMA-' || to_char(now(), 'YYYY') || '-' || nextval('public.rma_ref_seq')::text;

comment on column public.rma_claims.claim_reference is
  'RMA-<year>-<sequence>. From a sequence, so two claims filed at once cannot collide.';
