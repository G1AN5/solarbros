-- ============================================================================
-- 0037 · CLIENT SIGN-OFF ON A COMPLETED VISIT
-- ----------------------------------------------------------------------------
-- The field portal's "Complete job & sync" button had no handler, so a
-- technician could not close a job at all. Every appointment stayed
-- 'dispatched' for ever, and the customer's portal never showed a visit as
-- finished.
--
-- There was also nowhere to PUT the sign-off. The screen captures a printed
-- client name under a heading saying it "captures a legally meaningful
-- acceptance of the work", and `appointments` has no column for it — the only
-- place to write it would have been the free-text `notes` field, mixed in with
-- whatever else somebody typed.
--
-- An acceptance that cannot be told apart from a note is not an acceptance. Two
-- columns, so it can be queried, shown on a certificate, and relied on in a
-- dispute.
-- ============================================================================

alter table public.appointments
  add column client_signoff_name text,
  add column client_signoff_at timestamptz;

comment on column public.appointments.client_signoff_name is
  'Printed name the customer gave when accepting the work on site.';

-- A completed visit needs the acceptance that goes with it. Existing rows are
-- exempt: the constraint applies to what happens from here, and retro-failing
-- seeded history would only make the demo data unloadable.
alter table public.appointments
  add constraint appointments_completed_needs_signoff
  check (
    status <> 'completed'
    or completed_at is null
    or client_signoff_name is not null
  )
  not valid;

comment on constraint appointments_completed_needs_signoff on public.appointments is
  'A visit closed by a technician carries the customer''s acceptance. NOT VALID so seeded history is left alone.';
