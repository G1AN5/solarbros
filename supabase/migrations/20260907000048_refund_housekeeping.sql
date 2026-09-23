-- ============================================================================
-- 0048  REFUND HOUSEKEEPING
-- ----------------------------------------------------------------------------
-- 0047 gave `payment_refunds` no DELETE policy on the argument that a refund is
-- an accounting event and cancelling one should be a status change rather than
-- an erasure. The argument is right about the day-to-day and wrong overall, for
-- two reasons the verification script surfaced within minutes:
--
--   1. `payment_refunds.payment_id` is ON DELETE RESTRICT, correctly — deleting
--      a payment must not silently erase the record of money returned against
--      it. But that means a payment can never be removed once any refund points
--      at it, so demo and test data becomes permanent. This is the third time
--      in this project that a cleanup has reported success while removing
--      nothing, and each time the cause was a missing DELETE policy.
--
--   2. It was inconsistent. `payments_write_finance` is FOR ALL, so an
--      accountant can already delete a payment outright. Protecting the refund
--      more tightly than the payment it reverses protects nothing.
--
-- What actually makes this safe is not the absence of a policy: it is that
-- `audit_refund` (0047) writes an immutable entry at warning severity when a
-- refund is recorded, confirmed or cancelled, and `audit_log` has no UPDATE or
-- DELETE policy at all. The evidence survives the row.
--
-- Restricted to administrators rather than every accountant, because deleting
-- one is housekeeping and never part of the accounting workflow — cancelling
-- is.
-- ============================================================================

create policy refunds_delete_admin on public.payment_refunds
  for delete to authenticated
  using (public.is_admin());

comment on policy refunds_delete_admin on public.payment_refunds is
  'Housekeeping only. Cancelling a refund is the accounting action; deleting one is for clearing test data, and the audit entry outlives the row.';
