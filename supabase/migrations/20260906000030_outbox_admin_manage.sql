-- ============================================================================
-- 0030 · AN ADMINISTRATOR CAN MANAGE THE OUTBOX, NOT JUST READ IT
-- ----------------------------------------------------------------------------
-- 0028 gave administrators SELECT on every notification, which is what the
-- outbox screen needs to display. It gave them nothing else — and the only
-- other policy on the table is `notifications_update_own`, scoped to a
-- recipient's own rows.
--
-- So an administrator could look at a hundred failed messages and do nothing
-- about any of them: no clearing a stuck row, no deleting a message queued
-- against an address that no longer exists. A read-only diagnostic screen for a
-- problem you cannot then fix is a screen people stop opening.
--
-- FOUND BY THE VERIFICATION SCRIPT, VIA A FAILURE MODE WORTH NAMING
-- The test set up a "crashed dispatcher run" by updating a row, then asserted
-- the requeue picked it up. It did not — because the setup UPDATE had matched
-- ZERO ROWS and reported success. PostgREST does that whenever a policy filters
-- the target: no error, no rows, and every later assertion quietly meaningless.
--
-- That is the third time this pattern has appeared in this project — first in
-- an RLS test that read "no error" as "the write succeeded", then in the
-- milestone mutation. Worth stating as a rule: after a write that RLS could
-- filter, check the number of rows affected, never just the absence of an error.
--
-- The trigger from 0023 still applies to everyone else: a recipient may mark a
-- notification read and nothing more.
-- ============================================================================

create policy notifications_write_admin on public.notifications
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

comment on policy notifications_write_admin on public.notifications is
  'The outbox is an operational screen. Being able to see a stuck message without being able to clear it is not much use.';
