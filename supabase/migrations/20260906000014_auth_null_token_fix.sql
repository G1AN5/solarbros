-- ============================================================================
-- 0014 · FIX: NULL token columns break sign-in for hand-seeded auth users
-- ----------------------------------------------------------------------------
-- THE BUG
-- Every sign-in failed with:
--
--     AuthApiError: Database error querying schema
--
-- The message points at schema permissions, which is misleading. Permissions
-- were fine. (0013 fixed a genuine and separate permissions fault; this is a
-- second, unrelated cause that produced the identical error text.)
--
-- THE CAUSE
-- The demo accounts in 0012 were inserted straight into auth.users, and left
-- these columns NULL because they looked optional:
--
--     confirmation_token, recovery_token, email_change,
--     email_change_token_new, phone_change, phone_change_token,
--     reauthentication_token
--
-- GoTrue is written in Go and scans those columns into plain `string` fields,
-- not `sql.NullString`. A NULL therefore fails at the row-scan step, before any
-- authentication logic runs — which is why the failure looks like a schema
-- problem rather than a data problem, and why it affects every user equally.
--
-- Supabase's own sign-up path always writes empty strings, so this only ever
-- bites seeds and migrations that create users by hand. It is one of the most
-- common ways a manually seeded Supabase project ends up completely unable to
-- log anyone in.
--
-- THE FIX
-- Empty string, not NULL. Applied to existing rows here, and to newly created
-- rows by the defaults set at the bottom so the trap cannot be re-sprung.
--
-- HOW IT WAS CAUGHT
-- scripts/verify-rls.mjs signs in as each demo account through the real API.
-- Type-checking, linting and unit tests would all have passed with the
-- application completely unusable.
-- ============================================================================

update auth.users
set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
where
  confirmation_token is null
  or recovery_token is null
  or email_change is null
  or email_change_token_new is null
  or email_change_token_current is null
  or phone_change is null
  or phone_change_token is null
  or reauthentication_token is null;


-- NOTE: setting column DEFAULTs on auth.users would be the tidier fix, but the
-- migration role does not own that table (it belongs to supabase_auth_admin),
-- so `alter table auth.users ...` fails with "must be owner of table users".
-- Instead, the seed in 0012 now writes empty strings explicitly, which achieves
-- the same result from the only place that creates users by hand.
