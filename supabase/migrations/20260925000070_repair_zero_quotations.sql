-- ============================================================================
-- 0070  CLEAR THE DEAD END A ₱0 QUOTATION LEAVES BEHIND
-- ----------------------------------------------------------------------------
-- Before the guards added alongside this migration, a quotation could be saved
-- at ₱0 (empty stock catalogue, so the bill of materials priced nothing), then
-- marked accepted — and only then fail at the contract, which requires a value
-- above zero.
--
-- That leaves a row in a state the interface cannot recover from. It is
-- 'accepted', so the quotations table offers no action on it; it has no
-- contract, so nothing downstream exists; and it can never gain one. It simply
-- sits there looking like a closed deal that produced nothing.
--
-- Rejected rather than deleted. The rep did accept it, that happened, and a
-- quotation is a document the business may want to account for. A rejection
-- with a reason is the honest record; a deletion pretends the afternoon did not
-- happen.
--
-- Narrow on purpose: zero value AND accepted AND no contract. That combination
-- is impossible to reach from today onwards, so this can only ever match rows
-- created by the fault it repairs.
-- ============================================================================

update public.quotations q
set status = 'rejected',
    rejection_reason =
      'Automatically closed: this quotation was saved at ₱0 because the stock catalogue was empty, so it could never become a contract. Rebuild it now that the catalogue has equipment in it.',
    responded_at = coalesce(q.responded_at, now())
where q.total_price = 0
  and q.status = 'accepted'
  and not exists (select 1 from public.contracts c where c.quotation_id = q.id);
