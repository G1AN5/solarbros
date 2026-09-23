-- ============================================================================
-- 0035 · ADMINISTRATOR HOUSEKEEPING ON TICKETS AND WARRANTY REQUESTS
-- ----------------------------------------------------------------------------
-- Neither table had a DELETE policy — not for anyone, including an
-- administrator. That is defensible for an audit log and wrong here: spam
-- tickets, duplicates raised by a customer double-clicking, and test records
-- from a demonstration all accumulate with no way to clear them.
--
-- `leads_delete_admin` already set the precedent. This matches it.
--
-- Found the way these things usually are: a verification script's cleanup
-- reported success and removed nothing, because PostgREST answers a DELETE that
-- a policy filters with "200, zero rows" rather than an error. Third time that
-- exact trap has appeared in this project.
--
-- Deleting is still the wrong answer for a real closed ticket — `closed` is its
-- end state, and the history is worth keeping. This is for the records that
-- should never have existed.
-- ============================================================================

create policy tickets_delete_admin on public.tickets
  for delete to authenticated
  using (public.is_admin());

create policy warranty_delete_admin on public.warranty_requests
  for delete to authenticated
  using (public.is_admin());

comment on policy tickets_delete_admin on public.tickets is
  'Housekeeping only. A real ticket ends at "closed" — its history is worth keeping.';
